"""Built resumes under /applicants/{applicant_id}/built-resumes (KAN-207).
Every route checks the token's account owns `applicant_id` first; another
applicant's resume answers 404. The rules (the 5-resume limit, the default
resume) live in `app/services/built_resumes.py`; what shows on a resume is
`app/services/resume_view.py`.

POST   /applicants/{id}/built-resumes              BuiltResumeCreate -> 201 BuiltResumeResponse
       Generate: a base resume with every bank entry, bullet and skill.
       409 {detail} when the student already has 5 resumes (uploaded plus base).
GET    /applicants/{id}/built-resumes              -> [BuiltResumeResponse], newest first
DELETE /applicants/{id}/built-resumes/{rid}        -> 204
PUT    /applicants/{id}/built-resumes/{rid}/default -> {"default_built_resume_id"}
       Makes a base resume the default resume, clearing an uploaded default.
GET    /applicants/{id}/built-resumes/{rid}/render -> RenderResponse
       {pdf (base64), page_count, missing_characters, boxes}: the characters
       the template's font cannot draw, for the warning before download, and
       a box per line for the editor's click targets (schemas: RenderBox).
       503 {detail} when Tectonic is missing or the compile fails.
GET    /applicants/{id}/built-resumes/{rid}/choices -> ChoicesResponse
       The resume's choice rows (KAN-218): what shows, in what order, the
       GPA and coursework toggles. A bank item with no row is not on it.
PATCH  /applicants/{id}/built-resumes/{rid}/choices ChoicesUpdate -> ChoicesResponse
       The editor's hide, show, move and toggles, all saved together. An
       item with no row gets one. 404 for an item outside the bank.
GET    /applicants/{id}/built-resumes/{rid}/docx   -> the Word file, as an attachment
GET    /applicants/{id}/built-resumes/{rid}/keyword-match?job_posting_id=
       -> KeywordMatchResponse {job_posting_id, matched, missing, uses_left}
       The keyword match ("12 of 18") against a posting; with no
       job_posting_id, a tailored resume's own posting (else 422). The
       posting's keywords are extracted once and cached
       (app/services/keywords.py); only an extraction spends a Tailor use:
       429 at the limit, 503 when the model fails or answers out of schema
       (nothing counted). 404 for an unknown posting.
"""

import asyncio
import base64
import logging
import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import undefer
from workit_scout.llm import LLM, OUT_OF_QUOTA, InvalidReply, ScoutUnavailable

from app.db import get_session
from app.deps import assert_applicant_owns, get_current_account
from app.models.built_resume import Built_Resume
from app.models.jobs import Job_Post
from app.routers.scout import get_llm
from app.schemas.auth import AuthenticatedAccount
from app.schemas.built_resume import (
    BuiltResumeCreate,
    BuiltResumeResponse,
    BulletChoiceResponse,
    ChoicesResponse,
    ChoicesUpdate,
    EntryChoiceResponse,
    RenderBox,
    RenderResponse,
    SkillChoiceResponse,
)
from app.schemas.keywords import KeywordMatchResponse
from app.services import built_resumes as service
from app.services import keywords
from app.services.bank import NotFound
from app.services.resume_render import Identity, TectonicUnavailable, render
from app.services.resume_render.word import render_docx
from app.services.usage import Feature, count_use, uses_left

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/applicants/{applicant_id}/built-resumes", tags=["built-resumes"])

DOCX_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"


async def owned_applicant(
    applicant_id: uuid.UUID,
    account: AuthenticatedAccount = Depends(get_current_account),
) -> uuid.UUID:
    assert_applicant_owns(account, applicant_id)
    return applicant_id


def _response(row: Built_Resume, default_id: uuid.UUID | None) -> BuiltResumeResponse:
    return BuiltResumeResponse(
        id=row.id, name=row.name, template=row.template, job_posting_id=row.job_posting_id,
        is_default=row.id == default_id, created_at=row.created_at,
    )


async def _commit(session: AsyncSession, failure: str) -> None:
    try:
        await session.commit()
    except SQLAlchemyError:
        await session.rollback()
        logger.exception(failure)
        raise HTTPException(500, failure)


