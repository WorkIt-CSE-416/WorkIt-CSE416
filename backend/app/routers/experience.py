"""
/applicants/{id}/experience — the Experience Bank (KAN-176): the applicant's
entries and skills, kept apart from any one resume. Read, add, edit and delete
entries; replace the skill list; import a stored resume's sections; compose a
choice of entries into a resume; and the model's two helpers, bullets for an
entry and entries from free text.

Applicant-only and owner-only, like every /applicants route. The bank is
private: no company route reads it.
"""

import uuid

from fastapi import APIRouter, Depends, HTTPException, Response, status
from pydantic import ValidationError
from sqlalchemy import case, delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from workit_scout.builder import EntryFacts, structure_entries, write_bullets
from workit_scout.llm import LLM, ScoutUnavailable
from workit_scout.quota import DailyQuota

from app.db import get_session
from app.deps import assert_applicant_owns, get_current_account
from app.models.dto import ParsedResume
from app.models.experience import ApplicantSkill, ExperienceEntry
from app.routers.resumes import get_owned_resume
from app.routers.scout import get_llm, get_scout_settings
from app.schemas.auth import AuthenticatedAccount
from app.schemas.experience import (
    Bank,
    BulletsRequest,
    BulletsResponse,
    ComposeRequest,
    Entry,
    EntryDetails,
    EntryDraft,
    ImportResult,
    IntakeRequest,
    IntakeResponse,
    SkillDraft,
    SkillsUpdate,
)
from app.services.experience import bank_to_resume, resume_to_entries

router = APIRouter()

# The builder's own count, apart from chat's: see ScoutSettings.builder_daily_calls
builder_quota = DailyQuota()

# A section newest first, as a resume reads: what is still going on, then by
# when it ended, then by when it began
_NEWEST_FIRST = (
    case((ExperienceEntry.end_date.is_(None) & ExperienceEntry.start_date.is_not(None), 0), else_=1),
    ExperienceEntry.end_date.desc().nulls_last(),
    ExperienceEntry.start_date.desc().nulls_last(),
    ExperienceEntry.created_at,
)


def _entry(row: ExperienceEntry) -> Entry:
    return Entry(
        id=row.id, section=row.section, title=row.title, organization=row.organization,
        location=row.location, start_date=row.start_date, end_date=row.end_date,
        bullets=list(row.bullets or []), details=EntryDetails.model_validate(row.details or {}),
    )


def _columns(draft: EntryDraft) -> dict:
    return {
        "section": draft.section.value, "title": draft.title, "organization": draft.organization,
        "location": draft.location, "start_date": draft.start_date, "end_date": draft.end_date,
        "bullets": draft.bullets, "details": draft.details.model_dump(exclude_none=True),
    }


async def load_bank(db: AsyncSession, applicant_id: uuid.UUID) -> Bank:
    entries = (await db.execute(
        select(ExperienceEntry).where(ExperienceEntry.applicant_id == applicant_id).order_by(*_NEWEST_FIRST)
    )).scalars().all()
    skills = (await db.execute(
        select(ApplicantSkill).where(ApplicantSkill.applicant_id == applicant_id)
        .order_by(ApplicantSkill.sort_order, ApplicantSkill.created_at)
    )).scalars().all()
    return Bank(
        entries=[_entry(e) for e in entries],
        skills=[SkillDraft(name=s.name, category=s.category) for s in skills],
    )


async def _owned_entry(db: AsyncSession, applicant_id: uuid.UUID, entry_id: uuid.UUID) -> ExperienceEntry:
    row = await db.scalar(select(ExperienceEntry).where(
        ExperienceEntry.id == entry_id, ExperienceEntry.applicant_id == applicant_id))
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Entry not found")
    return row


async def _commit(db: AsyncSession, failure: str) -> None:
    try:
        await db.commit()
    except Exception:
        await db.rollback()
        raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, failure)


def take_builder_call(account: AuthenticatedAccount) -> None:
    if not builder_quota.take(account.id, get_scout_settings().builder_daily_calls):
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS,
            "You've used today's resume writing help. It resets at midnight UTC.",
        )


