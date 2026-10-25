"""
Tailor (KAN-217): proposals that fit a built resume to one job posting, and
the rules Done saves them by. Like services/bank.py, functions that touch
rows take the caller's session, scope to the applicant, flush and never
commit; the rest are pure.

The source is the resume the student picked: a built resume's choices, or an
uploaded resume shown as the entries and skills it owns (`upload_source`,
ADR 0005), built in memory and never saved. A run tailors only what
that resume shows (`on_resume`): its entries and their bullets, never an entry
or bullet it hides. Skills are the exception: every bank skill stays in, so
the truth rule reads them all. A run never proposes a hidden skill: a missing
keyword is asked about ("Have you used X?"), and Yes adds it (`show_skill`).

A run (`routers/tailor.py`) reads the posting's keywords (KAN-215's cache, or
one extraction), ranks the resume's bullets against the posting with Postgres
text search (`rank_bullets`), and sends the model the posting and every
bullet the resume shows, the lowest-ranked left out past a token budget
(`prompt`): no links, and the model seam removes identity data. The model
names bullets by handle (b1), never by id. `propose` turns its reply into
changes, dropping any wording that breaks the truth rule
(`services/truth_rule.py`), and adds what code can find alone: bank skills
left off the resume that match a keyword, and the ranked bullet order.

Tailor changes only what shows, the order, which bullet variant shows and
which skills show; it never writes the bank's text. A missing keyword that
is nowhere in the bank becomes a question ("Have you used X?"), never words.
"""

import dataclasses
import re
import uuid
from collections.abc import Iterable, Mapping, Sequence

from sqlalchemy import Text, cast, func, select
from sqlalchemy.dialects.postgresql import TSQUERY
from sqlalchemy.ext.asyncio import AsyncSession
from workit_scout.identity import placeholders_in

from app.models.bank import Bank_Bullet, Bank_Bullet_Variant, Bank_Entry
from app.models.jobs import Job_Post
from app.models.resume import Resume
from app.schemas.keywords import Keyword
from app.schemas.tailor import TailorChange, TailorReading
from app.services import bank_import
from app.services import keywords as kw
from app.services.bank import (
    Bank,
    Entry,
    NotFound,
    import_upload,
    load_bank,
)
from app.services.matching.embeddings import job_part
from app.services.resume_view import (
    BulletChoice,
    Choices,
    SkillChoice,
    all_chosen,
    build_view,
)
from app.services.truth_rule import invented

MAX_TEXT = 500

# Sized to the chain's smallest room, Groq's free tier: 8,000 tokens a minute
# for gpt-oss-120b, prompt and reply (reasoning included) together. A prompt
# over its budget loses its lowest-ranked bullets; a provider that still finds
# it too large passes it down the chain (Scout's `RequestTooLarge`).
PROMPT_TOKENS = 5_000
REPLY_TOKENS = 3_000
# English runs about four characters a token; an estimate, never a count.
CHARS_PER_TOKEN = 4

# One frozen string, so providers can cache it as a prefix.
PROMPT = """\
You tailor a student's resume to one job posting. You may rephrase \
facts the student gave or understand the job requirements and rewrite the experience based on the job description: \
never add a number or result that the \
bullet or the student's skills do not already hold. \
You can add skill or tool that's needed from job and relevant to the student's experience into the bullet point. \
Answer with JSON only: \
{"rewords": [{"bullet": "b1", "text": ...}]}.

- rewords: understand the type of bullets the posting cares about, use the given keyword match list, reworded to use the \
posting's words where the bullet's experience supports them. One line each, \
under 200 characters, starting with a strong verb. No need to rewrite a bullet that \
already fits.
- Use only the bullet handles given such as (b1).
"""


def posting_text(job: Job_Post, keywords: Sequence[Keyword]) -> str:
    """What the bullets are ranked against: the title, the keywords and the
    description's job sections (`job_part`; only the title and keywords when it
    has none)."""
    words = " ".join(k.keyword for k in keywords)
    return f"{job.title} {words} {job_part(job.description)[: kw.MAX_DESCRIPTION_CHARS]}"


def weak_match(job: Job_Post) -> bool:
    return not (job.description or "").strip()