async def _identity(session: AsyncSession, applicant_id: uuid.UUID) -> Identity:
    try:
        return await service.load_identity(session, applicant_id)
    except NotFound:
        raise HTTPException(404, "Applicant not found")


async def _owned(session: AsyncSession, applicant_id: uuid.UUID, resume_id: uuid.UUID) -> Built_Resume:
    try:
        return await service.get_resume(session, applicant_id, resume_id)
    except NotFound:
        raise HTTPException(404, "Resume not found")


@router.post("", status_code=201, response_model=BuiltResumeResponse)
async def generate(
    body: BuiltResumeCreate,
    applicant_id: uuid.UUID = Depends(owned_applicant),
    session: AsyncSession = Depends(get_session),
) -> BuiltResumeResponse:
    try:
        resume = await service.generate(session, applicant_id, body.name)
    except service.ResumeLimitReached as exc:
        raise HTTPException(409, str(exc))
    await _commit(session, "Failed to save the resume")
    return _response(resume, None)


@router.get("", response_model=list[BuiltResumeResponse])
async def list_built_resumes(
    applicant_id: uuid.UUID = Depends(owned_applicant),
    session: AsyncSession = Depends(get_session),
) -> list[BuiltResumeResponse]:
    default_id = await service.default_built_id(session, applicant_id)
    return [_response(r, default_id) for r in await service.list_resumes(session, applicant_id)]


@router.delete("/{resume_id}", status_code=204)
async def delete_built_resume(
    resume_id: uuid.UUID,
    applicant_id: uuid.UUID = Depends(owned_applicant),
    session: AsyncSession = Depends(get_session),
) -> Response:
    await _owned(session, applicant_id, resume_id)
    await service.delete_resume(session, applicant_id, resume_id)
    await _commit(session, "Failed to delete the resume")
    return Response(status_code=204)


@router.put("/{resume_id}/default")
async def set_default(
    resume_id: uuid.UUID,
    applicant_id: uuid.UUID = Depends(owned_applicant),
    session: AsyncSession = Depends(get_session),
) -> dict[str, str]:
    try:
        await service.set_default(session, applicant_id, built_id=resume_id)
    except NotFound:
        raise HTTPException(404, "Resume not found")
    await _commit(session, "Failed to set the default resume")
    return {"default_built_resume_id": str(resume_id)}


@router.get("/{resume_id}/render", response_model=RenderResponse)
async def render_pdf(
    resume_id: uuid.UUID,
    applicant_id: uuid.UUID = Depends(owned_applicant),
    session: AsyncSession = Depends(get_session),
) -> RenderResponse:
    try:
        resume, view = await service.load_view(session, applicant_id, resume_id)
    except NotFound:
        raise HTTPException(404, "Resume not found")
    identity = await _identity(session, applicant_id)
    try:
        rendered = await asyncio.to_thread(render, view, identity, resume.template)
    except TectonicUnavailable as exc:
        logger.error("resume render failed: %s", exc)
        raise HTTPException(503, "The PDF could not be made. Try again, or download the Word file.") from exc
    return RenderResponse(
        pdf=base64.b64encode(rendered.pdf).decode("ascii"),
        page_count=rendered.page_count,
        lines_over=rendered.lines_over,
        missing_characters=list(rendered.missing_characters),
        boxes=[RenderBox(**vars(box)) for box in rendered.boxes],
    )


async def _choices(session: AsyncSession, resume_id: uuid.UUID) -> ChoicesResponse:
    choices = await service.load_choices(session, resume_id)
    return ChoicesResponse(
        entries=[EntryChoiceResponse(entry_id=i, shown=c.shown, position=c.position, show_gpa=c.show_gpa,
                                     show_coursework=c.show_coursework) for i, c in choices.entries.items()],
        bullets=[BulletChoiceResponse(bullet_id=i, shown=c.shown, position=c.position)
                 for i, c in choices.bullets.items()],
        skills=[SkillChoiceResponse(skill_id=i, shown=c.shown, position=c.position)
                for i, c in choices.skills.items()],
    )


