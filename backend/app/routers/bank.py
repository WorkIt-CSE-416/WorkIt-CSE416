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
       ?resume_id= saves it into the resume the Experiences view shows: an
       upload owns it (ADR 0005); a built resume shows it, at the end of its
       section. Without one, it is the student's own. 404 for a resume that
       is not the applicant's.
       409 {detail, duplicate: EntryResponse} when section, title and
       organization match an entry of the same owner, ignoring case;
       ?allow_duplicate=true saves it anyway ("Save as new").
PATCH  /applicants/{id}/bank/entries/{entry_id}  EntryUpdate -> EntryResponse
DELETE /applicants/{id}/bank/entries/{entry_id}  -> 204 (its bullets too)
GET    /applicants/{id}/bank/entries/{entry_id}/resumes -> {"built_resumes": n}
       how many built resumes show the entry, for the delete confirm (story 18)
POST   /applicants/{id}/bank/entries/{entry_id}/bullets  BulletCreate -> 201 BulletResponse (appended)
PATCH  /applicants/{id}/bank/bullets/{bullet_id} BulletUpdate -> BulletResponse
DELETE /applicants/{id}/bank/bullets/{bullet_id} -> 204
POST   /applicants/{id}/bank/skills              SkillCreate -> 201 SkillResponse
       ?resume_id= as for entries; 409 if the owner has the name already
PATCH  /applicants/{id}/bank/skills/{skill_id}   SkillUpdate -> SkillResponse (409 if the name exists)
DELETE /applicants/{id}/bank/skills/{skill_id}   -> 204
POST   /applicants/{id}/bank/import              ImportRequest -> ImportResponse
       Import Again: reads one uploaded resume (resume_id, else the default
       resume, else the newest) with the heuristic parser and writes it into
       the bank with `import_upload`, as upload does: the reading replaces
       the entries and skills the upload owns (ADR 0005). Answers what it
       wrote (`entries_added`, `skills_added`). A resume the parser cannot
       read leaves the upload with nothing; no uploaded resume (or another
       student's) answers 404.
       Model parsing (KAN-222): `read_with_ai: true` ("Read It With AI")
       reads the resume with the model instead. Only the student asks for
       it; the API never falls back to the model by itself. A reading counts
       one parsing use (cap 1, 10% of the pool) only when it succeeds, with
       the bank writes; the response says `read_by` ("parser" or "model")
       and `uses_left`. It answers 429 at the limit and 503 when the model
       is down or answers in the wrong shape, and then writes nothing.

GET /bank also sends `resumes` (every uploaded, base and tailored resume,
with `kind`, `name`, a tailored one's `posting` and the starred one's
`primary`) and, on each entry and skill, `resume_ids`: the upload that owns
it, if any, then the built resumes that show it (KAN-343, ADR 0005).
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
from workit_scout.llm import LLM, ScoutUnavailable

from app.db import get_session
from app.deps import get_current_account, owned_applicant
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
from app.services.ai_messages import AIMessages
from app.services.bank import bank_response, entry_response
from app.services.bank_import import (
    model_drafts,
    model_skills,
    read,
    read_with_model,
    skill_pairs,
)
from app.services.identity import load_identity
from app.services.usage import Feature, count_use, uses_left

router = APIRouter(prefix="/applicants/{applicant_id}/bank", tags=["bank"])
logger = logging.getLogger(__name__)


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
    bank = await service.load_bank(session, applicant_id)
    return bank_response(bank, await service.load_holdings(session, applicant_id))


async def _target(
    session: AsyncSession, applicant_id: uuid.UUID, resume_id: uuid.UUID | None
) -> tuple[uuid.UUID | None, uuid.UUID | None]:
    """Where an Add under a resume pick goes: (the upload that will own the
    item, the built resume that will show it), at most one of them. Raises
    NotFound for a resume that is not the applicant's."""
    if resume_id is None:
        return None, None
    upload = await session.scalar(
        select(Resume.id).where(Resume.id == resume_id, Resume.applicant_id == applicant_id)
    )
    if upload is not None:
        return upload, None
    await built_resumes.get_resume(session, applicant_id, resume_id)
    return None, resume_id


@router.post(
    "/entries",
    status_code=201,
    response_model=EntryResponse,
    responses={409: {"model": DuplicateEntry}},
)
async def create_entry(
    body: EntryCreate,
    allow_duplicate: bool = False,
    resume_id: uuid.UUID | None = None,
    applicant_id: uuid.UUID = Depends(owned_applicant),
    session: AsyncSession = Depends(get_session),
):
    try:
        async with _writing(session):
            owner, built = await _target(session, applicant_id, resume_id)
            entry = await service.create_entry(
                session, applicant_id, body, body.bullets, resume_id=owner, allow_duplicate=allow_duplicate
            )
            if built is not None:
                await built_resumes.update_choices(
                    session, applicant_id, built, entries=[{"entry_id": entry.row.id, "shown": True}]
                )
    except service.DuplicateEntryError as exc:
        # Built before the rollback, which expires the loaded rows.
        payload = DuplicateEntry(detail=str(exc), duplicate=entry_response(exc.existing))
        await session.rollback()
        return JSONResponse(status_code=409, content=payload.model_dump(mode="json"))
    # The pick holds it now, so the page shows it there at once.
    return entry_response(entry, [i for i in (owner, built) if i is not None])


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
    resume_id: uuid.UUID | None = None,
    applicant_id: uuid.UUID = Depends(owned_applicant),
    session: AsyncSession = Depends(get_session),
) -> SkillResponse:
    async with _writing(session):
        owner, built = await _target(session, applicant_id, resume_id)
        skill = await service.add_skill(session, applicant_id, body.name, body.group, resume_id=owner)
        if built is not None:
            await built_resumes.update_choices(
                session, applicant_id, built, skills=[{"skill_id": skill.id, "shown": True}]
            )
    return service.skill_response(skill, [i for i in (owner, built) if i is not None])


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
    return SkillResponse.model_validate(skill)


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
    from app.queries.bank import resume_to_import
    resume = await resume_to_import(session, applicant_id, resume_id)
    if resume is None:
        raise HTTPException(404, "Upload a resume to import it")
    return resume


