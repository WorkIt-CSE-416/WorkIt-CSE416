"""
Resumes WorkIt builds (KAN-176): save a generated or tailored one, draw any
resume with a template as a PDF or Word file, and tailor a resume to a job
posting.

A built resume is an ordinary `resumes` row, so the profile's list, primary
star, edit and delete all work on it: its `parsed_json` is the frozen copy,
`template_key` says how it is drawn, and a tailored one names its job
(`target_job_id`). It has no stored file (`storage_path` NULL). Its PDF is
drawn from `parsed_json` on every request (GET .../download), so an edit on
the profile shows in the next preview and nothing in Storage can go stale.
The name and contact line come from the applicant's profile at render time
and never reach a model.
"""

import asyncio
import re
import uuid
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Response, status
from pydantic import ValidationError
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from workit_scout.builder import tailor_bullets
from workit_scout.facts import job_facts
from workit_scout.llm import LLM, ScoutUnavailable

from app.db import get_session
from app.deps import assert_applicant_owns, get_current_account
from app.models.dto import ParsedResume, ResumeStatus
from app.models.profiles import Applicant_Profile
from app.models.resume import Resume
from app.routers.experience import load_bank, take_builder_call
from app.routers.jobs import fetch_listing
from app.routers.resumes import MAX_RESUMES, get_owned_resume, reject_oversized
from app.routers.scout import get_llm
from app.schemas.auth import AuthenticatedAccount
from app.schemas.experience import (
    GeneratedResume,
    GenerateRequest,
    Suggestion,
    TailorRequest,
    TailorResponse,
)
from app.services import tailoring
from app.services.experience import bank_to_resume
from app.services.matching.overlap import rank_against_job
from app.services.resume_render import MIME, TEMPLATES, render

router = APIRouter()


def _shown(url: str) -> str:
    """A link as a resume prints it: "github.com/jake", not the full URL."""
    return re.sub(r"^https?://(www\.)?", "", url).rstrip("/")


async def _header(db: AsyncSession, applicant_id: uuid.UUID) -> tuple[str, list[tuple[str, str | None]]]:
    profile = await db.get(Applicant_Profile, applicant_id)
    if profile is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Applicant not found")
    contacts: list[tuple[str, str | None]] = []
    if profile.phone_number:
        contacts.append((profile.phone_number, None))
    contacts.append((profile.email, f"mailto:{profile.email}"))
    for url in (profile.linkedin_url, profile.github_url, profile.portfolio_url, profile.other_url):
        if url:
            contacts.append((_shown(url), url if url.startswith("http") else f"https://{url}"))
    return profile.full_name, contacts


def _filename(name: str, ext: str) -> str:
    stem = re.sub(r"[^\w\- ]+", "", name).strip() or "Resume"
    return f"{stem}{ext}"


@router.post("/applicants/{applicant_id}/resumes/generated", status_code=status.HTTP_201_CREATED)
async def save_generated(
    applicant_id: uuid.UUID,
    body: GenerateRequest,
    account: AuthenticatedAccount = Depends(get_current_account),
    db: AsyncSession = Depends(get_session),
) -> GeneratedResume:
    """Saves a Generated Resume, or a Tailored one when `target_job_id` is
    set. Rendered once here for `pages`, so the builder can warn when it runs
    past one, and to fail now rather than at the first download."""
    assert_applicant_owns(account, applicant_id)
    reject_oversized(body.resume)
    if body.template_key not in TEMPLATES:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "No such template")
    held = await db.scalar(select(func.count()).select_from(Resume).where(Resume.applicant_id == applicant_id))
    if held >= MAX_RESUMES:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"You already have {MAX_RESUMES} resumes. Delete one in My Profile to save another.",
        )
    if body.target_job_id and await fetch_listing(db, str(body.target_job_id)) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "That job is no longer listed")

    name, contacts = await _header(db, applicant_id)
    rendered = await asyncio.to_thread(
        render, body.resume, name=name, contacts=contacts, template=body.template_key, fmt="pdf")
    resume = Resume(
        applicant_id=applicant_id,
        original_filename=_filename(body.name, ".pdf"),
        status=ResumeStatus.parsed,
        parsed_json=body.resume.model_dump(mode="json"),
        template_key=body.template_key,
        target_job_id=body.target_job_id,
    )
    db.add(resume)
    try:
        await db.commit()
    except Exception:
        await db.rollback()
        raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, "Failed to save the resume")
    await db.refresh(resume)
    return GeneratedResume(id=resume.id, original_filename=resume.original_filename, pages=rendered.pages or 1)