async def rank_bullets(session: AsyncSession, bank: Bank, text: str) -> dict[uuid.UUID, float]:
    '''
    bring all entries, format the job description + title into one 
    '''
    ids = [b.id for e in bank.entries for b in e.bullets]
    if not ids:
        return {}
    # reformat the input job posting string 
    query = cast(func.replace(cast(func.plainto_tsquery("english", text), Text), "&", "|"), TSQUERY)
    rows = await session.execute(
        select(Bank_Bullet.id, func.ts_rank(func.to_tsvector("english", Bank_Bullet.text), query))
        .where(Bank_Bullet.id.in_(ids))
    )
    return {bullet_id: float(rank) for bullet_id, rank in rows}


def handles(bank: Bank) -> dict[str, uuid.UUID]:
    """e1.. for entries and b1.. for bullets, in bank order."""
    out: dict[str, uuid.UUID] = {}
    n = 0
    for i, entry in enumerate(bank.entries, 1):
        out[f"e{i}"] = entry.row.id
        for bullet in entry.bullets:
            n += 1
            out[f"b{n}"] = bullet.id
    return out


def _shown(choices: Mapping[uuid.UUID, object], item_id: uuid.UUID) -> bool:
    choice = choices.get(item_id)
    return choice is not None and choice.shown  # type: ignore[attr-defined]


def on_resume(bank: Bank, choices: Choices) -> Bank:
    """`bank` cut to what the resume shows: its shown entries, each with its
    shown bullets, and every skill. A run reads this, never the whole bank,
    so it tailors the picked resume and adds no entry the student left off."""
    entries = [
        Entry(e.row, [b for b in e.bullets if _shown(choices.bullets, b.id)])
        for e in bank.entries
        if _shown(choices.entries, e.row.id)
    ]
    return Bank(entries=entries, skills=bank.skills)


def prompt(
    job: Job_Post, keywords: Sequence[Keyword], bank: Bank, choices: Choices, ranks: Mapping[uuid.UUID, float]
) -> list[dict[str, str]]:
    """Create a central prompt with job posting, extracted keywords and every
    bullet the resume shows, in the wording it shows. Over `PROMPT_TOKENS`,
    the lowest-ranked bullets are left out until it fits (`ranks`, ties
    leaving the latest in bank order first); their entries stay."""
    named = {v: k for k, v in handles(bank).items()}
    shown = {}
    for entry in bank.entries:
        for bullet in entry.bullets:
            shows = choices.bullets.get(bullet.id)
            shown[bullet.id] = f"  {named[bullet.id]}: {(shows and shows.text) or bullet.text}"
    description = (
        job_part(job.description, keep_headings=True).strip()[: kw.MAX_DESCRIPTION_CHARS]
        or "(No description: only the title.)"
    )
    words = ", ".join(f"{k.keyword} ({k.kind})" for k in keywords) or "(none)"
    skills = ", ".join(s.name for s in bank.skills) or "(none)"
    head = (
        f"Job posting: {job.title}\n\n{description}\n\nKeywords: {words}\n\n"
        f"The student's skills: {skills}\n\nThe resume's entries:\n"
    )
    entries = {e.row.id: f"{named[e.row.id]} [{e.row.section}] {_label(e.row)}" for e in bank.entries}

    room = PROMPT_TOKENS * CHARS_PER_TOKEN - len(PROMPT) - len(head) - sum(len(t) + 1 for t in entries.values())
    kept = sorted(shown, key=lambda i: -ranks.get(i, 0.0))
    used = sum(len(t) + 1 for t in shown.values())
    while kept and used > room:
        used -= len(shown[kept.pop()]) + 1
    keep = set(kept)

    lines = []
    for entry in bank.entries:
        lines.append(entries[entry.row.id])
        lines += [shown[b.id] for b in entry.bullets if b.id in keep]
    return [{"role": "system", "content": PROMPT}, {"role": "user", "content": head + "\n".join(lines)}]


def _next(positions: Iterable[int]) -> int:
    return max(positions, default=-1) + 1


def _label(row: Bank_Entry) -> str:
    """An entry as a change names it: two jobs can share a title."""
    return ", ".join(p for p in (row.title, row.organization) if p)


