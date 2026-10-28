"""
The writing half of the Apply import (scripts/import_apply_profile.py, steps
6-8), from Apply's story-bank.md, voice.md and company-briefs/:

6. writing samples (KAN-384): only the student's own words, which Apply keeps
   under the Story bank's "## <name>'s own essays" and "## <name>'s own
   answers" headings (Apply's writing.samples reads the same two): each essay's
   quoted (">") text and each answer under its bold question, never a
   heading, a question or a note. They are packed in file order into at most
   MAX_SAMPLES samples of SAMPLE_MAX characters; a piece too long for one is
   cut at its last paragraph that fits. Only the samples an import brought
   (`imported`) are replaced, and only when they differ, since any change
   to them deletes the style card; one the student added or edited in
   WorkIt stays, and the brought ones take only the room it leaves;
7. the style card: voice.md as Apply wrote it (its leading HTML comment left
   out), saved after the samples it was measured from, when it is under
   CARD_MAX;
8. company briefs (KAN-382): each company-briefs/<company>.md section (the
   company's, and each team's but the unnamed `Team: ""`) as WorkIt's brief
   for that company (or team), keyed by WorkIt's company_key. Apply keeps no
   quote, so the quote is the sentence on the fact's page that names the
   fact's product and holds every number the fact states; then WorkIt's own
   check (briefs.check, which reads each page again) keeps or drops each
   fact, and WorkIt's own rule (MIN_FACTS, or MIN_TEAM_FACTS for a team, and
   a higher score than the kept brief) decides whether the brief is kept.
"""

import datetime
import re
import uuid
from pathlib import Path

from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.auto_apply import briefs
from app.models.company_briefs import Company_Brief
from app.models.jobs import Job_Post
from app.models.profiles import Company_Profile
from app.models.writing import Writing_Sample
from app.queries import writing
from app.schemas.writing import CARD_MAX, MAX_SAMPLES, SAMPLE_MAX
from app.services.page_fetch import Unreadable

STORY_BANK, VOICE, BRIEFS = "story-bank.md", "voice.md", "company-briefs"
_OWN = re.compile(r"^## [^\n]+'s own (essays|answers)[^\n]*\n(.*?)(?=^## |\Z)", re.MULTILINE | re.DOTALL)
_QUESTION = re.compile(r"^\*\*.+\*\*\s*$", re.MULTILINE)
_FACT = re.compile(r"^- \*\*(?P<name>.+?)\*\*(?: \((?P<note>[^)]*)\))?: (?P<fact>.+) (?P<url>https?://\S+)\s*$", re.MULTILINE)
_SENTENCE = re.compile(r"(?<=[.!?])\s+|\n+")
_LONGEST_QUOTE = 60  # words: a longer "sentence" is a page's run-on text, not a quote


# --- 6. writing samples ---

def own_pieces(story: str) -> list[str]:
    """The student's own essays and answers in a Story bank, word for word, in file order."""
    pieces: list[str] = []
    for kind, body in _OWN.findall(story):
        if kind == "essays":
            for block in re.findall(r"(?:^>[^\n]*(?:\n|$))+", body, re.MULTILINE):
                pieces.append("\n".join(re.sub(r"^> ?", "", line) for line in block.splitlines()).strip())
        else:
            pieces += [a.strip() for a in _QUESTION.split(body)[1:]]
    return [p for p in pieces if p]


def _cut(text: str, room: int) -> str:
    """`text`'s first paragraphs that fit in `room` characters, or, when the
    first doesn't fit, its first sentences that do."""
    def fit(parts: list[str], sep: str) -> str:
        kept = ""
        for part in parts:
            if len(joined := f"{kept}{sep}{part}" if kept else part) > room:
                break
            kept = joined
        return kept
    return fit(text.split("\n\n"), "\n\n") or fit(re.split(r"(?<=[.!?]) ", text), " ")


