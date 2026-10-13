"""The experience bank's API (KAN-206): one student's entries, bullets and
skills. Every route checks the token's account owns `applicant_id` first;
a row of another applicant answers 404. The rules (embedding clearing, the
duplicate check, bullet order) live in `app/services/bank.py`.

Months are "YYYY-MM". An entry's `end_kind` is "month", "present" or
"expected"; present has no `end_month`, the others need one. Section fields
(Education: degree, field_of_study, gpa, gpa_scale, coursework, honors;
Projects: link; Certifications: issuer; Awards: award_date) must be empty on
entries of other sections, or the request answers 422.

GET    /applicants/{id}/bank                     -> BankResponse
POST   /applicants/{id}/bank/entries             EntryCreate -> 201 EntryResponse
       409 {detail, duplicate: EntryResponse} when section, title and
       organization match an entry, ignoring case; ?allow_duplicate=true
       saves it anyway ("Save as new").
PATCH  /applicants/{id}/bank/entries/{entry_id}  EntryUpdate -> EntryResponse
DELETE /applicants/{id}/bank/entries/{entry_id}  -> 204 (its bullets too)
GET    /applicants/{id}/bank/entries/{entry_id}/resumes -> {"built_resumes": n}
       how many built resumes show the entry, for the delete confirm (story 18)
POST   /applicants/{id}/bank/entries/{entry_id}/bullets  BulletCreate -> 201 BulletResponse (appended)
PATCH  /applicants/{id}/bank/bullets/{bullet_id} BulletUpdate -> BulletResponse
DELETE /applicants/{id}/bank/bullets/{bullet_id} -> 204
POST   /applicants/{id}/bank/skills              SkillCreate -> 201 SkillResponse (409 if the name exists)
PATCH  /applicants/{id}/bank/skills/{skill_id}   SkillUpdate -> SkillResponse (409 if the name exists)
DELETE /applicants/{id}/bank/skills/{skill_id}   -> 204 (its links too)
PUT    /applicants/{id}/bank/skills/{skill_id}/entries/{entry_id} -> 204
       link the skill to the entry (KAN-216); linking twice is a no-op.
DELETE /applicants/{id}/bank/skills/{skill_id}/entries/{entry_id} -> 204
       (404 when there is no such link)
POST   /applicants/{id}/bank/import              ImportRequest -> ImportResponse
       Import (KAN-211): reads one uploaded resume (resume_id, else the
       default resume, else the newest) with the heuristic parser and returns
       draft entries and draft skills. It writes nothing: the student saves
       drafts through POST /entries and POST /skills. A draft matching a bank
       entry carries its id in `duplicate_of`; a skill already in the bank has
       `in_bank: true`. A resume the parser cannot read gives empty lists; no
       uploaded resume (or another student's) answers 404.
       Model parsing (KAN-222): `read_with_ai: true` ("Read it again with
       AI") reads the resume with the model instead; the model is also the
       fallback when the parser finds no entries. Each model reading counts
       one parsing use (cap 1, 10% of the pool) only when it succeeds; the
       response says `read_by` ("parser" or "model") and `uses_left`. An
       asked-for reading answers 429 at the limit and 503 when the model is
       down or answers in the wrong shape; the fallback then keeps the
       parser's reading.

A SkillResponse carries `entry_ids`: its linked entries, in bank order.
"""

import logging
import uuid
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import APIRouter, Depends, HTTPException, Response
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession
from workit_scout.llm import LLM, OUT_OF_QUOTA, InvalidReply, ScoutUnavailable

from app.db import get_session
from app.deps import assert_applicant_owns, get_current_account
from app.models.dto import ParsedResume
from app.models.profiles import Applicant_Profile
from app.models.resume import Resume
from app.routers.scout import get_llm
from app.schemas.auth import AuthenticatedAccount
from app.schemas.bank import (
    BankResponse,
    BulletCreate,
    BulletResponse,
    BulletUpdate,
    DuplicateEntry,
    EntryCreate,
    EntryResponse,
    EntryUpdate,
    ImportRequest,
    ImportResponse,
    SkillCreate,
    SkillResponse,
    SkillUpdate,
)
from app.services import bank as service
from app.services import built_resumes
from app.services.bank import bank_response, entry_response, skill_response
from app.services.bank_import import (
    draft_entries,
    draft_skills,
    model_drafts,
    model_skills,
    parsed_skills,
    read_with_model,
)
from app.services.identity import load_identity
from app.services.usage import Feature, count_use, uses_left
from app.utils.resume_parser import parse_resume

router = APIRouter(prefix="/applicants/{applicant_id}/bank", tags=["bank"])
logger = logging.getLogger(__name__)


async def owned_applicant(
    applicant_id: uuid.UUID,
    account: AuthenticatedAccount = Depends(get_current_account),
) -> uuid.UUID:
    assert_applicant_owns(account, applicant_id)
    return applicant_id


