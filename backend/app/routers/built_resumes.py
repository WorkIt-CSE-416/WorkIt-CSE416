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
       {pdf (base64), page_count, missing_characters}: the characters the
       template's font cannot draw, for the warning before download.
       503 {detail} when Tectonic is missing or the compile fails.
GET    /applicants/{id}/built-resumes/{rid}/docx   -> the Word file, as an attachment
"""

import asyncio
import base64
import logging
import re
import uuid

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_session
from app.deps import assert_applicant_owns, get_current_account
from app.models.built_resume import Built_Resume
from app.models.profiles import Applicant_Profile
from app.schemas.auth import AuthenticatedAccount
from app.schemas.built_resume import (
    BuiltResumeCreate,
    BuiltResumeResponse,
    RenderResponse,
)
from app.services import built_resumes as service
from app.services.bank import NotFound
from app.services.resume_render import Identity, TectonicUnavailable, render
from app.services.resume_render.word import render_docx

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


async def _identity(session: AsyncSession, applicant_id: uuid.UUID) -> Identity:
    profile = await session.get(Applicant_Profile, applicant_id)
    if profile is None:
        raise HTTPException(404, "Applicant not found")
    return Identity(
        name=profile.full_name,
        email=profile.email,
        phone=profile.phone_number,
        links=tuple(
            u for u in (profile.linkedin_url, profile.github_url, profile.portfolio_url, profile.other_url) if u
        ),
    )


def _filename(name: str, ext: str) -> str:
    # Header-safe: letters, digits, spaces, dashes and underscores only
    stem = re.sub(r"[^A-Za-z0-9 _-]+", "", name).strip() or "Resume"
    return f"{stem}.{ext}"


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
        missing_characters=list(rendered.missing_characters),
    )


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
        headers={"Content-Disposition": f'attachment; filename="{_filename(resume.name, "docx")}"'},
    )