@router.get("/applicants/{applicant_id}/resumes/{resume_id}/download")
async def download(
    applicant_id: uuid.UUID,
    resume_id: uuid.UUID,
    format: Literal["pdf", "docx"] = "pdf",
    template: str | None = None,
    # Shown in the browser (a preview) rather than saved
    inline: bool = False,
    account: AuthenticatedAccount = Depends(get_current_account),
    db: AsyncSession = Depends(get_session),
) -> Response:
    """Any resume's details drawn with a template: a built resume's own
    template unless another is named, Jake's Resume for an upload. This is a
    built resume's only file; an upload's original is GET .../file."""
    assert_applicant_owns(account, applicant_id)
    resume = await get_owned_resume(db, applicant_id, resume_id)
    key = template or resume.template_key or "jakes"
    if key not in TEMPLATES:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "No such template")
    if not resume.parsed_json:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "That resume has no details to draw")
    try:
        parsed = ParsedResume.model_validate(resume.parsed_json)
    except ValidationError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "That resume's details can't be read") from exc

    name, contacts = await _header(db, applicant_id)
    rendered = await asyncio.to_thread(render, parsed, name=name, contacts=contacts, template=key, fmt=format)
    stem = (resume.original_filename or "Resume").rsplit(".", 1)[0]
    filename = _filename(stem, f".{format}")
    return Response(
        rendered.data,
        media_type=MIME[format],
        headers={"Content-Disposition": f'{"inline" if inline else "attachment"}; filename="{filename}"'},
    )


@router.post("/applicants/{applicant_id}/tailor")
async def tailor(
    applicant_id: uuid.UUID,
    body: TailorRequest,
    account: AuthenticatedAccount = Depends(get_current_account),
    db: AsyncSession = Depends(get_session),
    llm: LLM = Depends(get_llm),
) -> TailorResponse:
    """A resume reordered for one job posting, with rewordings to accept or
    reject. Starts from the given resume, or the whole bank. Saves nothing:
    the builder saves what the applicant accepts through .../resumes/generated."""
    assert_applicant_owns(account, applicant_id)
    job = await fetch_listing(db, str(body.job_id))
    if job is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "That job is no longer listed")

    if body.resume_id:
        stored = await get_owned_resume(db, applicant_id, body.resume_id)
        try:
            source = ParsedResume.model_validate(stored.parsed_json or {})
        except ValidationError as exc:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "That resume's details can't be read") from exc
    else:
        bank = await load_bank(db, applicant_id)
        source = bank_to_resume(bank.entries, bank.skills)

    resume = tailoring.normalized(source)
    texts = list(dict.fromkeys(line.text for line in tailoring.lines(resume)))
    skill_names = [s.skill_name for s in resume.skills]
    scores = await rank_against_job(db, body.job_id, texts + skill_names)
    score = dict(zip(texts, scores[: len(texts)], strict=True))
    resume = tailoring.reorder(resume, score, scores[len(texts):])

    targets = tailoring.to_reword(resume, score)
    if not targets:
        return TailorResponse(
            resume=resume, suggestions=[],
            notice="Nothing on this resume matches the posting's wording closely enough to reword.",
        )
    take_builder_call(account)
    try:
        rewrites = await tailor_bullets(llm, [t.text for t in targets], job_facts(job.model_dump()))
    except ScoutUnavailable as exc:
        return TailorResponse(resume=resume, suggestions=[], notice=f"{exc} The reordering below still applies.")
    suggestions = [
        Suggestion(section=t.section, item=t.item, bullet=t.bullet, original=t.text, suggested=new)
        for t, new in zip(targets, rewrites, strict=True)
        if new
    ]
    return TailorResponse(resume=resume, suggestions=suggestions)
