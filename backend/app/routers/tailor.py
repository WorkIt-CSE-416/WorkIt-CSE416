"""Tailor under /applicants/{applicant_id}/tailor (KAN-217). Both routes
check the token's account owns `applicant_id` first. The rules live in
`app/services/tailor.py`; the truth rule in `app/services/truth_rule.py`.

Both bodies name the source the student picked in Tailor's dialog: exactly
one of `built_resume_id` (its choices) or `uploaded_resume_id` (its stored
text read and merged into the bank again, then shown as the entries and
skills it holds, everything else hidden; built in memory, never saved).
422 for neither or both.

POST /applicants/{id}/tailor       TailorRun {job_posting_id, source} -> TailorProposal
     One Tailor run: proposed changes from the picked source, which the
     proposal names again for Done. It tailors only the entries and
     bullets the source shows; it never proposes one it hides. Saves nothing but what reading an
     uploaded source merged into the bank (nothing until Done).
     Free while KAN-319 lifts the limit: no Tailor use is checked or
     counted, and uses_left is always the cap. Restoring the commented
     lines brings back one use per successful run (a keyword extraction
     inside the run is part of it, not a second use) and the 429.
     404 a posting the Jobs page does not list (unknown, draft, paused,
     closed) or a source not the applicant's; 409 {detail} an upload the
     parser reads nothing from, or an empty bank (send the student to
     intake);
     503 when the model fails or answers out of
     schema (nothing counted).
POST /applicants/{id}/tailor/done  TailorDone {job_posting_id, source, changes} -> TailorResult {resume, matched, missing}
     Saves the accepted changes, applied to the source, on the posting's
     one tailored resume (made on the first Done, updated after; a
     different source than last time replaces what it showed), approved
     wordings as bullet variants for the posting. Free: no model call. 404
     a posting the Jobs page does not list, a source or a bank id not the
     applicant's; 409 an upload read as nothing; 422 {detail} a wording
     that breaks the truth rule (nothing saved).
"""

import logging
import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession
from workit_scout.llm import LLM, ScoutUnavailable

from app.config import get_settings
from app.db import get_session
from app.deps import assert_applicant_owns, get_current_account
from app.models.built_resume import Built_Resume
from app.models.jobs import Job_Post
from app.routers.scout import get_llm
from app.schemas.auth import AuthenticatedAccount
from app.schemas.built_resume import BuiltResumeResponse
from app.schemas.tailor import (
    TailorDone,
    TailorProposal,
    TailorReading,
    TailorResult,
    TailorRun,
    TailorSource,
)
from app.services import built_resumes, keywords, postings, tailor
from app.services.ai_messages import AIMessages
from app.services.bank import NotFound, load_bank
from app.services.identity import load_identity
from app.services.resume_view import Choices

# KAN-319: the Tailor limit is lifted for now; restore with the lines in run().
# from app.services.usage import Feature, count_use, uses_left

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/applicants/{applicant_id}/tailor", tags=["tailor"])

EMPTY_BANK = "Your experience bank is empty. Add what you did first, then Tailor."
NOTHING_READ = (
    "WorkIt couldn't read anything from this resume. Pick another, or use Read It With AI on Resumes first."
)
AI = AIMessages(
    spent="You've used today's Tailor runs. They reset at midnight UTC.",
    offline="Tailor can't reach WorkIt's AI right now. Try again in a minute.",
    lost="Tailor couldn't make sense of the AI's answer. Try again.",
)


async def _posting(session: AsyncSession, posting_id: uuid.UUID) -> Job_Post:
    job = await postings.listed(session, posting_id, keywords=True)
    if job is None:
        raise HTTPException(404, "Job posting not found")
    return job


async def _source(session: AsyncSession, applicant_id: uuid.UUID, body: TailorSource) -> tuple[Choices, str]:
    """The picked resume's choices and the template a new tailored resume
    takes: a built resume's own, else the default (an upload has none)."""
    try:
        if body.built_resume_id is not None:
            resume = await built_resumes.get_resume(session, applicant_id, body.built_resume_id)
            return await built_resumes.load_choices(session, resume.id), resume.template
        assert body.uploaded_resume_id is not None  # TailorSource checks one is given
        choices = await tailor.upload_source(session, applicant_id, body.uploaded_resume_id)
        return choices, built_resumes.DEFAULT_TEMPLATE
    except NotFound:
        raise HTTPException(404, "Resume not found")
    except tailor.NothingRead:
        raise HTTPException(409, NOTHING_READ)


