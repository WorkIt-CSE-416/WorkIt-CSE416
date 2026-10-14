"""
Tailor (KAN-217): proposals that fit a built resume to one job posting, and
the rules Done saves them by. Like services/bank.py, functions that touch
rows take the caller's session, scope to the applicant, flush and never
commit; the rest are pure.

A run (`routers/tailor.py`) reads the posting's keywords (KAN-215's cache, or
one extraction), ranks the bank's bullets against the posting with Postgres
text search (`rank_bullets`), and sends the model the posting and the bank
(`prompt`): no links, and the model seam removes identity data. The model
names bullets and entries by handle (b1, e1), never by id. `propose` turns its
reply into changes, dropping any wording that breaks the truth rule
(`services/truth_rule.py`), and adds what code can find alone: bank skills
left off the resume that match a keyword, and the ranked bullet order.

Tailor changes only what shows, the order, which bullet variant shows and
which skills show; it never writes the bank's text. A missing keyword that
is nowhere in the bank becomes a question ("Have you used X?"), never words.
"""

import dataclasses
import uuid
from collections.abc import Iterable, Mapping, Sequence

from sqlalchemy import Text, cast, func, select
from sqlalchemy.dialects.postgresql import TSQUERY
from sqlalchemy.ext.asyncio import AsyncSession
from workit_scout.identity import placeholders_in

from app.models.bank import Bank_Bullet, Bank_Bullet_Variant, Bank_Entry
from app.models.jobs import Job_Post
from app.schemas.keywords import Keyword
from app.schemas.tailor import TailorChange, TailorReading
from app.services import keywords as kw
from app.services.bank import Bank, Entry, NotFound
from app.services.resume_view import (
    BulletChoice,
    Choices,
    EntryChoice,
    SkillChoice,
    all_chosen,
    build_view,
)
from app.services.truth_rule import invented

# The model sees at most this many bullets, the best-ranked first, so a big
# bank keeps the prompt small.
MAX_BULLETS = 40
MAX_REWORDS = 6
MAX_TEXT = 500

# One frozen string, so providers can cache it as a prefix.
PROMPT = """\
You tailor a student's resume to one job posting. You may only rephrase \
facts the student gave: never add a number, tool, skill or result that the \
bullet or the student's skills do not already hold. Answer with JSON only: \
{"rewords": [{"bullet": "b1", "text": ...}], "add_entries": ["e2"]}.

- rewords: at most 6 bullets the posting cares about, reworded to use the \
posting's words where the bullet already supports them. One line each, \
under 200 characters, starting with a strong verb. Leave out a bullet that \
already fits.
- add_entries: entries marked "not on the resume" worth bringing back for \
this posting.
- Use only the handles given (b1, e1).
"""


def posting_text(job: Job_Post, keywords: Sequence[Keyword]) -> str:
    """What the bullets are ranked against: the title, the keywords and the
    description (only the title and keywords when it has none)."""
    words = " ".join(k.keyword for k in keywords)
    return f"{job.title} {words} {(job.description or '')[: kw.MAX_DESCRIPTION_CHARS]}"


def weak_match(job: Job_Post) -> bool:
    return not (job.description or "").strip()


