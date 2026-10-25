"""
Company briefs (KAN-382): what a company builds and has shipped lately, so
a "why us" answer can name a real product, launch or piece of engineering.
One brief per company, and one per team a posting names (KAN-369), shared
by every student who applies there, built by the first student's Claude
through the connector (app/connector/briefs.py).
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
- **A team the posting names gets its own brief.** Each posting is named
  once ("Flight Software", or none), by the first student's Claude, as the
  posting writes it; the team's brief is keyed by the team's folded name,
  so every posting naming that team shares it. It is offered again only
  when missing or older than FRESH_DAYS, and kept with MIN_TEAM_FACTS.
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
from app.models.company_briefs import Company_Brief, Posting_Team
from app.models.dto import application_stage
from app.models.jobs import Job_Post
from app.models.profiles import Company_Profile
from app.models.written_answers import Written_Answer
from app.queries.jobs.filters import LISTED
from app.services.page_fetch import fetch_text

CATEGORIES = ("products", "launches", "engineering", "team")
MIN_FACTS = 3
MIN_TEAM_FACTS = 1  # a small team has few pages; the score still decides a rebuild
MIN_OWN = 3  # own-site facts that leave the news sites' facts out
POSTING_CHARS = 4_000  # of the posting's text, handed over to name its team
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


def team_key(name: str) -> str:
    """A team's name folded as a company's is, a trailing "team" dropped:
    "Flight Software team" and "flight-software" are `flightsoftware`."""
    words = re.findall(r"[a-z0-9]+", unicodedata.normalize("NFKD", name).casefold())
    while len(words) > 1 and words[-1] == "team":
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
    (blog.acme.com for Acme; shield.ai for Shield AI, whose ending spells
    the rest of the name), or the site its WorkIt profile names."""
    domain, label = _site(host)
    name = re.sub(r"[^a-z0-9]", "", label)
    if company_key(company) in (name, name + re.sub(r"[^a-z0-9]", "", domain[len(label):])):
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
    posting: str | None


async def _applying(db: AsyncSession, applicant_id: uuid.UUID) -> list[Applying]:
    """The student's open applications (queued or needs_you, posting open)
    with a written question unanswered, oldest application first."""
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
        select(Job_Post.company_name, Job_Post.id, Job_Post.title, Job_Post.description, Company_Profile.website_url)
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
    return [Applying(row.company_name, row.id, row.title, row.website_url, row.description)
            for row in rows if row.company_name and company_key(row.company_name)]


async def _row(db: AsyncSession, key: str, lock: bool = False, team: str = "") -> Company_Brief | None:
    query = select(Company_Brief).where(Company_Brief.company_key == key, Company_Brief.team == team)
    return (await db.execute(query.with_for_update() if lock else query)).scalar_one_or_none()


# --- Layer 2: the steps the connector calls ---

async def brief_for(db: AsyncSession, company: str | None, job_id: uuid.UUID | None = None) -> list[dict]:
    """The kept brief's facts for `company`, then those of the team the
    posting `job_id` names, for Claude to read as data; [] with none."""
    key = company_key(company or "")
    if not key:
        return []
    rows = [await _row(db, key)]
    if job_id is not None and (team := await db.scalar(select(Posting_Team.team).where(Posting_Team.job_id == job_id))):
        rows.append(await _row(db, key, team=team_key(team)))
    return [{k: f.get(k) for k in ("category", "fact", "url", "published", "team")}
            for row in rows if row is not None and row.saved_at is not None for f in row.facts]


async def needs_research(db: AsyncSession, company: str | None) -> bool:
    """Whether `company`'s brief must be researched before its essays are
    written: it has none, or only one over FRESH_DAYS old, and it isn't
    held back (RETRY_DAYS after a failed save). A weak brief is still
    written from: it was the best one found."""
    key = company_key(company or "")
    if not key:
        return False
    return _reason(await _row(db, key), await db.scalar(select(func.now()))) in ("missing", "stale")


@dataclasses.dataclass(frozen=True)
class Task:
    company: str
    job_id: uuid.UUID
    title: str
    reason: str  # missing, stale or weak; for a team also unnamed
    score: int
    missing: list[str]  # categories the kept brief lacks
    scope: str = "company"  # or team: the team the posting names
    team: str | None = None  # the team, once the posting is named
    posting: str | None = None  # the posting's text, to name its team from
    known_teams: list[str] = dataclasses.field(default_factory=list)  # the company's teams with a brief


def _reason(row: Company_Brief | None, now: datetime.datetime, team: bool = False) -> str | None:
    # A team research not kept waits as long as a kept one: the team has few pages.
    hold = FRESH_DAYS if team else RETRY_DAYS
    if row is not None and row.attempted_at and now - row.attempted_at < datetime.timedelta(days=hold):
        return None
    if row is None or row.saved_at is None:
        return "missing"
    if now - row.saved_at > datetime.timedelta(days=FRESH_DAYS):
        return "stale"
    if not team and score(row.facts, now.date()) < STRONG:
        return "weak"
    return None


async def _known_teams(db: AsyncSession, key: str) -> list[str]:
    """The names of the company's teams that have a kept brief."""
    rows = (await db.scalars(select(Company_Brief).where(
        Company_Brief.company_key == key, Company_Brief.team != "", Company_Brief.saved_at.is_not(None),
    ).order_by(Company_Brief.saved_at))).all()
    return [row.facts[0]["team"] for row in rows if row.facts and row.facts[0].get("team")]


