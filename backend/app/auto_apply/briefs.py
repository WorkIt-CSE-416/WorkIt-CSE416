"""
Company briefs (KAN-382): what a company builds and has shipped lately, so
a "why us" answer can name a real product, launch or piece of engineering.
One brief per company, shared by every student who applies there, built by
the first student's Claude through the connector (app/connector/briefs.py).
WorkIt calls no model for it; everything here is checked in code.

- **Each fact is checked on its page.** It carries a category (CATEGORIES),
  a sentence, the page's URL, a quote copied word for word from that page
  and the page's date. On save WorkIt reads each page (the safe fetcher,
  app/services/page_fetch.py) and keeps a fact only if its URL is on the
  company's own domain or a NEWS site, its quote is on the page, and every
  number the fact states is in its quote. A date the page doesn't show
  (its year nowhere on the page) is dropped from the fact, not the fact.
- **Own pages first.** A news site's fact stands in only when fewer than
  MIN_OWN facts from the company's own site pass, and never one that
  states a number: a reporter's number is the one most often wrong.
- **A brief is scored in code** (`score`): categories covered, checked
  facts, facts from the last year. Fewer than MIN_FACTS checked facts are
  never saved, and a new brief replaces the kept one only if it scores
  higher today.
- **The connector offers a brief for research** (`research_task`) when it
  is missing, older than FRESH_DAYS or scores under STRONG; a research
  that was not kept holds the company back for RETRY_DAYS, so one company
  no Claude can research doesn't take every student's turn.
- A brief is web text: the connector hands it to Claude as data, never as
  instructions, and WorkIt can't tell which model built it, so nothing
  depends on that.
"""

import asyncio
import dataclasses
import datetime
import re
import unicodedata
import uuid
from collections.abc import Iterable

from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.applications import Job_Application
from app.models.company_briefs import Company_Brief
from app.models.dto import application_stage
from app.models.jobs import Job_Post
from app.models.profiles import Company_Profile
from app.models.written_answers import Written_Answer
from app.queries.jobs.filters import LISTED
from app.services.page_fetch import fetch_text

CATEGORIES = ("products", "launches", "engineering", "team")
MIN_FACTS = 3
MIN_OWN = 3  # own-site facts that leave the news sites' facts out
MAX_FACTS = 15
FRESH_DAYS = 30
STRONG = 60  # of 100: under it a brief is weak and offered for research again
RETRY_DAYS = 3
RECENT_DAYS = 365
QUOTE_WORDS = 5  # a shorter quote proves too little
CHECK_SECONDS = 30  # to read every page of one save; a page unread by then fails its facts
READS_AT_ONCE = 6

# News sites whose reporting a brief may cite beside the company's own pages.
NEWS = (
    "reuters.com", "apnews.com", "bloomberg.com", "cnbc.com", "wsj.com", "nytimes.com", "ft.com",
    "theverge.com", "techcrunch.com", "wired.com", "arstechnica.com", "axios.com", "theinformation.com",
)

# Company-name endings left out of its key: "Acme, Inc." is "acme".
_ENDINGS = {"inc", "incorporated", "llc", "ltd", "limited", "corp", "corporation", "co", "company",
            "plc", "gmbh", "lp", "llp", "ag"}
# Country endings where the name sits one label further left (acme.co.uk).
_TWO_LEVEL = {"co.uk", "org.uk", "ac.uk", "com.au", "co.jp", "co.in", "com.br", "co.nz", "com.sg",
              "co.kr", "com.cn", "com.mx", "co.za", "com.hk", "com.tw"}
_NUMBER = re.compile(r"\d+(?:[.,]\d+)*")
_MONTH = re.compile(r"^(\d{4})-(\d{2})(?:-(\d{2}))?$")

# The page fetcher, swapped for a fake in tests.
fetch_page = fetch_text


def company_key(name: str) -> str:
    words = re.findall(r"[a-z0-9]+", unicodedata.normalize("NFKD", name).casefold())
    while len(words) > 1 and words[-1] in _ENDINGS:
        words.pop()
    return "".join(words)


def _site(host: str) -> tuple[str, str]:
    """A host's registrable domain and the name label in it."""
    labels = host.rstrip(".").lower().split(".")
    if len(labels) < 2:
        return host, host
    n = 3 if len(labels) >= 3 and ".".join(labels[-2:]) in _TWO_LEVEL else 2
    return ".".join(labels[-n:]), labels[-n]


def own_domain(host: str, company: str, websites: Iterable[str] = ()) -> bool:
    """Whether `host` is the company's own: a domain named for it
    (blog.acme.com for Acme), or the site its WorkIt profile names."""
    domain, label = _site(host)
    if re.sub(r"[^a-z0-9]", "", label) == company_key(company):
        return True
    return any(domain == _site(re.sub(r"^\w+://", "", w).split("/")[0].split(":")[0])[0] for w in websites if w)


def news_site(host: str) -> bool:
    host = host.rstrip(".").lower()
    return any(host == n or host.endswith("." + n) for n in NEWS)