def with_changes(
    bank: Bank,
    choices: Choices,
    changes: Sequence[TailorChange],
    variant_ids: Mapping[uuid.UUID, uuid.UUID] | None = None,
) -> Choices:
    """`choices` with the changes applied, pure. A reworded bullet shows the
    change's text (and `variant_ids[bullet]`, once saved)."""
    entries, bullets, skills = dict(choices.entries), dict(choices.bullets), dict(choices.skills)
    by_id = {e.row.id: e for e in bank.entries}
    for change in changes:
        if change.kind == "reword" and change.bullet_id is not None:
            old = bullets.get(change.bullet_id, BulletChoice(position=_next(c.position for c in bullets.values())))
            bullets[change.bullet_id] = dataclasses.replace(
                old, variant_id=(variant_ids or {}).get(change.bullet_id), text=change.text)
        elif change.kind == "show_skill" and change.skill_id is not None:
            old = skills.get(change.skill_id)
            position = old.position if old else _next(c.position for c in skills.values())
            skills[change.skill_id] = SkillChoice(shown=True, position=position)
        elif change.kind == "order" and change.entry_id in by_id:
            listed = [b for b in change.bullet_ids if b in bullets]
            rest = sorted((b.id for b in by_id[change.entry_id].bullets if b.id in bullets and b.id not in listed),
                          key=lambda b: bullets[b].position)
            for i, bullet_id in enumerate([*listed, *rest]):
                bullets[bullet_id] = dataclasses.replace(bullets[bullet_id], position=i)
    return Choices(entries, bullets, skills)


class NothingRead(Exception):
    """The upload has no text, or the parser read no entry or skill from it."""


def upload_choices(bank: Bank, resume_id: uuid.UUID) -> Choices:
    """A resume of the entries (with all their bullets) and skills the upload
    owns, pure. Every other entry and skill waits hidden, as Generate leaves a
    copy: a run leaves them out."""
    chosen = all_chosen(bank)
    owned = {e.row.id for e in bank.entries if e.row.resume_id == resume_id}
    owned |= {s.id for s in bank.skills if s.resume_id == resume_id}
    entries = {i: c if i in owned else dataclasses.replace(c, shown=False) for i, c in chosen.entries.items()}
    skills = {i: c if i in owned else dataclasses.replace(c, shown=False) for i, c in chosen.skills.items()}
    return Choices(entries, chosen.bullets, skills)


async def upload_source(session: AsyncSession, applicant_id: uuid.UUID, resume_id: uuid.UUID) -> Choices:
    """An uploaded resume as a Tailor source: the entries and skills it owns
    (ADR 0005). An upload that owns nothing (one from before ADR 0005, or
    one whose entries the student deleted) is read into the bank first, as
    Import Again reads it; one that owns something is never read again,
    since a reading replaces what it owns and would drop it from the
    tailored resume. Run and Done both call it, so Done rebuilds what the run
    proposed against. Flushes, never commits. Raises NotFound for another
    applicant's upload, NothingRead when it owns nothing and its reading
    finds nothing."""
    resume = await session.scalar(select(Resume).where(Resume.id == resume_id, Resume.applicant_id == applicant_id))
    if resume is None:
        raise NotFound
    bank = await load_bank(session, applicant_id)
    if not any(e.row.resume_id == resume.id for e in bank.entries) and not any(
        s.resume_id == resume.id for s in bank.skills
    ):
        drafts, skills = bank_import.read(resume.raw_text)
        if not drafts and not skills:
            raise NothingRead
        await import_upload(session, applicant_id, resume.id, drafts, skills)
        bank = await load_bank(session, applicant_id)
    return upload_choices(bank, resume.id)


def match(bank: Bank, choices: Choices, keywords: Sequence[Keyword]) -> tuple[list[Keyword], list[Keyword]]:
    return kw.match(build_view(bank, choices), list(keywords))


def _clean(text: str | None) -> str:
    return " ".join((text or "").split())[:MAX_TEXT]


_WORD = re.compile(r"[a-z0-9][a-z0-9+#]*")
_SMALL = frozenset(["and", "for", "from", "into", "the", "via", "with", "using", "onto", "over"])


def _words(text: str) -> set[str]:
    return {w for w in _WORD.findall(text.lower()) if len(w) > 2 and w not in _SMALL}


def _same_word(a: str, b: str) -> bool:
    short, long = sorted((a, b), key=len)
    return short == long or (len(short) >= 4 and long.startswith(short))


def keeps_its_bullet(text: str, original: str) -> bool:
    """Whether a rewording still says what its bullet says: at least a third
    of the original's words (three letters or more) are in it, a shared start
    of four letters counting ("data", "datasets"). A model that copies the
    wrong handle puts another bullet's rewording here, which shares almost
    none, and the truth rule passes it when it adds no number or tool."""
    old, new = _words(original), _words(text)
    shared = sum(1 for w in old if any(_same_word(w, n) for n in new))
    return shared * 3 >= len(old)


