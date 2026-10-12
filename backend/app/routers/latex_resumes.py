"""
An applicant's own LaTeX resume (KAN-176): paste it in, edit its words, see
it compiled, and tailor its bullets to a job posting. services/latex_source
does the reading and the safety; this file is the HTTP and the rows.

A LaTeX resume is an ordinary `resumes` row with `template_key` "latex" and
`latex_source` set, so the profile's list, star and delete work on it and it
counts toward the 5. Its PDF is the source compiled on each request
(resume_builder.download). `parsed_json` is the compiled PDF read back by the
resume parser, so matching and Scout see it as they see any resume.

Every request carries the source it was made against, and ops on it by field
id; nothing is held between calls. Only bullets ever reach a model, never the
name, contact line or anything else in the source.
"""

import asyncio
import uuid

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from workit_scout.builder import tailor_bullets
from workit_scout.facts import job_facts
from workit_scout.llm import LLM, ScoutUnavailable
from workit_scout.quota import DailyQuota

from app.db import get_session
from app.deps import assert_applicant_owns, get_current_account
from app.models.dto import ResumeStatus
from app.models.resume import Resume
from app.routers.experience import take_builder_call
from app.routers.jobs import fetch_listing
from app.routers.resumes import MAX_RESUMES, get_owned_resume
from app.routers.scout import get_llm
from app.schemas.auth import AuthenticatedAccount
from app.schemas.experience import GeneratedResume
from app.schemas.latex import (
    LatexDoc,
    LatexField,
    LatexImport,
    LatexSaved,
    LatexSource,
    LatexSuggestion,
    LatexTailorRequest,
    LatexTailorResponse,
)
from app.services.latex_source import compile_source, read_back
from app.services.latex_source.fields import fields
from app.services.latex_source.inline import remarked, unmarked
from app.services.latex_source.safety import Refused
from app.services.latex_source.splice import Unapplicable, apply
from app.services.matching.overlap import rank_against_job
from app.services.resume_render.to_latex import LatexError, LatexUnavailable
from app.services.tailoring import MAX_REWRITES

router = APIRouter()

LATEX = "latex"
# Compiles per account per day. The editor previews about a second after
# typing stops, so a long session makes a few hundred; each one is about a
# second of a function's CPU
compile_quota = DailyQuota()
DAILY_COMPILES = 600


def _doc(source: str) -> LatexDoc:
    return LatexDoc(source=source, fields=[
        LatexField(id=f.id, kind=f.kind, text=f.text, editable=f.editable, section=f.section, line=f.line)
        for f in fields(source)
    ])


def _applied(body: LatexSource) -> str:
    try:
        return apply(body.source, [op.op() for op in body.ops])
    except Unapplicable as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, str(exc)) from exc


async def compiled(account: AuthenticatedAccount, source: str) -> tuple[bytes, int]:
    '''The source as a PDF, or an HTTP error saying what to fix.'''
    if not compile_quota.take(account.id, DAILY_COMPILES):
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS,
                            "You've compiled a lot today. Previews resume at midnight UTC.")
    try:
        return await asyncio.to_thread(compile_source, source)
    except Refused as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, str(exc)) from exc
    except LatexError as exc:
        where = f"Line {exc.line}: " if exc.line else ""
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, f"{where}{exc.message}") from exc
    except LatexUnavailable as exc:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE,
                            "LaTeX can't be compiled right now. Try again in a minute.") from exc


async def _owned_latex(db: AsyncSession, applicant_id: uuid.UUID, resume_id: uuid.UUID) -> Resume:
    resume = await get_owned_resume(db, applicant_id, resume_id)
    if resume.template_key != LATEX or not resume.latex_source:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "That resume isn't a LaTeX resume")
    return resume


def _filename(name: str) -> str:
    stem = "".join(c for c in name if c.isalnum() or c in " -_").strip() or "Resume"
    return f"{stem}.pdf"


@router.post("/applicants/{applicant_id}/latex/fields")
async def read_fields(
    applicant_id: uuid.UUID,
    body: LatexSource,
    account: AuthenticatedAccount = Depends(get_current_account),
) -> LatexDoc:
    """The source with `ops` applied, and its fields. Saves and compiles
    nothing: the Words view calls it to add or remove a bullet, and after an
    edit in the Source tab."""
    assert_applicant_owns(account, applicant_id)
    return _doc(_applied(body))


@router.post("/applicants/{applicant_id}/latex/preview")
async def preview(
    applicant_id: uuid.UUID,
    body: LatexSource,
    account: AuthenticatedAccount = Depends(get_current_account),
) -> Response:
    """The source with `ops` applied, compiled. Saves nothing. X-Pages says
    how many pages it ran to."""
    assert_applicant_owns(account, applicant_id)
    pdf, pages = await compiled(account, _applied(body))
    return Response(pdf, media_type="application/pdf",
                    headers={"X-Pages": str(pages), "Cache-Control": "private, no-store"})