@asynccontextmanager
async def _writing(session: AsyncSession) -> AsyncIterator[None]:
    """Commit on success; turn the service's errors into HTTP answers."""
    try:
        yield
        await session.commit()
    except service.NotFound:
        await session.rollback()
        raise HTTPException(404, "Not found in your experience bank")
    except service.DuplicateSkillError:
        await session.rollback()
        raise HTTPException(409, "That skill is already in your experience bank")
    except ValidationError as exc:
        await session.rollback()
        raise RequestValidationError(exc.errors(include_url=False, include_context=False))
    except SQLAlchemyError:
        await session.rollback()
        raise HTTPException(500, "Failed to save your experience bank")


@router.get("", response_model=BankResponse)
async def get_bank(
    applicant_id: uuid.UUID = Depends(owned_applicant),
    session: AsyncSession = Depends(get_session),
) -> BankResponse:
    return bank_response(await service.load_bank(session, applicant_id))


@router.post(
    "/entries",
    status_code=201,
    response_model=EntryResponse,
    responses={409: {"model": DuplicateEntry}},
)
async def create_entry(
    body: EntryCreate,
    allow_duplicate: bool = False,
    applicant_id: uuid.UUID = Depends(owned_applicant),
    session: AsyncSession = Depends(get_session),
):
    try:
        async with _writing(session):
            entry = await service.create_entry(
                session, applicant_id, body, body.bullets, allow_duplicate=allow_duplicate
            )
    except service.DuplicateEntryError as exc:
        # Built before the rollback, which expires the loaded rows.
        payload = DuplicateEntry(detail=str(exc), duplicate=entry_response(exc.existing))
        await session.rollback()
        return JSONResponse(status_code=409, content=payload.model_dump(mode="json"))
    return entry_response(entry)


@router.patch("/entries/{entry_id}", response_model=EntryResponse)
async def update_entry(
    entry_id: uuid.UUID,
    body: EntryUpdate,
    applicant_id: uuid.UUID = Depends(owned_applicant),
    session: AsyncSession = Depends(get_session),
) -> EntryResponse:
    async with _writing(session):
        entry = await service.update_entry(
            session, applicant_id, entry_id, body.model_dump(include=body.model_fields_set)
        )
    return entry_response(entry)


@router.delete("/entries/{entry_id}", status_code=204)
async def delete_entry(
    entry_id: uuid.UUID,
    applicant_id: uuid.UUID = Depends(owned_applicant),
    session: AsyncSession = Depends(get_session),
) -> Response:
    async with _writing(session):
        await service.delete_entry(session, applicant_id, entry_id)
    return Response(status_code=204)


@router.get("/entries/{entry_id}/resumes")
async def entry_resumes(
    entry_id: uuid.UUID,
    applicant_id: uuid.UUID = Depends(owned_applicant),
    session: AsyncSession = Depends(get_session),
) -> dict[str, int]:
    try:
        count = await built_resumes.count_showing_entry(session, applicant_id, entry_id)
    except service.NotFound:
        raise HTTPException(404, "Not found in your experience bank")
    return {"built_resumes": count}


@router.post("/entries/{entry_id}/bullets", status_code=201, response_model=BulletResponse)
async def add_bullet(
    entry_id: uuid.UUID,
    body: BulletCreate,
    applicant_id: uuid.UUID = Depends(owned_applicant),
    session: AsyncSession = Depends(get_session),
) -> BulletResponse:
    async with _writing(session):
        bullet = await service.add_bullet(session, applicant_id, entry_id, body.text)
    return BulletResponse.model_validate(bullet)


@router.patch("/bullets/{bullet_id}", response_model=BulletResponse)
async def update_bullet(
    bullet_id: uuid.UUID,
    body: BulletUpdate,
    applicant_id: uuid.UUID = Depends(owned_applicant),
    session: AsyncSession = Depends(get_session),
) -> BulletResponse:
    async with _writing(session):
        bullet = await service.update_bullet(
            session, applicant_id, bullet_id, text=body.text, position=body.position
        )
    return BulletResponse.model_validate(bullet)


@router.delete("/bullets/{bullet_id}", status_code=204)
async def delete_bullet(
    bullet_id: uuid.UUID,
    applicant_id: uuid.UUID = Depends(owned_applicant),
    session: AsyncSession = Depends(get_session),
) -> Response:
    async with _writing(session):
        await service.delete_bullet(session, applicant_id, bullet_id)
    return Response(status_code=204)


@router.post("/skills", status_code=201, response_model=SkillResponse)
async def add_skill(
    body: SkillCreate,
    applicant_id: uuid.UUID = Depends(owned_applicant),
    session: AsyncSession = Depends(get_session),
) -> SkillResponse:
    async with _writing(session):
        skill = await service.add_skill(session, applicant_id, body.name, body.group)
    return SkillResponse.model_validate(skill)


@router.patch("/skills/{skill_id}", response_model=SkillResponse)
async def update_skill(
    skill_id: uuid.UUID,
    body: SkillUpdate,
    applicant_id: uuid.UUID = Depends(owned_applicant),
    session: AsyncSession = Depends(get_session),
) -> SkillResponse:
    async with _writing(session):
        skill = await service.update_skill(
            session, applicant_id, skill_id, body.model_dump(include=body.model_fields_set)
        )
        entry_ids = await service.linked_entry_ids(session, skill.id)
    return skill_response(skill, entry_ids)