def pack(pieces: list[str]) -> list[str]:
    """`pieces` in at most MAX_SAMPLES samples of SAMPLE_MAX characters each, first fit."""
    samples: list[str] = []
    for piece in pieces:
        piece = piece if len(piece) <= SAMPLE_MAX else _cut(piece, SAMPLE_MAX)
        if not piece:
            continue
        at = next((i for i, s in enumerate(samples) if len(s) + 2 + len(piece) <= SAMPLE_MAX), None)
        if at is not None:
            samples[at] += "\n\n" + piece
        elif len(samples) < MAX_SAMPLES:
            samples.append(piece)
    return samples


async def set_samples(session: AsyncSession, applicant_id: uuid.UUID, apply_dir: Path) -> int:
    """Step 6 and the count of brought samples kept; 0 (and the student's samples kept) with no own words."""
    path = apply_dir / STORY_BANK
    samples = pack(own_pieces(path.read_text())) if path.is_file() else []
    if not samples:
        return 0
    rows = list(await session.scalars(
        select(Writing_Sample).where(Writing_Sample.applicant_id == applicant_id)
        .order_by(Writing_Sample.created_at, Writing_Sample.id)))
    if not any(r.imported for r in rows) and sorted(r.text for r in rows) == sorted(samples):
        for row in rows:  # brought before samples were marked: the same texts are the import's
            row.imported = True
        return len(samples)
    brought = [r for r in rows if r.imported]
    if sorted(r.text for r in brought) == sorted(samples):
        return len(samples)
    for old in brought:
        await writing.remove_sample(session, applicant_id, old.id)
    kept = 0
    for text in samples:
        try:
            await writing.add_sample(session, applicant_id, text, imported=True)
        except writing.TooMany:
            break
        kept += 1
    return kept


def style_card(voice: str) -> str:
    return re.sub(r"^\s*<!--.*?-->", "", voice, count=1, flags=re.DOTALL).strip()


async def set_style_card(session: AsyncSession, applicant_id: uuid.UUID, apply_dir: Path) -> str | None:
    """Step 7: None when saved, else why it was left out."""
    path = apply_dir / VOICE
    card = style_card(path.read_text()) if path.is_file() else ""
    if not card:
        return None if not path.is_file() else "style card left out: voice.md is empty"
    if len(card) > CARD_MAX:
        return f"style card left out: voice.md is over {CARD_MAX} characters"
    if not await writing.sample_texts(session, applicant_id):
        return "style card left out: no writing samples to go with it"
    await writing.save_style_card(session, applicant_id, card)
    return None


# --- 8. company briefs ---

def brief_sections(text: str) -> tuple[str, list[tuple[str, list[dict]]]]:
    """An Apply brief's company, and each section's team ("" for the company's) and facts."""
    company = (re.search(r"^# (.+)$", text, re.MULTILINE) or [None, ""])[1].strip()
    parts = re.split(r"^## (.+)$", text, flags=re.MULTILINE)
    sections = []
    for heading, body in zip(parts[1::2], parts[2::2]):
        heading = heading.strip()
        team = heading[len("Team:"):].strip().strip("\"'“”") if heading.casefold().startswith("team:") else ""
        if heading.casefold() != "company" and not team:
            continue  # `Team: ""`, a posting that names no team
        facts = []
        for m in _FACT.finditer(body):
            month = re.search(r"\b\d{4}-\d{2}\b", m["note"] or "")
            facts.append({"name": m["name"].strip(), "fact": m["fact"].strip(), "url": m["url"],
                          "published": month.group() if month else None})
        sections.append((team, facts))
    return company, sections


def _category(fact: dict, team: str) -> str:
    """Apply keeps no category: a team's fact is `team`, a dated one a launch,
    one from an engineering page `engineering`, else a product."""
    if team:
        return "team"
    if fact["published"]:
        return "launches"
    return "engineering" if "engineering" in fact["url"].lower() else "products"


