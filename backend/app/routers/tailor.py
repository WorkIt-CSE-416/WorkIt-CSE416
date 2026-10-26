"""Tailor under /applicants/{applicant_id}/tailor (KAN-217;
`docs/tailor_resume.md`). Both routes check the token's account owns
`applicant_id` first. The rules live in `app/services/tailor.py`; the truth
rule in `app/services/truth_rule.py`.

Both bodies name the source the student picked: exactly one of
`built_resume_id` (its choices) or `uploaded_resume_id` (the entries and
skills it owns, everything else hidden; built in memory, never saved; an
upload that owns nothing is read into the bank first). 422 for neither or
both.

POST /applicants/{id}/tailor/match  TailorMatchRequest {job_posting_id, source} -> TailorMatch
     The source's keyword match, for the student to pick the missing
     keywords to add, and the posting's tailored resume if it has one. It
     extracts the posting's keywords once (cached on the posting) and saves
     what reading an upload that owned nothing wrote. Free while KAN-319
     lifts the limit. 404 a posting the Jobs page does not list or a source
     not the applicant's; 409 an upload read as nothing; 503 when the model
     cannot extract the keywords.
POST /applicants/{id}/tailor        TailorRun {job_posting_id, source, skills} -> TailorRunResult
     One run, saved as the posting's one tailored resume with no
     confirmation: rewordings (as bullet variants for the posting), each
     entry's bullets by rank, and the picked missing keywords as skills of
     that resume only, placed by the model's answer. Answers with what it
     changed (`edits`), which the editor marks and can revert until Save.
     A posting that already has a tailored resume answers 409
     {detail: {message, tailored_resume_id}} before any model call: the
     student edits it instead. It tailors only what the source shows.
     Free while KAN-319 lifts the limit: no Tailor use is checked or
     counted, and uses_left is always the cap. 404 as above; 409 an empty
     bank (send the student to intake) or an upload read as nothing; 503
     when the model fails or answers out of schema (nothing saved).
POST /applicants/{id}/tailor/stream TailorRun -> NDJSON
     The same run, streamed so the Tailor screen can name its phase. Every
     check before the model call answers as above, as an HTTP status. Then
     one JSON object per line: {"type": "phase", "phase": "asking"} as the
     prompt goes to the model, {"type": "phase", "phase": "generating"}
     once its answer is back, then {"type": "done", "result":
     TailorRunResult} or {"type": "error", "status", "message"} with the
     JSON route's status and message for a failure after the first line.
"""

import logging
import re
import uuid
from collections.abc import AsyncIterator

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession
from workit_scout.llm import LLM, ScoutUnavailable

from app.config import get_settings
from app.db import get_session, get_sessionmaker
from app.deps import assert_applicant_owns, get_current_account
from app.models.built_resume import Built_Resume
from app.models.jobs import Job_Post
from app.schemas.auth import AuthenticatedAccount
from app.schemas.built_resume import BuiltResumeResponse
from app.schemas.tailor import (
    TailorDone,
    TailorFailed,
    TailorMatch,
    TailorMatchRequest,
    TailorPhase,
    TailorReading,
    TailorRun,
    TailorRunResult,
    TailorSource,
)
from app.services import built_resumes, keywords, postings, tailor
from app.services.ai_messages import AIMessages
from app.services.bank import NotFound, load_bank
from app.services.identity import load_identity
from app.services.models import get_large_llm, get_small_llm
from app.services.resume_view import Choices, build_view

# KAN-319: the Tailor limit is lifted for now; restore with the lines in run().
# from app.services.usage import Feature, count_use, uses_left

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/applicants/{applicant_id}/tailor", tags=["tailor"])

EMPTY_BANK = "Your experience bank is empty. Add what you did first, then Tailor."
ALREADY_TAILORED = "This posting already has a tailored resume. Open it in the editor to change it."
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


def _own(body: TailorSource) -> list[uuid.UUID]:
    """The built source whose resume-local skills the run reads, if any."""
    return [body.built_resume_id] if body.built_resume_id else []


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


