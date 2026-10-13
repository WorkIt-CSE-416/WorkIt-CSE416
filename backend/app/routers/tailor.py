"""Tailor under /applicants/{applicant_id}/tailor (KAN-217). Both routes
check the token's account owns `applicant_id` first. The rules live in
`app/services/tailor.py`; the truth rule in `app/services/truth_rule.py`.

POST /applicants/{id}/tailor       TailorRun {job_posting_id} -> TailorProposal
     One Tailor run: proposed changes for the posting's tailored resume,
     starting from it when it exists, else the newest base resume, else a
     base resume generated first. Saves nothing else (nothing until Done).
     Spends one Tailor use, counted only when the run succeeds; a keyword
     extraction inside the run is part of it, not a second use.
     404 a posting the Jobs page does not list (unknown, draft, paused,
     closed); 409 {detail} empty bank (send the student to
     intake) or, when a base resume must be generated, the 5-resume limit;
     429 at the Tailor limit; 503 when the model fails or answers out of
     schema (nothing counted).
POST /applicants/{id}/tailor/done  TailorDone -> TailorResult {resume, matched, missing}
     Saves the accepted changes on the posting's one tailored resume
     (made on the first Done, updated after), approved wordings as bullet
     variants for the posting. Free: no model call. 404 a posting the Jobs page does not list,
     resume or a bank id not the applicant's; 422 {detail} a wording that
     breaks the truth rule (nothing saved).
"""

import logging
import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession
from workit_scout.llm import LLM, OUT_OF_QUOTA, InvalidReply, ScoutUnavailable

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
)
from app.services import built_resumes, keywords, postings, tailor
from app.services.bank import NotFound, load_bank
from app.services.identity import load_identity
from app.services.usage import Feature, count_use, uses_left

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/applicants/{applicant_id}/tailor", tags=["tailor"])

EMPTY_BANK = "Your experience bank is empty. Add what you did first, then Tailor."
AI_SPENT = "You've used today's Tailor runs. They reset at midnight UTC."
AI_BUSY = "WorkIt has hit today's AI limit. Try again tomorrow."
AI_OFFLINE = "Tailor can't reach WorkIt's AI right now. Try again in a minute."
AI_LOST = "Tailor couldn't make sense of the AI's answer. Try again."


def _ai_message(exc: ScoutUnavailable) -> str:
    if isinstance(exc, InvalidReply):
        return AI_LOST
    return AI_BUSY if str(exc) == OUT_OF_QUOTA else AI_OFFLINE


async def _posting(session: AsyncSession, posting_id: uuid.UUID) -> Job_Post:
    job = await postings.listed(session, posting_id, keywords=True)
    if job is None:
        raise HTTPException(404, "Job posting not found")
    return job


@router.post("", response_model=TailorProposal)
async def run(
    body: TailorRun,
    applicant_id: uuid.UUID,
    account: AuthenticatedAccount = Depends(get_current_account),
    llm: LLM = Depends(get_llm),
    session: AsyncSession = Depends(get_session),
) -> TailorProposal:
    assert_applicant_owns(account, applicant_id)
    job = await _posting(session, body.job_posting_id)
    bank = await load_bank(session, applicant_id)
    if not bank.entries:
        raise HTTPException(409, EMPTY_BANK)
    left = await uses_left(session, applicant_id, Feature.TAILOR)
    if left <= 0:
        raise HTTPException(429, AI_SPENT)

    found = keywords.cached(job)
    if found is None:
        try:
            found = await keywords.extract(job, llm)
        except ScoutUnavailable as exc:
            raise HTTPException(503, _ai_message(exc)) from exc
        # The cache is the posting's, not this run's: keep it even if the
        # run fails below.
        keywords.store(job, found)
        await session.commit()

    tailored = await built_resumes.tailored_for(session, applicant_id, job.id)
    source = tailored or await built_resumes.latest_base(session, applicant_id)
    if source is None:
        try:
            source = await built_resumes.generate(session, applicant_id, "Base Resume")
        except built_resumes.ResumeLimitReached as exc:
            raise HTTPException(409, str(exc))
    choices = await built_resumes.load_choices(session, source.id)
    ranks = await tailor.rank_bullets(session, applicant_id, tailor.posting_text(job, found))

    identity = await load_identity(session, account)
    try:
        reading = await llm.complete_json(
            tailor.prompt(job, found, bank, choices, ranks), TailorReading, identity=identity)
    except ScoutUnavailable as exc:
        raise HTTPException(503, _ai_message(exc)) from exc
    changes, dropped = tailor.propose(bank, choices, reading, ranks, found)
    matched, missing = tailor.match(bank, choices, found)
    source_id = source.id
    # count_use commits, saving a base resume generated for this run with it.
    await count_use(session, applicant_id, Feature.TAILOR)
    return TailorProposal(
        job_posting_id=job.id,
        source_resume_id=source_id,
        tailored_resume_id=tailored.id if tailored else None,
        weak_match=tailor.weak_match(job),
        matched=matched,
        missing=missing,
        questions=tailor.questions(bank, found, missing),
        changes=changes,
        dropped=dropped,
        uses_left=left - 1,
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
    try:
        source = await built_resumes.get_resume(session, applicant_id, body.source_resume_id)
        bank = await load_bank(session, applicant_id)
        tailor.validate(bank, body.changes)
    except NotFound:
        raise HTTPException(404, "Not found in your experience bank")
    try:
        variants = await tailor.save_variants(session, bank, job.id, body.changes, found)
    except tailor.BreaksTruthRule as exc:
        await session.rollback()
        raise HTTPException(422, str(exc))
    choices = tailor.with_changes(bank, await built_resumes.load_choices(session, source.id), body.changes, variants)

    resume = await built_resumes.tailored_for(session, applicant_id, job.id)
    if resume is None:
        resume = Built_Resume(
            id=uuid.uuid4(), applicant_id=applicant_id, name=_name(job), template=source.template,
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
        ),
        matched=matched,
        missing=missing,
    )