@router.post("/applicants/{applicant_id}/latex", status_code=status.HTTP_201_CREATED)
async def import_latex(
    applicant_id: uuid.UUID,
    body: LatexImport,
    account: AuthenticatedAccount = Depends(get_current_account),
    db: AsyncSession = Depends(get_session),
) -> GeneratedResume:
    """Saves a LaTeX resume as a new row: one pasted in, or a copy tailored to
    `target_job_id`. Compiled first, so a source that doesn't compile is
    never saved."""
    assert_applicant_owns(account, applicant_id)
    source = _applied(body)
    held = await db.scalar(select(func.count()).select_from(Resume).where(Resume.applicant_id == applicant_id))
    if held >= MAX_RESUMES:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"You already have {MAX_RESUMES} resumes. Delete one in My Profile to save another.",
        )
    if body.target_job_id and await fetch_listing(db, str(body.target_job_id)) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "That job is no longer listed")
    pdf, pages = await compiled(account, source)
    raw_text, parsed = await asyncio.to_thread(read_back, pdf)
    resume = Resume(
        applicant_id=applicant_id,
        original_filename=_filename(body.name),
        status=ResumeStatus.parsed if parsed else ResumeStatus.parse_failed,
        raw_text=raw_text,
        parsed_json=parsed.model_dump(mode="json") if parsed else None,
        template_key=LATEX,
        latex_source=source,
        target_job_id=body.target_job_id,
    )
    db.add(resume)
    try:
        await db.commit()
    except Exception:
        await db.rollback()
        raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, "Failed to save the resume")
    await db.refresh(resume)
    return GeneratedResume(id=resume.id, original_filename=resume.original_filename, pages=pages)


@router.get("/applicants/{applicant_id}/resumes/{resume_id}/latex")
async def get_latex(
    applicant_id: uuid.UUID,
    resume_id: uuid.UUID,
    account: AuthenticatedAccount = Depends(get_current_account),
    db: AsyncSession = Depends(get_session),
) -> LatexDoc:
    assert_applicant_owns(account, applicant_id)
    resume = await _owned_latex(db, applicant_id, resume_id)
    return _doc(resume.latex_source or "")


@router.put("/applicants/{applicant_id}/resumes/{resume_id}/latex")
async def save_latex(
    applicant_id: uuid.UUID,
    resume_id: uuid.UUID,
    body: LatexSource,
    account: AuthenticatedAccount = Depends(get_current_account),
    db: AsyncSession = Depends(get_session),
) -> LatexSaved:
    """Saves the source with `ops` applied, once it compiles, and reads its
    details back into parsed_json."""
    assert_applicant_owns(account, applicant_id)
    resume = await _owned_latex(db, applicant_id, resume_id)
    source = _applied(body)
    pdf, pages = await compiled(account, source)
    raw_text, parsed = await asyncio.to_thread(read_back, pdf)
    resume.latex_source = source
    resume.raw_text = raw_text
    resume.parsed_json = parsed.model_dump(mode="json") if parsed else None
    resume.status = ResumeStatus.parsed if parsed else ResumeStatus.parse_failed
    try:
        await db.commit()
    except Exception:
        await db.rollback()
        raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, "Failed to save the resume")
    return LatexSaved(**_doc(source).model_dump(), pages=pages)


@router.post("/applicants/{applicant_id}/resumes/{resume_id}/latex/tailor")
async def tailor_latex(
    applicant_id: uuid.UUID,
    resume_id: uuid.UUID,
    body: LatexTailorRequest,
    account: AuthenticatedAccount = Depends(get_current_account),
    db: AsyncSession = Depends(get_session),
    llm: LLM = Depends(get_llm),
) -> LatexTailorResponse:
    """Rewordings of the bullets the posting talks about most, by field id,
    to accept or reject. Saves nothing: the editor sends the accepted ones as
    edit ops to POST .../latex with `target_job_id`. Only those bullets'
    words reach the model, without their **bold** marks, which are put back
    wherever the marked words survive."""
    assert_applicant_owns(account, applicant_id)
    resume = await _owned_latex(db, applicant_id, resume_id)
    job = await fetch_listing(db, str(body.job_id))
    if job is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "That job is no longer listed")
    source = resume.latex_source or ""
    bullets = [f for f in fields(source) if f.kind == "bullet" and f.editable]
    if not bullets:
        return LatexTailorResponse(source=source, suggestions=[], notice="This resume has no bullets WorkIt can reword.")
    scores = await rank_against_job(db, body.job_id, [unmarked(f.text) for f in bullets])
    ranked = sorted((pair for pair in zip(bullets, scores, strict=True) if pair[1] > 0), key=lambda p: -p[1])
    targets = [f for f, _ in ranked[:MAX_REWRITES]]
    if not targets:
        return LatexTailorResponse(
            source=source, suggestions=[],
            notice="Nothing on this resume matches the posting's wording closely enough to reword.")
    take_builder_call(account)
    try:
        rewrites = await tailor_bullets(llm, [unmarked(f.text) for f in targets], job_facts(job.model_dump()))
    except ScoutUnavailable as exc:
        return LatexTailorResponse(source=source, suggestions=[], notice=str(exc))
    return LatexTailorResponse(source=source, suggestions=[
        LatexSuggestion(field_id=f.id, original=f.text, suggested=remarked(f.text, new))
        for f, new in zip(targets, rewrites, strict=True)
        if new
    ])