AI = AIMessages(
    spent="You've used today's AI reading. It resets at midnight UTC.",
    offline="WorkIt can't read it with AI right now. Try again in a minute.",
    lost="WorkIt couldn't make sense of that reading. Try again.",
    # What the parser read is already in the bank.
    busy="WorkIt has hit today's AI limit. Try again tomorrow.",
)


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
    read_by = "parser"
    if not body.read_with_ai:
        # The stored text, read again, so a resume uploaded before a parser
        # fix gets the fix.
        entries, skills = read(resume.raw_text)
    elif not resume.raw_text:
        entries, skills = [], []
    elif left <= 0:
        raise HTTPException(429, AI.spent)
    else:
        identity = await load_identity(session, account)
        try:
            reading = await read_with_model(resume.raw_text, llm, identity=identity)
        except ScoutUnavailable as exc:
            raise HTTPException(503, AI.failure(exc)) from exc
        # Counted with the bank writes below, so a failed save counts nothing.
        await count_use(session, applicant_id, Feature.PARSING)
        left -= 1
        entries, skills, read_by = model_drafts(reading), skill_pairs(model_skills(reading)), "model"

    async with _writing(session):
        imported = await service.import_upload(session, applicant_id, resume.id, entries, skills)
    return ImportResponse(
        resume_id=resume.id,
        filename=resume.original_filename,
        found=len(entries) + len(skills),
        entries_added=imported.entries_added,
        skills_added=imported.skills_added,
        read_by=read_by,
        uses_left=left,
    )