@router.get("/applicants/{applicant_id}/experience")
async def get_bank(
    applicant_id: uuid.UUID,
    account: AuthenticatedAccount = Depends(get_current_account),
    db: AsyncSession = Depends(get_session),
) -> Bank:
    assert_applicant_owns(account, applicant_id)
    return await load_bank(db, applicant_id)


@router.post("/applicants/{applicant_id}/experience/entries", status_code=status.HTTP_201_CREATED)
async def add_entry(
    applicant_id: uuid.UUID,
    body: EntryDraft,
    account: AuthenticatedAccount = Depends(get_current_account),
    db: AsyncSession = Depends(get_session),
) -> Entry:
    assert_applicant_owns(account, applicant_id)
    row = ExperienceEntry(applicant_id=applicant_id, **_columns(body))
    db.add(row)
    await _commit(db, "Failed to save the entry")
    await db.refresh(row)
    return _entry(row)


@router.put("/applicants/{applicant_id}/experience/entries/{entry_id}")
async def update_entry(
    applicant_id: uuid.UUID,
    entry_id: uuid.UUID,
    body: EntryDraft,
    account: AuthenticatedAccount = Depends(get_current_account),
    db: AsyncSession = Depends(get_session),
) -> Entry:
    """A full replace, like a resume's PUT: what the body leaves out is cleared."""
    assert_applicant_owns(account, applicant_id)
    row = await _owned_entry(db, applicant_id, entry_id)
    for key, value in _columns(body).items():
        setattr(row, key, value)
    await _commit(db, "Failed to save the entry")
    await db.refresh(row)
    return _entry(row)


@router.delete("/applicants/{applicant_id}/experience/entries/{entry_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_entry(
    applicant_id: uuid.UUID,
    entry_id: uuid.UUID,
    account: AuthenticatedAccount = Depends(get_current_account),
    db: AsyncSession = Depends(get_session),
) -> Response:
    """Resumes already made from it keep their copy."""
    assert_applicant_owns(account, applicant_id)
    await db.delete(await _owned_entry(db, applicant_id, entry_id))
    await _commit(db, "Failed to delete the entry")
    return Response(status_code=status.HTTP_204_NO_CONTENT)


def _unique(skills: list[SkillDraft]) -> list[SkillDraft]:
    seen: set[str] = set()
    out = []
    for s in skills:
        key = s.name.strip().casefold()
        if key and key not in seen:
            seen.add(key)
            out.append(SkillDraft(name=s.name.strip(), category=(s.category or "").strip() or None))
    return out


@router.put("/applicants/{applicant_id}/experience/skills")
async def replace_skills(
    applicant_id: uuid.UUID,
    body: SkillsUpdate,
    account: AuthenticatedAccount = Depends(get_current_account),
    db: AsyncSession = Depends(get_session),
) -> list[SkillDraft]:
    """The whole list, in order, in one transaction: a duplicate name (any
    case) keeps its first appearance."""
    assert_applicant_owns(account, applicant_id)
    skills = _unique(body.skills)
    await db.execute(delete(ApplicantSkill).where(ApplicantSkill.applicant_id == applicant_id))
    db.add_all(
        ApplicantSkill(applicant_id=applicant_id, name=s.name, category=s.category, sort_order=i)
        for i, s in enumerate(skills)
    )
    await _commit(db, "Failed to save skills")
    return skills


async def import_into_bank(db: AsyncSession, applicant_id: uuid.UUID, parsed: ParsedResume) -> ImportResult:
    """Adds a resume's sections to the bank, uncommitted. Entries are
    appended, not merged: the applicant removes any duplicates. A skill
    already in the bank is skipped. Also what app.scripts.backfill_bank runs."""
    entries, skills = resume_to_entries(parsed)
    have = {name for name in (await db.execute(
        select(func.lower(ApplicantSkill.name)).where(ApplicantSkill.applicant_id == applicant_id)
    )).scalars()}
    start = await db.scalar(
        select(func.coalesce(func.max(ApplicantSkill.sort_order) + 1, 0))
        .where(ApplicantSkill.applicant_id == applicant_id))
    new_skills = [s for s in _unique(skills) if s.name.casefold() not in have]
    db.add_all(ExperienceEntry(applicant_id=applicant_id, **_columns(e)) for e in entries)
    db.add_all(
        ApplicantSkill(applicant_id=applicant_id, name=s.name, category=s.category, sort_order=start + i)
        for i, s in enumerate(new_skills)
    )
    return ImportResult(added_entries=len(entries), added_skills=len(new_skills))