@router.get("/{resume_id}/choices", response_model=ChoicesResponse)
async def get_choices(
    resume_id: uuid.UUID,
    applicant_id: uuid.UUID = Depends(owned_applicant),
    session: AsyncSession = Depends(get_session),
) -> ChoicesResponse:
    await _owned(session, applicant_id, resume_id)
    return await _choices(session, resume_id)


@router.patch("/{resume_id}/choices", response_model=ChoicesResponse)
async def update_choices(
    body: ChoicesUpdate,
    resume_id: uuid.UUID,
    applicant_id: uuid.UUID = Depends(owned_applicant),
    session: AsyncSession = Depends(get_session),
) -> ChoicesResponse:
    try:
        await service.update_choices(
            session, applicant_id, resume_id,
            entries=[c.model_dump(exclude_unset=True) for c in body.entries],
            bullets=[c.model_dump(exclude_unset=True) for c in body.bullets],
            skills=[c.model_dump(exclude_unset=True) for c in body.skills],
        )
    except NotFound:
        raise HTTPException(404, "Resume or bank item not found")
    await _commit(session, "Failed to save the resume")
    return await _choices(session, resume_id)


@router.get("/{resume_id}/docx")
async def download_docx(
    resume_id: uuid.UUID,
    applicant_id: uuid.UUID = Depends(owned_applicant),
    session: AsyncSession = Depends(get_session),
) -> Response:
    try:
        resume, view = await service.load_view(session, applicant_id, resume_id)
    except NotFound:
        raise HTTPException(404, "Resume not found")
    identity = await _identity(session, applicant_id)
    data = await asyncio.to_thread(render_docx, view, identity)
    return Response(
        data,
        media_type=DOCX_TYPE,
        headers={"Content-Disposition": f'attachment; filename="{service.file_name(resume.name, "docx")}"'},
    )


AI_SPENT = "You've used today's Tailor runs. They reset at midnight UTC."
AI_BUSY = "WorkIt has hit today's AI limit. Try again tomorrow."
AI_OFFLINE = "WorkIt can't read this posting's keywords right now. Try again in a minute."
AI_LOST = "WorkIt couldn't make sense of this posting's keywords. Try again."


def _ai_message(exc: ScoutUnavailable) -> str:
    if isinstance(exc, InvalidReply):
        return AI_LOST
    return AI_BUSY if str(exc) == OUT_OF_QUOTA else AI_OFFLINE


@router.get("/{resume_id}/keyword-match", response_model=KeywordMatchResponse)
async def keyword_match(
    resume_id: uuid.UUID,
    job_posting_id: uuid.UUID | None = Query(None),
    applicant_id: uuid.UUID = Depends(owned_applicant),
    llm: LLM = Depends(get_llm),
    session: AsyncSession = Depends(get_session),
) -> KeywordMatchResponse:
    try:
        resume, view = await service.load_view(session, applicant_id, resume_id)
    except NotFound:
        raise HTTPException(404, "Resume not found")
    posting_id = job_posting_id or resume.job_posting_id
    if posting_id is None:
        raise HTTPException(422, "Choose a job posting to match against")
    job = await session.get(
        Job_Post, posting_id, options=[undefer(Job_Post.keywords), undefer(Job_Post.keywords_hash)])
    if job is None:
        raise HTTPException(404, "Job posting not found")

    left = await uses_left(session, applicant_id, Feature.TAILOR)
    found = keywords.cached(job)
    if found is None:
        if left <= 0:
            raise HTTPException(429, AI_SPENT)
        try:
            found = await keywords.extract(job, llm)
        except ScoutUnavailable as exc:
            raise HTTPException(503, _ai_message(exc)) from exc
        keywords.store(job, found)
        # count_use commits, saving the cache with the count.
        await count_use(session, applicant_id, Feature.TAILOR)
        left -= 1
    matched, missing = keywords.match(view, found)
    return KeywordMatchResponse(job_posting_id=job.id, matched=matched, missing=missing, uses_left=left)