async def rank_bullets(session: AsyncSession, applicant_id: uuid.UUID, text: str) -> dict[uuid.UUID, float]:
    """Each of the applicant's bullets with its text-search rank against
    `text`. The posting's words are OR'd (plainto_tsquery ANDs them, which
    no bullet would match), so a bullet ranks by how many it shares."""
    query = cast(func.replace(cast(func.plainto_tsquery("english", text), Text), "&", "|"), TSQUERY)
    rows = await session.execute(
        select(Bank_Bullet.id, func.ts_rank(func.to_tsvector("english", Bank_Bullet.text), query))
        .join(Bank_Entry, Bank_Entry.id == Bank_Bullet.entry_id)
        .where(Bank_Entry.applicant_id == applicant_id)
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


def prompt(
    job: Job_Post, keywords: Sequence[Keyword], bank: Bank, choices: Choices, ranks: Mapping[uuid.UUID, float]
) -> list[dict[str, str]]:
    """The posting and the bank, with no links: an entry's link field is left
    out, and the model seam replaces any URL left in the text."""
    named = {v: k for k, v in handles(bank).items()}
    every = [b for e in bank.entries for b in e.bullets]
    best = set(sorted((b.id for b in every), key=lambda i: -ranks.get(i, 0.0))[:MAX_BULLETS])
    lines = []
    for entry in bank.entries:
        row = entry.row
        where = "on the resume" if _shown(choices.entries, row.id) else "not on the resume"
        title = ", ".join(p for p in (row.title, row.organization) if p)
        lines.append(f"{named[row.id]} [{row.section}] {title} ({where})")
        for bullet in entry.bullets:
            if bullet.id in best:
                shows = choices.bullets.get(bullet.id)
                lines.append(f"  {named[bullet.id]}: {(shows and shows.text) or bullet.text}")
    description = (job.description or "").strip()[: kw.MAX_DESCRIPTION_CHARS] or "(No description: only the title.)"
    words = ", ".join(f"{k.keyword} ({k.kind})" for k in keywords) or "(none)"
    skills = ", ".join(s.name for s in bank.skills) or "(none)"
    user = (
        f"Job posting: {job.title}\n\n{description}\n\nKeywords: {words}\n\n"
        f"The student's skills: {skills}\n\nThe student's entries:\n" + "\n".join(lines)
    )
    return [{"role": "system", "content": PROMPT}, {"role": "user", "content": user}]


def _next(positions: Iterable[int]) -> int:
    return max(positions, default=-1) + 1


def _same_as(row: Bank_Entry) -> tuple[str, str, str]:
    """What makes two entries the same job to a reader: section, title and
    organization, ignoring case, as the bank's own duplicate check."""
    return (str(row.section), row.title.strip().lower(), (row.organization or "").strip().lower())


def _label(row: Bank_Entry) -> str:
    """An entry as a change names it: two jobs can share a title."""
    return ", ".join(p for p in (row.title, row.organization) if p)


def _bring_back(bank: Bank, entries: dict[uuid.UUID, EntryChoice], entry: Entry) -> None:
    """Show the entry at its date-order place among its section's shown
    entries (the bank lists newest first), keeping the order the student set
    for the rest. Added last, a newer job showed below an older one."""
    me = entry.row.id
    section = [e.row.id for e in bank.entries if e.row.section == entry.row.section]
    shown = sorted((i for i in section if i != me and _shown(entries, i)), key=lambda i: entries[i].position)
    later = set(section[section.index(me) + 1:])
    at = next((n for n, i in enumerate(shown) if i in later), len(shown))
    entries[me] = dataclasses.replace(entries.get(me, EntryChoice()), shown=True)
    for n, i in enumerate([*shown[:at], me, *shown[at:]]):
        entries[i] = dataclasses.replace(entries[i], position=n)


def with_changes(
    bank: Bank,
    choices: Choices,
    changes: Sequence[TailorChange],
    variant_ids: Mapping[uuid.UUID, uuid.UUID] | None = None,
) -> Choices:
    """`choices` with the changes applied, pure. An entry brought back takes
    its date-order place in its section (`_bring_back`) with all its bullets;
    a reworded bullet shows the change's text (and `variant_ids[bullet]`,
    once saved)."""
    entries, bullets, skills = dict(choices.entries), dict(choices.bullets), dict(choices.skills)
    by_id = {e.row.id: e for e in bank.entries}
    ordered = sorted(changes, key=lambda c: c.kind != "show_entry")
    for change in ordered:
        if change.kind == "show_entry" and change.entry_id in by_id:
            entry = by_id[change.entry_id]
            if not _shown(entries, entry.row.id):
                _bring_back(bank, entries, entry)
                for i, bullet in enumerate(entry.bullets):
                    if not _shown(bullets, bullet.id):
                        bullets[bullet.id] = dataclasses.replace(
                            bullets.get(bullet.id, BulletChoice()), shown=True, position=i)
        elif change.kind == "reword" and change.bullet_id is not None:
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


def match(bank: Bank, choices: Choices, keywords: Sequence[Keyword]) -> tuple[list[Keyword], list[Keyword]]:
    return kw.match(build_view(bank, choices), list(keywords))


def questions(bank: Bank, keywords: Sequence[Keyword], missing: Sequence[Keyword]) -> list[Keyword]:
    """The missing keywords that are nowhere in the bank: "Have you used X?"."""
    _, nowhere = match(bank, all_chosen(bank), keywords)
    absent = {k.keyword for k in nowhere}
    return [k for k in missing if k.keyword in absent]


def _clean(text: str | None) -> str:
    return " ".join((text or "").split())[:MAX_TEXT]


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
    """(changes, how many wordings the truth rule dropped)."""
    ids = handles(bank)
    entries = {e.row.id: e for e in bank.entries}
    bullet_entry = {b.id: e.row.id for e in bank.entries for b in e.bullets}
    originals = {b.id: b.text for e in bank.entries for b in e.bullets}
    changes: list[TailorChange] = []
    dropped = 0

    # A left-out copy of an entry the resume shows (an import saved "as
    # new") is never offered: it showed the same job twice.
    showing = {_same_as(e.row) for e in bank.entries if _shown(choices.entries, e.row.id)}
    brought: list[uuid.UUID] = []
    for handle in reading.add_entries:
        entry_id = ids.get(handle.strip())
        if entry_id not in entries or _shown(choices.entries, entry_id) or entry_id in brought:
            continue
        if _same_as(entries[entry_id].row) in showing:
            continue
        showing.add(_same_as(entries[entry_id].row))
        brought.append(entry_id)
        changes.append(TailorChange(kind="show_entry", entry_id=entry_id, label=_label(entries[entry_id].row)))

    reworded: set[uuid.UUID] = set()
    for item in reading.rewords:
        bullet_id = ids.get(item.bullet.strip())
        if bullet_id not in originals or bullet_id in reworded or len(reworded) >= MAX_REWORDS:
            continue
        if not (_shown(choices.bullets, bullet_id) or bullet_entry[bullet_id] in brought):
            continue
        text = _clean(item.text)
        current = choices.bullets.get(bullet_id)
        if not text or text.casefold() == ((current and current.text) or originals[bullet_id]).casefold():
            continue
        if check_wording(bank, bullet_id, text, keywords):
            dropped += 1
            continue
        reworded.add(bullet_id)
        changes.append(TailorChange(kind="reword", bullet_id=bullet_id, text=text, original=originals[bullet_id]))

    for skill in bank.skills:
        if not _shown(choices.skills, skill.id):
            changes.append(TailorChange(kind="show_skill", skill_id=skill.id, label=skill.name))

    for entry in bank.entries:
        shown = sorted((b.id for b in entry.bullets if _shown(choices.bullets, b.id)),
                       key=lambda b: choices.bullets[b].position)
        best = sorted(shown, key=lambda b: -ranks.get(b, 0.0))
        if len(shown) > 1 and best != shown and _shown(choices.entries, entry.row.id):
            changes.append(TailorChange(kind="order", entry_id=entry.row.id, bullet_ids=best, label=_label(entry.row)))

    before = {k.keyword for k in match(bank, choices, keywords)[0]}
    for change in changes:
        after = match(bank, with_changes(bank, choices, [change]), keywords)[0]
        change.keywords = [k.keyword for k in after if k.keyword not in before]
    # A skill earns a place only by matching a keyword.
    changes = [c for c in changes if c.kind != "show_skill" or c.keywords]
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
        if c.kind in ("show_entry", "order") and c.entry_id not in entries:
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
