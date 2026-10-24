"""
The experience bank service (KAN-206): every read and write of a student's
entries, bullets and skills goes through here, so the rules live in one
place:

- Every function takes the applicant id and touches only that applicant's
  rows. A row of another applicant answers `NotFound`, the same as a missing
  one, so ids cannot be probed.
- Every create, edit or delete of an entry, bullet or skill clears the bank
  embedding (`clear_embedding`), so the next recommendations request remakes
  it. A later bullet-variant change must not call it: variants never reach
  the embedding.
- The duplicate check (`find_duplicate`) matches section, title and
  organization, ignoring case. Intake uses it to flag a draft; import
  (`merge_import`) merges into the entry it finds.
- A source (KAN-343, docs/bank_by_resume.md) says an upload's import found
  an entry or skill. Only `merge_import` writes one, for everything the
  reading found, merged or not; Import Updated Resume clears the old ones
  first (`clear_sources`). Sources do not clear the embedding: its text
  never names a resume.
- Functions flush but never commit: the caller owns the transaction, so an
  import can save many entries in one.

The session is handed in by the caller; this module opens no connection.
"""

import datetime
import uuid
from collections.abc import Mapping, Sequence
from dataclasses import dataclass

from pydantic import ValidationError
from sqlalchemy import delete, func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.bank import (
    Bank_Bullet,
    Bank_Entry,
    Bank_Entry_Source,
    Bank_Skill,
    Bank_Skill_Source,
    Experience_Bank,
)
from app.models.built_resume import Built_Resume, Built_Resume_Entry, Built_Resume_Skill
from app.models.dto import bank_section, entry_end_kind
from app.models.jobs import Job_Post
from app.models.profiles import Applicant_Profile
from app.models.resume import Resume
from app.schemas.bank import (
    BankResponse,
    BankResume,
    BulletResponse,
    EntryCreate,
    EntryFields,
    EntryResponse,
    SkillResponse,
)


class NotFound(Exception):
    """No such row in this applicant's bank."""


class DuplicateEntryError(Exception):
    """A new entry matches one already in the bank."""

    def __init__(self, existing: "Entry") -> None:
        super().__init__("This looks like an entry already in your bank")
        self.existing = existing


class DuplicateSkillError(Exception):
    """The bank already has a skill of that name, ignoring case."""


@dataclass
class Entry:
    """An entry row with its bullets in order."""

    row: Bank_Entry
    bullets: list[Bank_Bullet]


@dataclass
class Bank:
    """A whole bank, ordered the way every screen and resume reads it:
    entries in section order, ongoing first and then newest; skills by
    group, then name."""

    entries: list[Entry]
    skills: list[Bank_Skill]


_SECTION_ORDER = {section: i for i, section in enumerate(bank_section)}


def copy_key(entry: Bank_Entry) -> tuple:
    """What makes two entries copies of one: the section, title and
    organization (ignoring case and spaces, as `find_duplicate`) and the same
    months. An import saved "as new" leaves copies; two stints of one job at
    one company, in other months, are two entries. Generate, Tailor and
    intake's bank match all read copies through this."""
    return (
        str(entry.section),
        entry.title.strip().lower(),
        (entry.organization or "").strip().lower(),
        entry.start_month,
        entry.end_month,
    )


def _newest_first(entry: Bank_Entry) -> tuple:
    # Python sorts ascending, so dates sort by their negated ordinal and a
    # missing date (0) goes after every real one.
    def back(day: datetime.date | None) -> int:
        return -day.toordinal() if day else 0

    return (
        _SECTION_ORDER[entry.section],
        entry.end_kind is not entry_end_kind.present,
        back(entry.end_month or entry.award_date),
        back(entry.start_month),
        -entry.created_at.timestamp(),
    )


async def clear_embedding(session: AsyncSession, applicant_id: uuid.UUID) -> None:
    """Mark the bank embedding stale, making the bank row on first use."""
    stmt = insert(Experience_Bank).values(applicant_id=applicant_id, embedding=None, embedded_at=None)
    await session.execute(
        stmt.on_conflict_do_update(
            index_elements=[Experience_Bank.applicant_id],
            set_={"embedding": None, "embedded_at": None, "updated_at": func.now()},
        )
    )