@router.post("/match", response_model=TailorMatch)
async def match(
    body: TailorMatchRequest,
    applicant_id: uuid.UUID,
    account: AuthenticatedAccount = Depends(get_current_account),
    keywords_llm: LLM = Depends(get_small_llm),
    session: AsyncSession = Depends(get_session),
) -> TailorMatch:
    assert_applicant_owns(account, applicant_id)
    job = await _posting(session, body.job_posting_id)
    # Before the bank loads: an uploaded source that owns nothing is read into it.
    choices, _ = await _source(session, applicant_id, body)
    bank = await load_bank(session, applicant_id, local_to=_own(body))
    try:
        found, _ = await keywords.ensure(job, keywords_llm)
    except ScoutUnavailable as exc:
        raise HTTPException(503, AI.failure(exc)) from exc
    matched, missing = keywords.match(build_view(bank, choices), found)
    tailored = await built_resumes.tailored_for(session, applicant_id, job.id)
    # One commit: the keyword cache and what reading an uploaded source wrote.
    await session.commit()
    return TailorMatch(
        job_posting_id=job.id,
        tailored_resume_id=tailored.id if tailored else None,
        weak_match=tailor.weak_match(job),
        matched=matched,
        missing=missing,
    )


@router.post("", response_model=TailorRunResult)
async def run(
    body: TailorRun,
    applicant_id: uuid.UUID,
    account: AuthenticatedAccount = Depends(get_current_account),
    llm: LLM = Depends(get_large_llm),
    keywords_llm: LLM = Depends(get_small_llm),
    session: AsyncSession = Depends(get_session),
) -> TailorRunResult:
    assert_applicant_owns(account, applicant_id)
    async for step in _steps(session, applicant_id, account, llm, keywords_llm, body):
        if isinstance(step, TailorRunResult):
            return step
    raise AssertionError("a run always ends with its result")


@router.post("/stream")
async def run_streamed(
    body: TailorRun,
    applicant_id: uuid.UUID,
    account: AuthenticatedAccount = Depends(get_current_account),
    llm: LLM = Depends(get_large_llm),
    keywords_llm: LLM = Depends(get_small_llm),
) -> StreamingResponse:
    assert_applicant_owns(account, applicant_id)
    # Its own session: the request's may be closed once streaming starts.
    session = get_sessionmaker()()
    steps = _steps(session, applicant_id, account, llm, keywords_llm, body)
    try:
        # Every check before the model call runs here, so a refusal (404,
        # 409, a keyword extraction's 503) is still an HTTP status.
        first = await anext(steps)
    except BaseException:
        await session.close()
        raise
    return StreamingResponse(_ndjson(_streamed(first, steps, session)), media_type="application/x-ndjson")


async def _streamed(
    first: TailorPhase, steps: AsyncIterator[TailorPhase | TailorRunResult], session: AsyncSession
) -> AsyncIterator[TailorPhase | TailorDone | TailorFailed]:
    """The run's lines after its checks passed: each phase, then `done` with
    the result, or `error` with what the JSON route would have answered."""
    try:
        yield first
        try:
            async for step in steps:
                yield TailorDone(result=step) if isinstance(step, TailorRunResult) else step
        except HTTPException as exc:
            detail = exc.detail
            message = detail if isinstance(detail, str) else detail.get("message", "Tailor failed.")
            yield TailorFailed(status=exc.status_code, message=message)
    finally:
        # A reader who leaves mid-run stops the run before its session goes.
        await steps.aclose()
        await session.close()


async def _ndjson(events: AsyncIterator[TailorPhase | TailorDone | TailorFailed]) -> AsyncIterator[bytes]:
    async for event in events:
        yield event.model_dump_json().encode() + b"\n"