def find_quote(page: str, name: str, fact: str) -> str | None:
    """The sentence on `page` that names `name` and holds every number in
    `fact`, the one sharing most words with `fact`; None when none does."""
    needs = briefs._numbers(fact)
    named = briefs.plain(name)
    words = set(briefs.plain(fact).split())
    found = [
        s.strip() for s in _SENTENCE.split(page)
        if f" {named} " in f" {briefs.plain(s)} " and needs <= briefs._numbers(s)
        and briefs.QUOTE_WORDS <= len(briefs.plain(s).split()) <= _LONGEST_QUOTE
    ]
    return max(found, key=lambda s: len(words & set(briefs.plain(s).split())), default=None)


async def _quoted(company: str, facts: list[dict], team: str, websites: list[str]) -> tuple[list[dict], int]:
    """WorkIt's fact shape, with the quote from its page; and how many have none."""
    def allowed(host: str) -> bool:
        return briefs.own_domain(host, company, websites) or briefs.news_site(host)

    pages: dict[str, str | None] = {}
    out, unquoted = [], 0
    for fact in facts:
        url = fact["url"]
        host = (re.match(r"^https?://([^/:?#]+)", url) or [None, ""])[1]
        if url not in pages and host and allowed(host):
            try:
                pages[url] = await briefs.fetch_page(url, allowed)
            except Unreadable:
                pages[url] = None
        if host and allowed(host):
            quote = find_quote(pages.get(url) or "", fact["name"], fact["fact"])
            if quote is None:
                unquoted += 1
                continue
        else:
            quote = ""  # not the company's own site or a news site: the check drops it as such
        out.append({"category": _category(fact, team), "fact": fact["fact"], "url": url, "quote": quote,
                    "published": fact["published"] or "", "team": team or None})
    return out, unquoted


async def _websites(session: AsyncSession, key: str) -> list[str]:
    rows = await session.execute(select(Company_Profile.company_name, Company_Profile.website_url)
                                 .where(Company_Profile.website_url.is_not(None)))
    return [site for name, site in rows if name and briefs.company_key(name) == key]


async def _listed(session: AsyncSession) -> set[str]:
    """The company keys WorkIt's postings and companies go by."""
    names = await session.scalars(select(Job_Post.company_name).distinct()
                                  .union(select(Company_Profile.company_name)))
    return {briefs.company_key(n) for n in names if n}


async def set_briefs(session: AsyncSession, apply_dir: Path) -> list[dict]:
    """Step 8: per section, {company, team, kept, dropped, saved, listed}:
    listed is whether a WorkIt posting or company goes by its key (else
    the brief is kept for a posting yet to come under that name)."""
    folder = apply_dir / BRIEFS
    report: list[dict] = []
    today = datetime.datetime.now(datetime.UTC).date()
    listed = await _listed(session) if folder.is_dir() else set()
    for path in sorted(folder.glob("*.md")) if folder.is_dir() else []:
        company, sections = brief_sections(path.read_text())
        key = briefs.company_key(company)
        if not key:
            continue
        websites = await _websites(session, key)
        for team, facts in sections:
            quoted, unquoted = await _quoted(company, facts, team, websites)
            kept, dropped = await briefs.check(company, quoted, today, websites) if quoted else ([], [])
            tkey = briefs.team_key(team) if team else ""
            row = await session.get(Company_Brief, (key, tkey))
            current = briefs.score(row.facts, today) if row is not None and row.saved_at else 0
            saved = (len(kept) >= (briefs.MIN_TEAM_FACTS if tkey else briefs.MIN_FACTS)
                     and briefs.score(kept, today) > current)
            if saved:
                await session.execute(
                    insert(Company_Brief).values(company_key=key, team=tkey, company=company, facts=kept,
                                                 saved_at=func.now(), attempted_at=None)
                    .on_conflict_do_update(index_elements=["company_key", "team"], set_={
                        "company": company, "facts": kept, "saved_at": func.now(), "attempted_at": None,
                    }))
            report.append({"company": company, "team": team or None, "kept": len(kept),
                           "dropped": len(dropped) + unquoted, "saved": saved,
                           "listed": key in listed})
    return report