async def _bullets_of(session: AsyncSession, entry_ids: Sequence[uuid.UUID]) -> dict[uuid.UUID, list[Bank_Bullet]]:
    rows = await session.scalars(
        select(Bank_Bullet)
        .where(Bank_Bullet.entry_id.in_(entry_ids))
        .order_by(Bank_Bullet.entry_id, Bank_Bullet.position, Bank_Bullet.created_at)
    )
    out: dict[uuid.UUID, list[Bank_Bullet]] = {i: [] for i in entry_ids}
    for bullet in rows:
        out[bullet.entry_id].append(bullet)
    return out


async def load_bank(session: AsyncSession, applicant_id: uuid.UUID) -> Bank:
    rows = list(await session.scalars(select(Bank_Entry).where(Bank_Entry.applicant_id == applicant_id)))
    rows.sort(key=_newest_first)
    bullets = await _bullets_of(session, [r.id for r in rows]) if rows else {}
    skills = await session.scalars(
        select(Bank_Skill)
        .where(Bank_Skill.applicant_id == applicant_id)
        .order_by(Bank_Skill.group.asc().nulls_last(), func.lower(Bank_Skill.name))
    )
    return Bank(entries=[Entry(r, bullets[r.id]) for r in rows], skills=list(skills))


async def _entry_row(session: AsyncSession, applicant_id: uuid.UUID, entry_id: uuid.UUID) -> Bank_Entry:
    row = await session.scalar(
        select(Bank_Entry).where(Bank_Entry.id == entry_id, Bank_Entry.applicant_id == applicant_id)
    )
    if row is None:
        raise NotFound
    return row


async def get_entry(session: AsyncSession, applicant_id: uuid.UUID, entry_id: uuid.UUID) -> Entry:
    row = await _entry_row(session, applicant_id, entry_id)
    return Entry(row, (await _bullets_of(session, [row.id]))[row.id])


async def find_duplicate(
    session: AsyncSession,
    applicant_id: uuid.UUID,
    section: bank_section,
    title: str,
    organization: str | None,
) -> Entry | None:
    """The bank entry with this section, title and organization, ignoring
    case and surrounding spaces (no organization matches no organization)."""
    row = await session.scalar(
        select(Bank_Entry)
        .where(
            Bank_Entry.applicant_id == applicant_id,
            Bank_Entry.section == section,
            func.lower(func.trim(Bank_Entry.title)) == title.strip().lower(),
            func.lower(func.trim(func.coalesce(Bank_Entry.organization, "")))
            == (organization or "").strip().lower(),
        )
        .order_by(Bank_Entry.created_at)
        .limit(1)
    )
    return None if row is None else await get_entry(session, applicant_id, row.id)


async def create_entry(
    session: AsyncSession,
    applicant_id: uuid.UUID,
    fields: EntryFields,
    bullets: Sequence[str] = (),
    *,
    allow_duplicate: bool = False,
) -> Entry:
    """Save a new entry and its bullets. Raises DuplicateEntryError when it
    matches an existing entry, unless the student chose "Save as new"."""
    if not allow_duplicate:
        existing = await find_duplicate(session, applicant_id, fields.section, fields.title, fields.organization)
        if existing is not None:
            raise DuplicateEntryError(existing)

    row = Bank_Entry(id=uuid.uuid4(), applicant_id=applicant_id, **fields.model_dump(include=set(EntryFields.model_fields)))
    session.add(row)
    # No relationship() orders the inserts (models/CLAUDE.md), so the entry
    # goes in before its bullets.
    await session.flush()
    rows = [Bank_Bullet(id=uuid.uuid4(), entry_id=row.id, position=i, text=t) for i, t in enumerate(bullets)]
    session.add_all(rows)
    await clear_embedding(session, applicant_id)
    await session.flush()
    await session.refresh(row)
    return Entry(row, rows)