async def research_task(db: AsyncSession, applicant_id: uuid.UUID) -> Task | None:
    """The student's first application, oldest first, whose company brief
    is missing, stale or weak, whose posting's team isn't named yet, or
    whose team's brief is missing or stale; None when none is."""
    now = await db.scalar(select(func.now()))
    seen: set[str] = set()
    for applying in await _applying(db, applicant_id):
        key = company_key(applying.company)
        row = await _row(db, key)
        facts = row.facts if row is not None and row.saved_at else []
        if key not in seen and (reason := _reason(row, now)):
            return Task(
                company=applying.company, job_id=applying.job_id, title=applying.title, reason=reason,
                score=score(facts, now.date()),
                missing=[c for c in CATEGORIES if c not in {f.get("category") for f in facts}],
            )
        seen.add(key)
        team = await db.scalar(select(Posting_Team.team).where(Posting_Team.job_id == applying.job_id))
        if team == "":
            continue
        team_row = await _row(db, key, team=team_key(team)) if team else None
        reason = "unnamed" if team is None else _reason(team_row, now, team=True)
        if reason:
            team_facts = team_row.facts if team_row is not None and team_row.saved_at else []
            return Task(
                company=applying.company, job_id=applying.job_id, title=applying.title, reason=reason,
                score=score(team_facts, now.date()),
                missing=[c for c in CATEGORIES if c not in {f.get("category") for f in team_facts}],
                scope="team", team=team, posting=(applying.posting or "")[:POSTING_CHARS],
                known_teams=await _known_teams(db, key),
            )
    return None


class NotApplying(Exception):
    """A brief for a company the student has no open application with."""


class NotOnPosting(Exception):
    """A team the posting doesn't name as written, or another than the one it was named with."""


@dataclasses.dataclass(frozen=True)
class Saved:
    saved: bool
    score: int
    current_score: int  # the kept brief's, before this save
    kept: int
    dropped: list[Dropped]
    team: str | None = None  # a team brief's team, as the posting was named


async def _name_team(db: AsyncSession, applying: Applying, team: str | None) -> str:
    """The team `applying`'s posting names: as first named, else `team`
    (none for ""/None) once checked against the posting, and kept."""
    named = await db.scalar(select(Posting_Team.team).where(Posting_Team.job_id == applying.job_id))
    team = " ".join((team or "").split())
    if named is not None:
        if team_key(team) != team_key(named):
            raise NotOnPosting(f"This posting's team is already named {named or 'none'}: save under that name.")
        return named
    if team:
        key = team_key(team)
        posting = f" {_plain(applying.title + chr(10) + (applying.posting or ''))} "
        words = _plain(team).split()
        while len(words) > 1 and words[-1] == "team":
            words.pop()  # "Flight Software team" for a posting that writes "Flight Software"
        if not key or key == company_key(applying.company) or f" {' '.join(words)} " not in posting:
            raise NotOnPosting("Name the team as the posting's title or text writes it, or null when it names none.")
        # Another posting named this team already: its name keys the shared brief.
        team = next((t for t in await _known_teams(db, company_key(applying.company)) if team_key(t) == key), team)
    await db.execute(insert(Posting_Team).values(job_id=applying.job_id, team=team)
                     .on_conflict_do_nothing(index_elements=["job_id"]))
    await db.commit()
    return team


async def save_brief(
    db: AsyncSession, applicant_id: uuid.UUID, company: str, facts: list[dict],
    scope: str = "company", job_id: uuid.UUID | None = None, team: str | None = None,
) -> Saved:
    """Checks each fact on its page and keeps the brief if it has at least
    MIN_FACTS checked facts and scores higher today than the kept one.
    With scope "team", first names the posting `job_id`'s team (`team`,
    None when it names none) and keeps the facts as that team's brief,
    from MIN_TEAM_FACTS. Raises NotApplying for a company (or posting) the
    student isn't applying to, NotOnPosting for a team the posting doesn't name."""
    key = company_key(company)
    applying = next((a for a in await _applying(db, applicant_id) if company_key(a.company) == key
                     and (scope != "team" or a.job_id == job_id)), None)
    if not key or applying is None:
        raise NotApplying("The student has no open application with that company (and job). "
                          "Use the company and job_id get_research_task gave.")
    team_name = await _name_team(db, applying, team) if scope == "team" else ""
    tkey = team_key(team_name) if team_name else ""
    if scope == "team" and (not tkey or not facts):
        row = await _row(db, key, team=tkey) if tkey else None
        current = score(row.facts, datetime.datetime.now(datetime.UTC).date()) if row and row.saved_at else 0
        return Saved(saved=False, score=0, current_score=current, kept=0, dropped=[], team=team_name or None)
    # End the read before the pages are read, so no transaction waits on the web.
    await db.rollback()
    today = datetime.datetime.now(datetime.UTC).date()
    kept, dropped = await check(applying.company, facts, today, [applying.website or ""])
    if tkey:
        kept = [{**f, "team": team_name} for f in kept]

    await db.execute(insert(Company_Brief).values(company_key=key, team=tkey, company=applying.company)
                     .on_conflict_do_nothing(index_elements=["company_key", "team"]))
    row = await _row(db, key, lock=True, team=tkey)
    current = score(row.facts, today) if row.saved_at else 0
    new = score(kept, today)
    saved = len(kept) >= (MIN_TEAM_FACTS if tkey else MIN_FACTS) and new > current
    if saved:
        row.company, row.facts, row.saved_at, row.attempted_at = applying.company, kept, func.now(), None
    else:
        row.attempted_at = func.now()
    await db.commit()
    return Saved(saved=saved, score=new, current_score=current, kept=len(kept), dropped=dropped, team=team_name or None)