@router.post("", response_model=TailorProposal)
async def run(
    body: TailorRun,
    applicant_id: uuid.UUID,
    account: AuthenticatedAccount = Depends(get_current_account),
    llm: LLM = Depends(get_llm),
    session: AsyncSession = Depends(get_session),
) -> TailorProposal:
    assert_applicant_owns(account, applicant_id)
    # KAN-319: the Tailor limit is lifted for now. Check before anything else 
    # left = await uses_left(session, applicant_id, Feature.TAILOR)
    # if left <= 0:
    #     raise HTTPException(429, AI.spent)
    left = get_settings().ai_tailor_cap

    job = await _posting(session, body.job_posting_id)
    # Before the bank loads: an uploaded source merges into it.
    choices, _ = await _source(session, applicant_id, body)
    bank = await load_bank(session, applicant_id)
    if not bank.entries:
        raise HTTPException(409, EMPTY_BANK)
    try:
        found, extracted = await keywords.ensure(job, llm)
    except ScoutUnavailable as exc:
        raise HTTPException(503, AI.failure(exc)) from exc
    if extracted:
        # The cache is the posting's, not this run's: keep it even if the
        # run fails below. The run's one use counts the extraction too.
        await session.commit()

    tailored = await built_resumes.tailored_for(session, applicant_id, job.id)
    # Only what the picked resume shows: a run never adds an entry it hides.
    resume = tailor.on_resume(bank, choices)
    ranks = await tailor.rank_bullets(session, resume, tailor.posting_text(job, found))

    identity = await load_identity(session, account)
    try:
        reading = await llm.complete_json(
            tailor.prompt(job, found, resume, choices, ranks), TailorReading, identity=identity)
    except ScoutUnavailable as exc:
        raise HTTPException(503, AI.failure(exc)) from exc
    changes, dropped = tailor.propose(resume, choices, reading, ranks, found)
    matched, missing = tailor.match(resume, choices, found)
    tailored_id = tailored.id if tailored else None
    # KAN-319: the Tailor limit is lifted for now.
    # await count_use(session, applicant_id, Feature.TAILOR)
    # One commit: the count and what an uploaded source merged into the bank.
    await session.commit()
    return TailorProposal(
        job_posting_id=job.id,
        built_resume_id=body.built_resume_id,
        uploaded_resume_id=body.uploaded_resume_id,
        tailored_resume_id=tailored_id,
        weak_match=tailor.weak_match(job),
        matched=matched,
        missing=missing,
        questions=tailor.questions(resume, found, missing),
        changes=changes,
        dropped=dropped,
        uses_left=left,  # KAN-319: was left - 1
    )


def _name(job: Job_Post) -> str:
    return f"{job.company_name} – {job.title}"[:80] if job.company_name else job.title[:80]


@router.post("/done", response_model=TailorResult)
async def done(
    body: TailorDone,
    applicant_id: uuid.UUID,
    account: AuthenticatedAccount = Depends(get_current_account),
    session: AsyncSession = Depends(get_session),
) -> TailorResult:
    assert_applicant_owns(account, applicant_id)
    job = await _posting(session, body.job_posting_id)
    found = keywords.cached(job) or []
    source, template = await _source(session, applicant_id, body)
    try:
        bank = await load_bank(session, applicant_id)
        tailor.validate(bank, body.changes)
    except NotFound:
        raise HTTPException(404, "Not found in your experience bank")
    try:
        variants = await tailor.save_variants(session, bank, job.id, body.changes, found)
    except tailor.BreaksTruthRule as exc:
        await session.rollback()
        raise HTTPException(422, str(exc))
    choices = tailor.with_changes(bank, source, body.changes, variants)

    resume = await built_resumes.tailored_for(session, applicant_id, job.id)
    if resume is None:
        resume = Built_Resume(
            id=uuid.uuid4(), applicant_id=applicant_id, name=_name(job), template=template,
            job_posting_id=job.id)
        session.add(resume)
        await session.flush()
    await built_resumes.write_choices(session, resume.id, choices)
    try:
        await session.commit()
    except SQLAlchemyError:
        await session.rollback()
        logger.exception("Failed to save the tailored resume")
        raise HTTPException(500, "Failed to save the tailored resume")
    await session.refresh(resume)
    default_id = await built_resumes.default_built_id(session, applicant_id)
    matched, missing = tailor.match(bank, choices, found)
    return TailorResult(
        resume=BuiltResumeResponse(
            id=resume.id, name=resume.name, template=resume.template, job_posting_id=resume.job_posting_id,
            is_default=resume.id == default_id, created_at=resume.created_at,
            edited_at=resume.updated_at, posting_title=job.title, posting_company=job.company_name,
        ),
        matched=matched,
        missing=missing,
    )