async def update_entry(
    session: AsyncSession,
    applicant_id: uuid.UUID,
    entry_id: uuid.UUID,
    changes: Mapping[str, object],
) -> Entry:
    """Apply a partial edit. The merged entry is checked whole through
    EntryFields, so it raises pydantic's ValidationError when the result
    would not be a valid entry; the section cannot change."""
    row = await _entry_row(session, applicant_id, entry_id)
    current = {name: getattr(row, name) for name in EntryFields.model_fields}
    merged = EntryFields.model_validate({**current, **changes, "section": row.section})
    for name, value in merged.model_dump().items():
        setattr(row, name, value)
    await clear_embedding(session, applicant_id)
    await session.flush()
    await session.refresh(row)
    return await get_entry(session, applicant_id, entry_id)


async def delete_entry(session: AsyncSession, applicant_id: uuid.UUID, entry_id: uuid.UUID) -> None:
    """Delete an entry; its bullets go with it (ON DELETE CASCADE)."""
    row = await _entry_row(session, applicant_id, entry_id)
    await session.delete(row)
    await clear_embedding(session, applicant_id)
    await session.flush()


async def _delete_many(session: AsyncSession, applicant_id: uuid.UUID, model, ids: Sequence[uuid.UUID]) -> None:
    """Clear All (KAN-352): every row or none. One id that is not the
    applicant's answers `NotFound` and deletes nothing. Bullets, sources and
    built resumes' choice rows go with them (ON DELETE CASCADE), as one
    delete does."""
    wanted = set(ids)
    mine = (model.applicant_id == applicant_id, model.id.in_(wanted))
    if await session.scalar(select(func.count()).select_from(model).where(*mine)) != len(wanted):
        raise NotFound
    await session.execute(delete(model).where(*mine))
    await clear_embedding(session, applicant_id)
    await session.flush()


async def delete_entries(session: AsyncSession, applicant_id: uuid.UUID, entry_ids: Sequence[uuid.UUID]) -> None:
    await _delete_many(session, applicant_id, Bank_Entry, entry_ids)


async def delete_skills(session: AsyncSession, applicant_id: uuid.UUID, skill_ids: Sequence[uuid.UUID]) -> None:
    await _delete_many(session, applicant_id, Bank_Skill, skill_ids)


async def _owned_bullet(session: AsyncSession, applicant_id: uuid.UUID, bullet_id: uuid.UUID) -> Bank_Bullet:
    bullet = await session.scalar(
        select(Bank_Bullet)
        .join(Bank_Entry, Bank_Entry.id == Bank_Bullet.entry_id)
        .where(Bank_Bullet.id == bullet_id, Bank_Entry.applicant_id == applicant_id)
    )
    if bullet is None:
        raise NotFound
    return bullet


def _renumber(bullets: list[Bank_Bullet]) -> None:
    for i, bullet in enumerate(bullets):
        bullet.position = i


async def add_bullet(session: AsyncSession, applicant_id: uuid.UUID, entry_id: uuid.UUID, text: str) -> Bank_Bullet:
    """Append a bullet to the end of an entry."""
    entry = await get_entry(session, applicant_id, entry_id)
    bullet = Bank_Bullet(id=uuid.uuid4(), entry_id=entry_id, position=len(entry.bullets), text=text)
    session.add(bullet)
    await clear_embedding(session, applicant_id)
    await session.flush()
    return bullet


async def update_bullet(
    session: AsyncSession,
    applicant_id: uuid.UUID,
    bullet_id: uuid.UUID,
    *,
    text: str | None = None,
    position: int | None = None,
) -> Bank_Bullet:
    """Change a bullet's original wording and/or move it within its entry;
    a position past the end moves it last. Positions stay 0..n-1."""
    bullet = await _owned_bullet(session, applicant_id, bullet_id)
    if text is not None:
        bullet.text = text
    if position is not None:
        siblings = [b for b in (await _bullets_of(session, [bullet.entry_id]))[bullet.entry_id] if b.id != bullet.id]
        siblings.insert(min(position, len(siblings)), bullet)
        _renumber(siblings)
    await clear_embedding(session, applicant_id)
    await session.flush()
    return bullet