async def _steps(
    session: AsyncSession, applicant_id: uuid.UUID, account: AuthenticatedAccount,
    llm: LLM, keywords_llm: LLM, body: TailorRun,
) -> AsyncIterator[TailorPhase | TailorRunResult]:
    """One run: a phase line before and after the model call, then the
    result. `llm` (large) writes the proposals; `keywords_llm` (small) reads
    the posting's keywords, as every extraction does. Raises HTTPException as the JSON route answers; the stream turns
    one raised after its first line into an `error` line."""
    # KAN-319: the Tailor limit is lifted for now. Check before anything else
    # left = await uses_left(session, applicant_id, Feature.TAILOR)
    # if left <= 0:
    #     raise HTTPException(429, AI.spent)
    left = get_settings().ai_tailor_cap

    job = await _posting(session, body.job_posting_id)
    # One tailored resume per posting, made once: refused before any model
    # call, so a second run spends no tokens.
    if (existing := await built_resumes.tailored_for(session, applicant_id, job.id)) is not None:
        raise HTTPException(409, {"message": ALREADY_TAILORED, "tailored_resume_id": str(existing.id)})
    # Before the bank loads: an uploaded source that owns nothing is read into it.
    source, template = await _source(session, applicant_id, body)
    bank = await load_bank(session, applicant_id, local_to=_own(body))
    if not bank.entries:
        raise HTTPException(409, EMPTY_BANK)
    try:
        found, extracted = await keywords.ensure(job, keywords_llm)
    except ScoutUnavailable as exc:
        raise HTTPException(503, AI.failure(exc)) from exc
    if extracted:
        # The cache is the posting's, not this run's: keep it even if the
        # run fails below. The run's one use counts the extraction too.
        await session.commit()

    # The picked resume as it shows, read once: the rank, the prompt, the
    # proposals and the match all read it, so they agree on what it holds.
    view = build_view(bank, source)
    # scores each bullet the resume shows, used to order each entry's bullets
    ranks = await tailor.rank_bullets(session, view, tailor.posting_text(job, found))
    matched, missing = keywords.match(view, found)
    # Only missing keywords can be picked: any other name is ignored.
    asked = {name.casefold() for name in body.skills}
    picked = [k.keyword for k in missing if k.keyword.casefold() in asked]

    identity = await load_identity(session, account)
    yield TailorPhase(phase="asking")
    try:
        reading = await llm.complete_json(
            tailor.prompt(job, found, view, ranks, picked), TailorReading,
            identity=identity, max_tokens=tailor.REPLY_TOKENS)
    except ScoutUnavailable as exc:
        raise HTTPException(503, AI.failure(exc)) from exc
    yield TailorPhase(phase="generating")
    # What the truth rule takes as said: the resume's skills, the picks and
    # the keywords the resume already shows. Propose and the save read one list.
    known = tailor.known(view, picked, matched)
    changes, dropped = tailor.propose(bank, view, reading, ranks, found, known)

    # Saved with no confirmation: the editor marks each change and reverts it.
    resume = Built_Resume(
        id=uuid.uuid4(), applicant_id=applicant_id, name=_name(account.full_name, job), template=template, job_posting_id=job.id)
    session.add(resume)
    await session.flush()
    try:
        variants = await tailor.save_variants(session, bank, job.id, changes, known, found)
    except tailor.BreaksTruthRule as exc:
        # propose() already dropped these; this is the save's own guard.
        await session.rollback()
        raise HTTPException(422, str(exc))
    choices = tailor.with_changes(bank, source, changes, variants)
    placed = tailor.place_skills(view, picked, reading.placements)
    choices, new = await tailor.place_on(session, applicant_id, resume.id, choices, placed)
    await built_resumes.write_choices(session, resume.id, choices)
    # KAN-319: the Tailor limit is lifted for now.
    # await count_use(session, applicant_id, Feature.TAILOR)
    try:
        await session.commit()
    except IntegrityError:
        # Another run for this posting saved first (one per posting).
        await session.rollback()
        raise HTTPException(409, ALREADY_TAILORED)
    except SQLAlchemyError:
        await session.rollback()
        logger.exception("Failed to save the tailored resume")
        raise HTTPException(500, "Failed to save the tailored resume")

    await session.refresh(resume)
    tailored = await load_bank(session, applicant_id, local_to=[resume.id])
    after_matched, after_missing = keywords.match(build_view(tailored, choices), found)
    default_id = await built_resumes.default_built_id(session, applicant_id)
    yield TailorRunResult(
        resume=BuiltResumeResponse(
            id=resume.id, name=resume.name, template=resume.template, job_posting_id=resume.job_posting_id,
            is_default=resume.id == default_id, created_at=resume.created_at,
            edited_at=resume.updated_at, posting_title=job.title, posting_company=job.company_name,
        ),
        weak_match=tailor.weak_match(job),
        matched=matched,
        missing=missing,
        after_matched=after_matched,
        after_missing=after_missing,
        edits=tailor.edits(view, source, changes, variants, placed, new),
        dropped=dropped,
        uses_left=left,  # KAN-319: was left - 1
    )


# A bracketed part of a title, with the space before it: "(Seattle, WA)",
# "[Remote]", "{2027}". Basic on purpose: a nested or unclosed bracket stays.
_BRACKETED = re.compile(r"\s*(\([^()]*\)|\[[^\[\]]*\]|\{[^{}]*\})")
# The name's cap: what Rename accepts (`schemas/built_resume.py`'s `Name`).
_NAME_LIMIT = 80


def _name(student: str, job: Job_Post) -> str:
    """The tailored resume's default name, "{student} {company} {title}
    Resume", the title without its bracketed parts. Over the cap, the title
    is cut, so the name still ends in "Resume"."""
    title = " ".join(_BRACKETED.sub("", job.title).split()) or job.title.strip()
    lead = " ".join(part for part in (student.strip(), (job.company_name or "").strip()) if part)
    room = _NAME_LIMIT - len(" Resume") - (len(lead) + 1 if lead else 0)
    return " ".join(part for part in (lead, title[: max(room, 0)].rstrip(), "Resume") if part)