@router.post("/applicants/{applicant_id}/experience/import/{resume_id}")
async def import_resume(
    applicant_id: uuid.UUID,
    resume_id: uuid.UUID,
    account: AuthenticatedAccount = Depends(get_current_account),
    db: AsyncSession = Depends(get_session),
) -> ImportResult:
    """Adds a stored resume's sections to the bank (import_into_bank)."""
    assert_applicant_owns(account, applicant_id)
    resume = await get_owned_resume(db, applicant_id, resume_id)
    if not resume.parsed_json:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "That resume has no details to import")
    try:
        parsed = ParsedResume.model_validate(resume.parsed_json)
    except ValidationError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "That resume's details can't be read") from exc
    result = await import_into_bank(db, applicant_id, parsed)
    await _commit(db, "Failed to import the resume")
    return result


@router.post("/applicants/{applicant_id}/experience/compose")
async def compose(
    applicant_id: uuid.UUID,
    body: ComposeRequest,
    account: AuthenticatedAccount = Depends(get_current_account),
    db: AsyncSession = Depends(get_session),
) -> ParsedResume:
    """The chosen entries as a resume, each section newest first. Saves
    nothing: POST .../resumes/generated stores what the applicant keeps."""
    assert_applicant_owns(account, applicant_id)
    bank = await load_bank(db, applicant_id)
    chosen = set(body.entry_ids)
    names = None if body.skill_names is None else {n.casefold() for n in body.skill_names}
    return bank_to_resume(
        (e for e in bank.entries if e.id in chosen),
        (s for s in bank.skills if names is None or s.name.casefold() in names),
    )


@router.post("/applicants/{applicant_id}/experience/ai/bullets")
async def ai_bullets(
    applicant_id: uuid.UUID,
    body: BulletsRequest,
    account: AuthenticatedAccount = Depends(get_current_account),
    llm: LLM = Depends(get_llm),
) -> BulletsResponse:
    """Proposed bullets for one entry, from what it says and the applicant's
    notes. Nothing is saved; the applicant edits and keeps them."""
    assert_applicant_owns(account, applicant_id)
    take_builder_call(account)
    e = body.entry
    facts = EntryFacts(
        section=e.section.value, title=e.title, organization=e.organization,
        bullets=e.bullets, notes=body.notes,
        current=e.start_date is not None and e.end_date is None,
    )
    try:
        bullets = await write_bullets(llm, facts)
    except ScoutUnavailable as exc:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, str(exc)) from exc
    if not bullets:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            "Couldn't write bullets from that. Add a sentence about what you did.",
        )
    return BulletsResponse(bullets=bullets)


@router.post("/applicants/{applicant_id}/experience/ai/intake")
async def ai_intake(
    applicant_id: uuid.UUID,
    body: IntakeRequest,
    account: AuthenticatedAccount = Depends(get_current_account),
    llm: LLM = Depends(get_llm),
) -> IntakeResponse:
    """Free text about what the applicant has done, as proposed entries for
    them to accept one by one. Nothing is saved."""
    assert_applicant_owns(account, applicant_id)
    take_builder_call(account)
    try:
        proposed = await structure_entries(llm, body.text)
    except ScoutUnavailable as exc:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, str(exc)) from exc
    entries = []
    for p in proposed:
        details = {"field_of_study": p.field_of_study, "gpa": p.gpa, "technologies": p.technologies}
        try:
            entries.append(EntryDraft.model_validate({
                **p.model_dump(exclude=set(details)), "details": details}))
        except ValidationError:
            continue  # a section or title the model got wrong
    if not entries:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            "Couldn't find anything to add in that. Name the role or project and where it was.",
        )
    return IntakeResponse(entries=entries)