async def delete_bullet(session: AsyncSession, applicant_id: uuid.UUID, bullet_id: uuid.UUID) -> None:
    bullet = await _owned_bullet(session, applicant_id, bullet_id)
    entry_id = bullet.entry_id
    await session.delete(bullet)
    await session.flush()
    _renumber((await _bullets_of(session, [entry_id]))[entry_id])
    await clear_embedding(session, applicant_id)
    await session.flush()


async def _skill_name_taken(
    session: AsyncSession, applicant_id: uuid.UUID, name: str, other_than: uuid.UUID | None = None
) -> bool:
    stmt = select(Bank_Skill.id).where(
        Bank_Skill.applicant_id == applicant_id, func.lower(Bank_Skill.name) == name.lower()
    )
    if other_than is not None:
        stmt = stmt.where(Bank_Skill.id != other_than)
    return await session.scalar(stmt.limit(1)) is not None


async def add_skill(session: AsyncSession, applicant_id: uuid.UUID, name: str, group: str | None = None) -> Bank_Skill:
    if await _skill_name_taken(session, applicant_id, name):
        raise DuplicateSkillError
    skill = Bank_Skill(id=uuid.uuid4(), applicant_id=applicant_id, name=name, group=group)
    session.add(skill)
    await clear_embedding(session, applicant_id)
    await session.flush()
    return skill


async def _owned_skill(session: AsyncSession, applicant_id: uuid.UUID, skill_id: uuid.UUID) -> Bank_Skill:
    skill = await session.scalar(
        select(Bank_Skill).where(Bank_Skill.id == skill_id, Bank_Skill.applicant_id == applicant_id)
    )
    if skill is None:
        raise NotFound
    return skill


async def update_skill(
    session: AsyncSession, applicant_id: uuid.UUID, skill_id: uuid.UUID, changes: Mapping[str, object]
) -> Bank_Skill:
    """Apply a partial edit: `name` and/or `group` (None clears the group)."""
    skill = await _owned_skill(session, applicant_id, skill_id)
    name = changes.get("name")
    if name is not None:
        if await _skill_name_taken(session, applicant_id, str(name), other_than=skill.id):
            raise DuplicateSkillError
        skill.name = str(name)
    if "group" in changes:
        skill.group = changes["group"]  # type: ignore[assignment]
    await clear_embedding(session, applicant_id)
    await session.flush()
    return skill


async def delete_skill(session: AsyncSession, applicant_id: uuid.UUID, skill_id: uuid.UUID) -> None:
    await session.delete(await _owned_skill(session, applicant_id, skill_id))
    await clear_embedding(session, applicant_id)
    await session.flush()


@dataclass
class Merged:
    """What `merge_import` changed in the bank."""

    entries_added: int = 0
    entries_updated: int = 0
    skills_added: int = 0


# An import fills these only when the bank entry has none of them, so a merge
# never pairs one resume's start with another resume's end.
_DATES = ("start_month", "end_month", "end_kind")
# EntryCreate's cap on bullets, kept when a merge appends to an entry.
_MAX_BULLETS = 30


def _blank(value: object) -> bool:
    return value is None or value == []


def _same_words(text: str) -> str:
    return " ".join(text.split()).lower()


async def _merge_entry(session: AsyncSession, applicant_id: uuid.UUID, existing: Entry, draft: EntryCreate) -> bool:
    """Give a bank entry the fields it has empty and the bullets it lacks
    (ignoring case and spacing). A field the bank holds keeps its value: the
    student may have fixed it. True when anything changed."""
    row = existing.row
    changes = {
        name: getattr(draft, name)
        for name in EntryFields.model_fields
        if name not in _DATES and _blank(getattr(row, name)) and not _blank(getattr(draft, name))
    }
    if all(getattr(row, name) is None for name in _DATES) and any(getattr(draft, name) for name in _DATES):
        changes.update({name: getattr(draft, name) for name in _DATES})
    changed = False
    if changes:
        try:
            await update_entry(session, applicant_id, row.id, changes)
            changed = True
        except ValidationError:
            # The filled fields clash with the kept ones (a GPA above the
            # bank's scale): the entry stays as it was, the bullets still go in.
            pass
    have = {_same_words(b.text) for b in existing.bullets}
    room = _MAX_BULLETS - len(existing.bullets)
    for text in draft.bullets:
        if room <= 0:
            break
        if _same_words(text) in have:
            continue
        have.add(_same_words(text))
        await add_bullet(session, applicant_id, row.id, text)
        room -= 1
        changed = True
    return changed