def _plain(text: str) -> str:
    """Text as a quote is matched: case, accents, punctuation and spacing folded."""
    folded = unicodedata.normalize("NFKC", text).casefold()
    return " ".join(re.findall(r"\w+", folded))


def _numbers(text: str) -> set[str]:
    return {n.replace(",", "") for n in _NUMBER.findall(text)}


def _month(published: str | None, today: datetime.date) -> datetime.date | None:
    found = _MONTH.match((published or "").strip())
    if not found:
        return None
    try:
        day = datetime.date(int(found[1]), int(found[2]), int(found[3] or 1))
    except ValueError:
        return None
    return day if day <= today else None


def score(facts: list[dict], today: datetime.date) -> int:
    """A brief's score out of 100: 10 for each category it covers (40),
    4 for each fact up to 10 (40), and 4 for each fact whose page is under
    a year old, up to 5 (20). Recency is counted on `today`, so a brief
    scores lower as it ages."""
    categories = {f.get("category") for f in facts} & set(CATEGORIES)
    recent = sum(
        1 for f in facts
        if (day := _month(f.get("published"), today)) and (today - day).days <= RECENT_DAYS
    )
    return 10 * len(categories) + 4 * min(len(facts), 10) + 4 * min(recent, 5)


@dataclasses.dataclass(frozen=True)
class Dropped:
    url: str
    reason: str


async def check(
    company: str, facts: list[dict], today: datetime.date, websites: Iterable[str] = ()
) -> tuple[list[dict], list[Dropped]]:
    """The facts that pass, as kept, and the ones dropped with why. Reads
    each allowed page once, all within CHECK_SECONDS."""
    websites = list(websites)

    def allowed(host: str) -> bool:
        return own_domain(host, company, websites) or news_site(host)

    kept: list[dict] = []
    dropped: list[Dropped] = []
    waiting: list[dict] = []
    quotes: set[str] = set()
    press: set[int] = set()  # ids of the waiting facts from a news site
    for fact in facts:
        url, quote = fact["url"].strip(), fact["quote"]
        host = (re.match(r"^https?://([^/:?#]+)", url) or [None, ""])[1]
        own = bool(host) and own_domain(host, company, websites)
        if not host or not allowed(host):
            dropped.append(Dropped(url, "not the company's own site or a listed news site"))
        elif not own and _numbers(fact["fact"]):
            dropped.append(Dropped(url, "a news site's fact that states a number"))
        elif len(_plain(quote).split()) < QUOTE_WORDS:
            dropped.append(Dropped(url, f"the quote is under {QUOTE_WORDS} words"))
        elif not _numbers(fact["fact"]) <= _numbers(quote):
            dropped.append(Dropped(url, "the fact states a number its quote doesn't"))
        elif _plain(quote) in quotes:
            dropped.append(Dropped(url, "the same quote as another fact"))
        else:
            quotes.add(_plain(quote))
            waiting.append({**fact, "url": url})
            if not own:
                press.add(id(waiting[-1]))

    pages = await _read({f["url"] for f in waiting}, allowed)
    fact_press: set[int] = set()  # indexes in `kept` of the news sites' facts
    for fact in waiting:
        page = pages.get(fact["url"])
        if page is None:
            dropped.append(Dropped(fact["url"], "the page could not be read"))
        elif _plain(fact["quote"]) not in page:
            dropped.append(Dropped(fact["url"], "the quote is not on the page"))
        else:
            day = _month(fact.get("published"), today)
            if id(fact) in press:
                fact_press.add(len(kept))
            kept.append({
                "category": fact["category"],
                "fact": " ".join(fact["fact"].split()),
                "url": fact["url"],
                "quote": " ".join(fact["quote"].split()),
                # A date counts only if the page shows its year.
                "published": fact["published"].strip() if day and str(day.year) in page else None,
                "team": (fact.get("team") or "").strip() or None,
            })
    if len(kept) - len(fact_press) >= MIN_OWN:
        dropped += [Dropped(kept[i]["url"], f"a news site's fact, and {MIN_OWN} facts from the company's own site passed")
                    for i in sorted(fact_press)]
        kept = [f for i, f in enumerate(kept) if i not in fact_press]
    return kept[:MAX_FACTS], dropped


async def _read(urls: set[str], allowed) -> dict[str, str]:
    """Each page's text, matched as quotes are; a page not read is left out."""
    gate = asyncio.Semaphore(READS_AT_ONCE)

    async def read(url: str) -> str:
        async with gate:
            return _plain(await fetch_page(url, allowed))

    tasks = {url: asyncio.ensure_future(read(url)) for url in urls}
    if not tasks:
        return {}
    await asyncio.wait(tasks.values(), timeout=CHECK_SECONDS)
    pages = {}
    for url, task in tasks.items():
        if task.done() and not task.cancelled() and task.exception() is None:
            pages[url] = task.result()
        else:
            task.cancel()
    return pages


# --- Layer 1: rows ---

@dataclasses.dataclass(frozen=True)
class Applying:
    """A company the student has an open application with a question to write for."""

    company: str
    job_id: uuid.UUID
    title: str
    website: str | None