def check_wording(bank: Bank, bullet_id: uuid.UUID, text: str, keywords: Sequence[Keyword]) -> list[str]:
    """The facts `text` invents for the bullet (empty: it keeps the truth
    rule). An identity placeholder the model echoed counts as one."""
    original = next(b.text for e in bank.entries for b in e.bullets if b.id == bullet_id)
    found = invented(text, original, [s.name for s in bank.skills], tools=[k.keyword for k in keywords])
    return found + placeholders_in(text)


def propose(
    bank: Bank,
    choices: Choices,
    reading: TailorReading,
    ranks: Mapping[uuid.UUID, float],
    keywords: Sequence[Keyword],
) -> tuple[list[TailorChange], int]:
    """(changes, how many wordings the truth rule dropped). `bank` is
    `on_resume`'s, so every entry and bullet in it shows."""
    ids = handles(bank)
    originals = {b.id: b.text for e in bank.entries for b in e.bullets}
    changes: list[TailorChange] = []
    dropped = 0

    reworded: set[uuid.UUID] = set()
    for item in reading.rewords:
        bullet_id = ids.get(item.bullet.strip())
        if bullet_id not in originals or bullet_id in reworded:
            continue
        text = _clean(item.text)
        current = choices.bullets.get(bullet_id)
        if not text or text.casefold() == ((current and current.text) or originals[bullet_id]).casefold():
            continue
        if check_wording(bank, bullet_id, text, keywords) or not keeps_its_bullet(text, originals[bullet_id]):
            dropped += 1
            continue
        reworded.add(bullet_id)
        changes.append(TailorChange(kind="reword", bullet_id=bullet_id, text=text, original=originals[bullet_id]))

    for entry in bank.entries:
        shown = sorted((b.id for b in entry.bullets), key=lambda b: choices.bullets[b].position)
        best = sorted(shown, key=lambda b: -ranks.get(b, 0.0))
        if len(shown) > 1 and best != shown:
            changes.append(TailorChange(kind="order", entry_id=entry.row.id, bullet_ids=best, label=_label(entry.row)))
    return changes, dropped


def validate(bank: Bank, changes: Sequence[TailorChange]) -> None:
    """Raise NotFound for any id that is not in this applicant's bank, or a
    bullet ordered under another entry."""
    entries = {e.row.id: {b.id for b in e.bullets} for e in bank.entries}
    bullets = {b for ids in entries.values() for b in ids}
    skills = {s.id for s in bank.skills}
    for c in changes:
        if c.kind == "reword" and c.bullet_id not in bullets:
            raise NotFound
        if c.kind == "order" and c.entry_id not in entries:
            raise NotFound
        if c.kind == "show_skill" and c.skill_id not in skills:
            raise NotFound
        if c.kind == "order" and not set(c.bullet_ids) <= entries[c.entry_id]:  # type: ignore[index]
            raise NotFound


class BreaksTruthRule(Exception):
    def __init__(self, facts: list[str]) -> None:
        self.facts = facts
        super().__init__(f"This wording adds what your bank does not say: {', '.join(facts)}.")


async def save_variants(
    session: AsyncSession,
    bank: Bank,
    posting_id: uuid.UUID,
    changes: Sequence[TailorChange],
    keywords: Sequence[Keyword],
) -> dict[uuid.UUID, uuid.UUID]:
    """Each accepted wording as a bullet variant for the posting, checked
    against the truth rule again (the browser could send anything). The same
    wording for the same bullet reuses its variant, whichever posting made
    it. Returns bullet id -> variant id."""
    out: dict[uuid.UUID, uuid.UUID] = {}
    for change in changes:
        if change.kind != "reword" or change.bullet_id is None:
            continue
        change.text = _clean(change.text)
        if not change.text:
            raise BreaksTruthRule(["an empty line"])
        facts = check_wording(bank, change.bullet_id, change.text, keywords)
        if facts:
            raise BreaksTruthRule(facts)
        variant = await session.scalar(
            select(Bank_Bullet_Variant).where(
                Bank_Bullet_Variant.bullet_id == change.bullet_id,
                Bank_Bullet_Variant.built_resume_id.is_(None),
                Bank_Bullet_Variant.text == change.text,
            ).limit(1)
        )
        if variant is None:
            variant = Bank_Bullet_Variant(
                id=uuid.uuid4(), bullet_id=change.bullet_id, text=change.text, job_posting_id=posting_id)
            session.add(variant)
        out[change.bullet_id] = variant.id
    await session.flush()
    return out