async def merge_import(
    session: AsyncSession,
    applicant_id: uuid.UUID,
    resume_id: uuid.UUID,
    entries: Sequence[EntryCreate],
    skills: Sequence[tuple[str, str | None]],
) -> Merged:
    """Write an import of the applicant's upload `resume_id` into the bank
    (ADR 0003). An entry the bank lacks is added; one that `find_duplicate`
    matches is merged, never copied, so several resumes add up to one bank.
    A skill is added when the bank has none of that name, ignoring case.
    Every entry and skill the reading found gets the upload as a source
    (KAN-343), even one the merge left unchanged: it is still on that
    resume. The caller has flushed the resume row and checked its owner."""
    merged = Merged()
    entry_ids: list[uuid.UUID] = []
    for draft in entries:
        existing = await find_duplicate(session, applicant_id, draft.section, draft.title, draft.organization)
        if existing is None:
            existing = await create_entry(session, applicant_id, draft, draft.bullets, allow_duplicate=True)
            merged.entries_added += 1
        elif await _merge_entry(session, applicant_id, existing, draft):
            merged.entries_updated += 1
        entry_ids.append(existing.row.id)
    taken = {
        name.lower(): skill_id
        for skill_id, name in await session.execute(
            select(Bank_Skill.id, Bank_Skill.name).where(Bank_Skill.applicant_id == applicant_id)
        )
    }
    skill_ids: list[uuid.UUID] = []
    for name, group in skills:
        if name.lower() not in taken:
            taken[name.lower()] = (await add_skill(session, applicant_id, name, group)).id
            merged.skills_added += 1
        skill_ids.append(taken[name.lower()])
    await _add_sources(session, Bank_Entry_Source, Bank_Entry_Source.entry_id, entry_ids, resume_id)
    await _add_sources(session, Bank_Skill_Source, Bank_Skill_Source.skill_id, skill_ids, resume_id)
    return merged


async def _add_sources(session: AsyncSession, table, item_column, item_ids: list[uuid.UUID], resume_id: uuid.UUID) -> None:
    """One source row per item; a row already there stays (a second import
    of the same resume adds nothing)."""
    if not item_ids:
        return
    rows = [{item_column.key: item_id, "resume_id": resume_id} for item_id in dict.fromkeys(item_ids)]
    await session.execute(insert(table).values(rows).on_conflict_do_nothing())
    await session.flush()


async def clear_sources(session: AsyncSession, resume_id: uuid.UUID) -> None:
    """Drop every source of one upload, before Import Updated Resume merges
    the new file: an entry the new version dropped leaves that resume's
    view, and stays in the bank. The caller has checked the owner."""
    await session.execute(delete(Bank_Entry_Source).where(Bank_Entry_Source.resume_id == resume_id))
    await session.execute(delete(Bank_Skill_Source).where(Bank_Skill_Source.resume_id == resume_id))
    await session.flush()


@dataclass
class Holdings:
    """Which resumes hold each entry and skill (KAN-343): an upload holds
    what its import found (the sources), a built resume what it shows (its
    choice rows with `shown`). `resumes` is in dropdown order, and each id
    list follows it. An item no resume holds is absent."""

    resumes: list[BankResume]
    entries: dict[uuid.UUID, list[uuid.UUID]]
    skills: dict[uuid.UUID, list[uuid.UUID]]


