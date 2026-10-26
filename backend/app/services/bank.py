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
- An entry or skill belongs to the upload whose import wrote it, or to
  none when the student made it (`resume_id`, ADR 0005,
  docs/bank_by_resume.md). Uploads never share one: an import
  (`import_upload`) replaces its upload's entries and skills and never
  looks at another resume's.
- The duplicate check (`find_duplicate`) matches section, title and
  organization, ignoring case, among one owner's entries only: Add's
  "Save as new" warning.
- One exception, which the student opts into: the upload that confirms a
  parse preview (KAN-372, ADR 0006) replaces the entries and skills of the
  student's other uploads that its reading matches (`upload_matches`), so a
  newer resume does not pile copies on an older one. The student's own
  entries are never matched.
- Functions flush but never commit: the caller owns the transaction, so an
  import can save many entries in one.

The session is handed in by the caller; this module opens no connection.
"""

import datetime
import uuid
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass

from sqlalchemy import delete, func, select, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.bank import (
    Bank_Bullet,
    Bank_Entry,
    Bank_Skill,
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
from app.services import skill_catalog


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


async def removed_skills(session: AsyncSession, applicant_id: uuid.UUID) -> set[str]:
    """The catalog keys of the skills the student deleted (KAN-369)."""
    keys = await session.scalar(
        select(Experience_Bank.removed_skills).where(Experience_Bank.applicant_id == applicant_id))
    return set(keys or ())


async def remember_removed(session: AsyncSession, applicant_id: uuid.UUID, names: Iterable[str]) -> None:
    """The student removed these skills: no reading or Tailor adds them again."""
    keys = sorted({skill_catalog.key(n) for n in names} - await removed_skills(session, applicant_id))
    if not keys:
        return
    stmt = insert(Experience_Bank).values(applicant_id=applicant_id, removed_skills=keys)
    await session.execute(stmt.on_conflict_do_update(
        index_elements=[Experience_Bank.applicant_id],
        set_={"removed_skills": func.array_cat(Experience_Bank.removed_skills, stmt.excluded.removed_skills)},
    ))


async def forget_removed(session: AsyncSession, applicant_id: uuid.UUID, name: str) -> None:
    """The student added this skill by hand: it is theirs again."""
    await session.execute(
        update(Experience_Bank)
        .where(Experience_Bank.applicant_id == applicant_id)
        .values(removed_skills=func.array_remove(Experience_Bank.removed_skills, skill_catalog.key(name)))
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
    resume_id: uuid.UUID | None = None,
) -> Entry | None:
    """The entry of owner `resume_id` (None: the student's own) with this
    section, title and organization, ignoring case and surrounding spaces (no
    organization matches no organization). Another upload's entries never
    match (ADR 0005)."""
    row = await session.scalar(
        select(Bank_Entry)
        .where(
            Bank_Entry.applicant_id == applicant_id,
            Bank_Entry.resume_id.is_not_distinct_from(resume_id),
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
    resume_id: uuid.UUID | None = None,
    allow_duplicate: bool = False,
) -> Entry:
    """Save a new entry and its bullets, owned by the upload `resume_id` (the
    caller has checked it is the applicant's) or by none. Raises
    DuplicateEntryError when it matches an entry of the same owner, unless
    the student chose "Save as new"."""
    if not allow_duplicate:
        existing = await find_duplicate(
            session, applicant_id, fields.section, fields.title, fields.organization, resume_id)
        if existing is not None:
            raise DuplicateEntryError(existing)

    row = Bank_Entry(id=uuid.uuid4(), applicant_id=applicant_id, resume_id=resume_id,
                     **fields.model_dump(include=set(EntryFields.model_fields)))
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
    applicant's answers `NotFound` and deletes nothing. Bullets and built
    resumes' choice rows go with them (ON DELETE CASCADE), as one delete
    does."""
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
    """The student's delete: the skills are also remembered as removed."""
    names = list(await session.scalars(
        select(Bank_Skill.name).where(Bank_Skill.applicant_id == applicant_id, Bank_Skill.id.in_(skill_ids))))
    await _delete_many(session, applicant_id, Bank_Skill, skill_ids)
    await remember_removed(session, applicant_id, names)


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
    session: AsyncSession, applicant_id: uuid.UUID, resume_id: uuid.UUID | None, name: str,
    other_than: uuid.UUID | None = None,
) -> bool:
    """Whether owner `resume_id` already has a skill of this name, ignoring
    case: the same name may stand once per upload and once among the
    student's own."""
    stmt = select(Bank_Skill.id).where(
        Bank_Skill.applicant_id == applicant_id,
        Bank_Skill.resume_id.is_not_distinct_from(resume_id),
        func.lower(Bank_Skill.name) == name.lower(),
    )
    if other_than is not None:
        stmt = stmt.where(Bank_Skill.id != other_than)
    return await session.scalar(stmt.limit(1)) is not None


async def add_skill(
    session: AsyncSession, applicant_id: uuid.UUID, name: str, group: str | None = None,
    *, resume_id: uuid.UUID | None = None,
) -> Bank_Skill:
    """Save a skill, owned as `create_entry`'s entry is."""
    if await _skill_name_taken(session, applicant_id, resume_id, name):
        raise DuplicateSkillError
    skill = Bank_Skill(id=uuid.uuid4(), applicant_id=applicant_id, resume_id=resume_id, name=name, group=group)
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
        if await _skill_name_taken(session, applicant_id, skill.resume_id, str(name), other_than=skill.id):
            raise DuplicateSkillError
        skill.name = str(name)
    if "group" in changes:
        skill.group = changes["group"]  # type: ignore[assignment]
    await clear_embedding(session, applicant_id)
    await session.flush()
    return skill


async def delete_skill(session: AsyncSession, applicant_id: uuid.UUID, skill_id: uuid.UUID) -> None:
    """The student's delete: the skill is also remembered as removed."""
    skill = await _owned_skill(session, applicant_id, skill_id)
    await session.delete(skill)
    await remember_removed(session, applicant_id, [skill.name])
    await clear_embedding(session, applicant_id)
    await session.flush()


@dataclass
class Imported:
    """What `import_upload` wrote."""

    entries_added: int = 0
    skills_added: int = 0
    entries_replaced: int = 0
    skills_replaced: int = 0


def _entry_key(section, title: str, organization: str | None) -> tuple:
    # find_duplicate's match: section, title and organization, ignoring case
    # and surrounding spaces.
    return (str(section), title.strip().lower(), (organization or "").strip().lower())


@dataclass
class Matches:
    """For each entry and skill of a reading, the ids of the rows of the
    applicant's other uploads it matches."""

    entries: list[list[uuid.UUID]]
    skills: list[list[uuid.UUID]]


async def upload_matches(
    session: AsyncSession,
    applicant_id: uuid.UUID,
    entries: Sequence[EntryCreate],
    skills: Sequence[tuple[str, str | None]],
    *,
    besides: uuid.UUID | None = None,
) -> Matches:
    """The rows a confirmed preview replaces (KAN-372, ADR 0006): entries
    owned by another upload with the same section, title and organization,
    ignoring case, and skills owned by another upload with the same name,
    ignoring case. Rows the student made (no owner) and rows of `besides`
    (the upload being written) never match."""
    owned = (Bank_Entry.applicant_id == applicant_id, Bank_Entry.resume_id.is_not(None))
    rows = (await session.execute(
        select(Bank_Entry.id, Bank_Entry.section, Bank_Entry.title, Bank_Entry.organization, Bank_Entry.resume_id)
        .where(*owned).order_by(Bank_Entry.created_at)
    )).all()
    by_key: dict[tuple, list[uuid.UUID]] = {}
    for row in rows:
        if row.resume_id != besides:
            by_key.setdefault(_entry_key(row.section, row.title, row.organization), []).append(row.id)
    skill_rows = (await session.execute(
        select(Bank_Skill.id, Bank_Skill.name, Bank_Skill.resume_id)
        .where(Bank_Skill.applicant_id == applicant_id, Bank_Skill.resume_id.is_not(None))
        .order_by(Bank_Skill.created_at)
    )).all()
    by_name: dict[str, list[uuid.UUID]] = {}
    for row in skill_rows:
        if row.resume_id != besides:
            by_name.setdefault(row.name.strip().lower(), []).append(row.id)
    return Matches(
        entries=[by_key.get(_entry_key(e.section, e.title, e.organization), []) for e in entries],
        skills=[by_name.get(name.strip().lower(), []) for name, _ in skills],
    )


async def import_upload(
    session: AsyncSession,
    applicant_id: uuid.UUID,
    resume_id: uuid.UUID,
    entries: Sequence[EntryCreate],
    skills: Sequence[tuple[str, str | None]],
    *,
    replace_matching: bool = False,
) -> Imported:
    """Write a reading of the applicant's upload `resume_id` into the bank as
    that upload's own entries and skills (ADR 0005). What the upload owned
    before goes first, with the student's edits to it and its places on
    built resumes, so Import Again and Import Updated Resume replace rather
    than copy. No other resume's entries are looked at. A skill the reading
    lists twice, ignoring case, is written once. The caller has flushed the
    resume row and checked its owner.

    With `replace_matching` (a confirmed parse preview, ADR 0006), the rows
    of the student's other uploads that the reading matches
    (`upload_matches`) go too, with their places on built resumes, so the
    newest upload holds the one copy."""
    for table in (Bank_Entry, Bank_Skill):
        await session.execute(
            delete(table).where(table.applicant_id == applicant_id, table.resume_id == resume_id)
        )
    replaced_entries: set[uuid.UUID] = set()
    replaced_skills: set[uuid.UUID] = set()
    if replace_matching:
        matches = await upload_matches(session, applicant_id, entries, skills, besides=resume_id)
        replaced_entries = {i for ids in matches.entries for i in ids}
        replaced_skills = {i for ids in matches.skills for i in ids}
        for table, ids in ((Bank_Entry, replaced_entries), (Bank_Skill, replaced_skills)):
            if ids:
                await session.execute(delete(table).where(table.applicant_id == applicant_id, table.id.in_(ids)))
    for draft in entries:
        await create_entry(session, applicant_id, draft, draft.bullets, resume_id=resume_id, allow_duplicate=True)
    names: set[str] = set()
    removed = await removed_skills(session, applicant_id)
    for name, group in skills:
        if skill_catalog.key(name) in removed:
            continue
        if name.lower() not in names:
            names.add(name.lower())
            await add_skill(session, applicant_id, name, group, resume_id=resume_id)
    await clear_embedding(session, applicant_id)
    await session.flush()
    return Imported(
        entries_added=len(entries),
        skills_added=len(names),
        entries_replaced=len(replaced_entries),
        skills_replaced=len(replaced_skills),
    )


@dataclass
class Holdings:
    """Which resumes hold each entry and skill (KAN-343): an upload holds
    what it owns (ADR 0005), a built resume what it shows (its choice rows
    with `shown`). `resumes` is in dropdown order, and each id
    list follows it. An item no resume holds is absent."""

    resumes: list[BankResume]
    entries: dict[uuid.UUID, list[uuid.UUID]]
    skills: dict[uuid.UUID, list[uuid.UUID]]


async def load_holdings(session: AsyncSession, applicant_id: uuid.UUID) -> Holdings:
    """Every resume of the applicant, and which entries and skills each
    holds, for the Experiences view's resume table."""
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
            created_at=r.created_at, edited_at=r.created_at,
        )
        for r in await session.execute(
            select(Resume.id, Resume.original_filename, Resume.created_at)
            .where(Resume.applicant_id == applicant_id)
            .order_by(Resume.created_at.desc(), Resume.id)
        )
    ]
    for r in await session.execute(
        select(
            Built_Resume.id, Built_Resume.name, Built_Resume.created_at, Built_Resume.updated_at,
            Job_Post.title, Job_Post.company_name,
        )
        .outerjoin(Job_Post, Job_Post.id == Built_Resume.job_posting_id)
        .where(Built_Resume.applicant_id == applicant_id)
        # Base resumes (no posting) first, then tailored, each newest first.
        .order_by(Built_Resume.job_posting_id.is_not(None), Built_Resume.created_at.desc(), Built_Resume.id)
    ):
        posting = None if r.title is None else f"{r.title} at {r.company_name}" if r.company_name else r.title
        resumes.append(BankResume(
            id=r.id, kind="base" if r.title is None else "tailored", name=r.name, posting=posting,
            primary=r.id in starred, created_at=r.created_at, edited_at=r.updated_at,
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

    def uploads(table):
        return select(table.id, table.resume_id).where(
            table.applicant_id == applicant_id, table.resume_id.is_not(None)
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
            uploads(Bank_Entry),
            built(Built_Resume_Entry, Built_Resume_Entry.entry_id),
        ),
        skills=await held(
            uploads(Bank_Skill),
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