async def _applying(db: AsyncSession, applicant_id: uuid.UUID) -> list[Applying]:
    """The companies of the student's open applications (queued or
    needs_you, posting open) with a written question unanswered, oldest
    application first, each company once."""
    unanswered = (
        select(Written_Answer.job_id)
        .where(
            Written_Answer.applicant_id == applicant_id,
            Written_Answer.job_id == Job_Application.job_id,
            Written_Answer.answer.is_(None),
        )
        .exists()
    )
    rows = (await db.execute(
        select(Job_Post.company_name, Job_Post.id, Job_Post.title, Company_Profile.website_url)
        .join(Job_Application, Job_Application.job_id == Job_Post.id)
        .outerjoin(Company_Profile, Company_Profile.id == Job_Post.company_id)
        .where(
            Job_Application.applicant_id == applicant_id,
            Job_Application.stage.in_((application_stage.queued, application_stage.needs_you)),
            LISTED,
            unanswered,
        )
        .order_by(Job_Application.created_at, Job_Application.job_id)
    )).all()
    seen: dict[str, Applying] = {}
    for row in rows:
        if row.company_name and (key := company_key(row.company_name)) and key not in seen:
            seen[key] = Applying(row.company_name, row.id, row.title, row.website_url)
    return list(seen.values())


async def _row(db: AsyncSession, key: str, lock: bool = False) -> Company_Brief | None:
    query = select(Company_Brief).where(Company_Brief.company_key == key)
    return (await db.execute(query.with_for_update() if lock else query)).scalar_one_or_none()


# --- Layer 2: the steps the connector calls ---

async def brief_for(db: AsyncSession, company: str | None) -> list[dict]:
    """The kept brief's facts for `company`, for Claude to read as data; [] with none."""
    key = company_key(company or "")
    row = await _row(db, key) if key else None
    if row is None or row.saved_at is None:
        return []
    return [{k: f.get(k) for k in ("category", "fact", "url", "published", "team")} for f in row.facts]


@dataclasses.dataclass(frozen=True)
class Task:
    company: str
    job_id: uuid.UUID
    title: str
    reason: str  # missing, stale or weak
    score: int
    missing: list[str]  # categories the kept brief lacks


def _reason(row: Company_Brief | None, now: datetime.datetime) -> str | None:
    if row is not None and row.attempted_at and now - row.attempted_at < datetime.timedelta(days=RETRY_DAYS):
        return None
    if row is None or row.saved_at is None:
        return "missing"
    if now - row.saved_at > datetime.timedelta(days=FRESH_DAYS):
        return "stale"
    if score(row.facts, now.date()) < STRONG:
        return "weak"
    return None


async def research_task(db: AsyncSession, applicant_id: uuid.UUID) -> Task | None:
    """The first company the student applies to whose brief is missing,
    stale or weak, or None when every one is fresh and strong."""
    now = await db.scalar(select(func.now()))
    for applying in await _applying(db, applicant_id):
        row = await _row(db, company_key(applying.company))
        if reason := _reason(row, now):
            facts = row.facts if row is not None and row.saved_at else []
            return Task(
                company=applying.company, job_id=applying.job_id, title=applying.title, reason=reason,
                score=score(facts, now.date()),
                missing=[c for c in CATEGORIES if c not in {f.get("category") for f in facts}],
            )
    return None


class NotApplying(Exception):
    """A brief for a company the student has no open application with."""


@dataclasses.dataclass(frozen=True)
class Saved:
    saved: bool
    score: int
    current_score: int  # the kept brief's, before this save
    kept: int
    dropped: list[Dropped]


async def save_brief(db: AsyncSession, applicant_id: uuid.UUID, company: str, facts: list[dict]) -> Saved:
    """Checks each fact on its page and keeps the brief if it has at least
    MIN_FACTS checked facts and scores higher today than the kept one.
    Raises NotApplying for a company the student isn't applying to."""
    key = company_key(company)
    applying = next((a for a in await _applying(db, applicant_id) if company_key(a.company) == key), None)
    if not key or applying is None:
        raise NotApplying("The student has no open application with that company. Use the company get_research_task gave.")
    # End the read before the pages are read, so no transaction waits on the web.
    await db.rollback()
    today = datetime.datetime.now(datetime.UTC).date()
    kept, dropped = await check(applying.company, facts, today, [applying.website or ""])

    await db.execute(insert(Company_Brief).values(company_key=key, company=applying.company)
                     .on_conflict_do_nothing(index_elements=["company_key"]))
    row = await _row(db, key, lock=True)
    current = score(row.facts, today) if row.saved_at else 0
    new = score(kept, today)
    saved = len(kept) >= MIN_FACTS and new > current
    if saved:
        row.company, row.facts, row.saved_at, row.attempted_at = applying.company, kept, func.now(), None
    else:
        row.attempted_at = func.now()
    await db.commit()
    return Saved(saved=saved, score=new, current_score=current, kept=len(kept), dropped=dropped)