@router.delete("/skills/{skill_id}", status_code=204)
async def delete_skill(
    skill_id: uuid.UUID,
    applicant_id: uuid.UUID = Depends(owned_applicant),
    session: AsyncSession = Depends(get_session),
) -> Response:
    async with _writing(session):
        await service.delete_skill(session, applicant_id, skill_id)
    return Response(status_code=204)


async def _resume_to_import(session: AsyncSession, applicant_id: uuid.UUID, resume_id: uuid.UUID | None) -> Resume:
    mine = select(Resume).where(Resume.applicant_id == applicant_id)
    if resume_id is not None:
        resume = await session.scalar(mine.where(Resume.id == resume_id))
    else:
        default_id = await session.scalar(
            select(Applicant_Profile.default_resume_id).where(Applicant_Profile.id == applicant_id)
        )
        resume = default_id and await session.scalar(mine.where(Resume.id == default_id))
        resume = resume or await session.scalar(mine.order_by(Resume.created_at.desc()).limit(1))
    if resume is None:
        raise HTTPException(404, "Upload a resume to import it")
    return resume


def _parse(raw_text: str | None) -> ParsedResume:
    if raw_text:
        try:
            return parse_resume(raw_text) or ParsedResume()
        except Exception:
            logger.exception("Resume parsing failed during import")
    return ParsedResume()


AI_BUSY = "WorkIt has hit today's AI limit. Use these drafts, or try again tomorrow."
AI_OFFLINE = "WorkIt can't read it with AI right now. Try again in a minute."
AI_LOST = "WorkIt couldn't make sense of that reading. Try again."
AI_SPENT = "You've used today's AI reading. It resets at midnight UTC."


def _ai_message(exc: ScoutUnavailable) -> str:
    if isinstance(exc, InvalidReply):
        return AI_LOST
    return AI_BUSY if str(exc) == OUT_OF_QUOTA else AI_OFFLINE


@router.post("/import", response_model=ImportResponse)
async def import_resume(
    body: ImportRequest,
    applicant_id: uuid.UUID = Depends(owned_applicant),
    account: AuthenticatedAccount = Depends(get_current_account),
    llm: LLM = Depends(get_llm),
    session: AsyncSession = Depends(get_session),
) -> ImportResponse:
    resume = await _resume_to_import(session, applicant_id, body.resume_id)
    left = await uses_left(session, applicant_id, Feature.PARSING)
    # The stored text, read again, so a resume uploaded before the parser
    # learned a section still imports it.
    parsed = _parse(resume.raw_text)
    entries, skills, read_by = draft_entries(parsed), parsed_skills(parsed), "parser"

    # The model reads it when asked, and as the fallback when the parser
    # found no entries. Only the asked-for reading reports a failure; the
    # fallback quietly keeps the parser's (empty) reading.
    if resume.raw_text and (body.read_with_ai or not entries):
        if left <= 0:
            if body.read_with_ai:
                raise HTTPException(429, AI_SPENT)
        else:
            identity = await load_identity(session, account)
            try:
                reading = await read_with_model(resume.raw_text, llm, identity=identity)
            except ScoutUnavailable as exc:
                if body.read_with_ai:
                    raise HTTPException(503, _ai_message(exc)) from exc
            else:
                await count_use(session, applicant_id, Feature.PARSING)
                await session.commit()
                left -= 1
                entries, skills, read_by = model_drafts(reading), model_skills(reading), "model"

    for draft in entries:
        match = await service.find_duplicate(session, applicant_id, draft.section, draft.title, draft.organization)
        draft.duplicate_of = match.row.id if match else None
    bank_names = {s.name.lower() for s in (await service.load_bank(session, applicant_id)).skills}
    return ImportResponse(
        resume_id=resume.id,
        filename=resume.original_filename,
        entries=entries,
        skills=draft_skills(skills, bank_names),
        read_by=read_by,
        uses_left=left,
    )


@router.put("/skills/{skill_id}/entries/{entry_id}", status_code=204)
async def link_skill(
    skill_id: uuid.UUID,
    entry_id: uuid.UUID,
    applicant_id: uuid.UUID = Depends(owned_applicant),
    session: AsyncSession = Depends(get_session),
) -> Response:
    async with _writing(session):
        await service.link_skill(session, applicant_id, skill_id, entry_id)
    return Response(status_code=204)


@router.delete("/skills/{skill_id}/entries/{entry_id}", status_code=204)
async def unlink_skill(
    skill_id: uuid.UUID,
    entry_id: uuid.UUID,
    applicant_id: uuid.UUID = Depends(owned_applicant),
    session: AsyncSession = Depends(get_session),
) -> Response:
    async with _writing(session):
        await service.unlink_skill(session, applicant_id, skill_id, entry_id)
    return Response(status_code=204)
