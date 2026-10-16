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
  organization, ignoring case. Import and intake use it to flag drafts.
- A skill link (KAN-216) joins a skill to an entry of the same applicant.
  Adding or removing one does not clear the embedding: the embedding text
  holds skills and entries, never which skill goes with which entry.
- Functions flush but never commit: the caller owns the transaction, so an
  import can save many entries in one.

The session is handed in by the caller; this module opens no connection.
"""

import datetime
import uuid
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field

from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.bank import (
    Bank_Bullet,
    Bank_Entry,
    Bank_Skill,
    Bank_Skill_Link,
    Experience_Bank,
)
from app.models.dto import bank_section, entry_end_kind
from app.schemas.bank import (
    BankResponse,
    BulletResponse,
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
    group, then name. `skill_links` maps a skill id to the ids of its
    linked entries, in bank order; a skill with no links is absent."""

    entries: list[Entry]
    skills: list[Bank_Skill]
    skill_links: dict[uuid.UUID, list[uuid.UUID]] = field(default_factory=dict)


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
    order = {r.id: i for i, r in enumerate(rows)}
    links: dict[uuid.UUID, list[uuid.UUID]] = {}
    for link in await session.scalars(
        select(Bank_Skill_Link)
        .join(Bank_Skill, Bank_Skill.id == Bank_Skill_Link.skill_id)
        .where(Bank_Skill.applicant_id == applicant_id)
    ):
        links.setdefault(link.skill_id, []).append(link.entry_id)
    for entry_ids in links.values():
        entry_ids.sort(key=order.__getitem__)
    return Bank(entries=[Entry(r, bullets[r.id]) for r in rows], skills=list(skills), skill_links=links)


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


async def linked_entry_ids(session: AsyncSession, skill_id: uuid.UUID) -> list[uuid.UUID]:
    """The ids of the entries a skill (already checked as owned) links to."""
    entries = list(
        await session.scalars(
            select(Bank_Entry).join(Bank_Skill_Link, Bank_Skill_Link.entry_id == Bank_Entry.id)
            .where(Bank_Skill_Link.skill_id == skill_id)
        )
    )
    entries.sort(key=_newest_first)
    return [e.id for e in entries]


async def link_skill(session: AsyncSession, applicant_id: uuid.UUID, skill_id: uuid.UUID, entry_id: uuid.UUID) -> None:
    """Link a skill to an entry; linking twice is a no-op. Raises NotFound
    unless both belong to this applicant."""
    await _owned_skill(session, applicant_id, skill_id)
    await _entry_row(session, applicant_id, entry_id)
    await session.execute(
        insert(Bank_Skill_Link).values(skill_id=skill_id, entry_id=entry_id).on_conflict_do_nothing()
    )
    await session.flush()


async def unlink_skill(session: AsyncSession, applicant_id: uuid.UUID, skill_id: uuid.UUID, entry_id: uuid.UUID) -> None:
    """Remove a link. Raises NotFound when this applicant has no such link."""
    await _owned_skill(session, applicant_id, skill_id)
    link = await session.get(Bank_Skill_Link, (skill_id, entry_id))
    if link is None:
        raise NotFound
    await session.delete(link)
    await session.flush()


def entry_response(entry: Entry) -> EntryResponse:
    fields = {name: getattr(entry.row, name) for name in EntryFields.model_fields}
    return EntryResponse.model_validate(
        {**fields, "id": entry.row.id, "bullets": [BulletResponse.model_validate(b) for b in entry.bullets]}
    )


def skill_response(skill: Bank_Skill, entry_ids: list[uuid.UUID]) -> SkillResponse:
    return SkillResponse(id=skill.id, name=skill.name, group=skill.group, entry_ids=entry_ids)


def bank_response(bank: Bank) -> BankResponse:
    """The whole bank as the API sends it; Scout's facts read this shape too."""
    return BankResponse(
        entries=[entry_response(e) for e in bank.entries],
        skills=[skill_response(s, bank.skill_links.get(s.id, [])) for s in bank.skills],
    )