async def load_holdings(session: AsyncSession, applicant_id: uuid.UUID) -> Holdings:
    """Every resume of the applicant, and which entries and skills each
    holds, for the Experiences view's dropdown."""
    defaults = (
        await session.execute(
            select(Applicant_Profile.default_resume_id, Applicant_Profile.default_built_resume_id)
            .where(Applicant_Profile.id == applicant_id)
        )
    ).first()
    starred = {d for d in (defaults or ()) if d is not None}
    resumes = [
        BankResume(
            id=r.id, kind="uploaded", name=r.original_filename or "Uploaded resume", primary=r.id in starred,
            created_at=r.created_at,
        )
        for r in await session.execute(
            select(Resume.id, Resume.original_filename, Resume.created_at)
            .where(Resume.applicant_id == applicant_id)
            .order_by(Resume.created_at.desc(), Resume.id)
        )
    ]
    for r in await session.execute(
        select(Built_Resume.id, Built_Resume.name, Built_Resume.created_at, Job_Post.title, Job_Post.company_name)
        .outerjoin(Job_Post, Job_Post.id == Built_Resume.job_posting_id)
        .where(Built_Resume.applicant_id == applicant_id)
        # Base resumes (no posting) first, then tailored, each newest first.
        .order_by(Built_Resume.job_posting_id.is_not(None), Built_Resume.created_at.desc(), Built_Resume.id)
    ):
        posting = None if r.title is None else f"{r.title} at {r.company_name}" if r.company_name else r.title
        resumes.append(BankResume(
            id=r.id, kind="base" if r.title is None else "tailored", name=r.name, posting=posting,
            primary=r.id in starred, created_at=r.created_at,
        ))

    order = {r.id: i for i, r in enumerate(resumes)}

    async def held(*queries) -> dict[uuid.UUID, list[uuid.UUID]]:
        out: dict[uuid.UUID, list[uuid.UUID]] = {}
        for query in queries:
            for item_id, resume_id in await session.execute(query):
                out.setdefault(item_id, []).append(resume_id)
        for ids in out.values():
            ids.sort(key=order.__getitem__)
        return out

    def uploads(table, item_column):
        return (
            select(item_column, table.resume_id)
            .join(Resume, Resume.id == table.resume_id)
            .where(Resume.applicant_id == applicant_id)
        )

    def built(table, item_column):
        return (
            select(item_column, table.built_resume_id)
            .join(Built_Resume, Built_Resume.id == table.built_resume_id)
            .where(Built_Resume.applicant_id == applicant_id, table.shown)
        )

    return Holdings(
        resumes=resumes,
        entries=await held(
            uploads(Bank_Entry_Source, Bank_Entry_Source.entry_id),
            built(Built_Resume_Entry, Built_Resume_Entry.entry_id),
        ),
        skills=await held(
            uploads(Bank_Skill_Source, Bank_Skill_Source.skill_id),
            built(Built_Resume_Skill, Built_Resume_Skill.skill_id),
        ),
    )


def entry_response(entry: Entry, resume_ids: list[uuid.UUID] | None = None) -> EntryResponse:
    fields = {name: getattr(entry.row, name) for name in EntryFields.model_fields}
    return EntryResponse.model_validate({
        **fields,
        "id": entry.row.id,
        "bullets": [BulletResponse.model_validate(b) for b in entry.bullets],
        "resume_ids": resume_ids or [],
    })


def skill_response(skill: Bank_Skill, resume_ids: list[uuid.UUID] | None = None) -> SkillResponse:
    return SkillResponse(id=skill.id, name=skill.name, group=skill.group, resume_ids=resume_ids or [])


def bank_response(bank: Bank, holdings: Holdings | None = None) -> BankResponse:
    """The whole bank as the API sends it; Scout's facts read this shape too.
    Without `holdings`, `resumes` and every `resume_ids` are empty."""
    holdings = holdings or Holdings(resumes=[], entries={}, skills={})
    return BankResponse(
        entries=[entry_response(e, holdings.entries.get(e.row.id)) for e in bank.entries],
        skills=[skill_response(s, holdings.skills.get(s.id)) for s in bank.skills],
        resumes=holdings.resumes,
    )
