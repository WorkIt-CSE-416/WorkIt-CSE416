"""
Auto apply (KAN-223), layer 3: each route checks the caller owns the
applicant, calls one layer-2 step (app/auto_apply/pipeline.py) and returns
its result. The webapp, the extension and later an MCP server call these
(auto-apply/architecture.md, "API routes").

GET  /applicants/{id}/auto-apply/matches
     The best matches not yet queued or applied, best first, as ScoredJobs.
     Only job postings auto apply fills (every hiring system the Fill engine fills), as a batch.
     ?size= (default 10) and the Jobs page's own filters (?location=, ?visa=...).
     404 while the experience bank is empty.
POST /applicants/{id}/auto-apply/batches  {"size": 10}
     Start Auto Apply: queues that many matches, same filters. Answers
     {"queued": [job ids]}, best first; fewer when fewer are left. 404 while
     the experience bank is empty.
POST /applicants/{id}/applications  {"job_id": ...}
     A job's Auto Apply button: queues one job posting. Answers its stage;
     a job that already has an application keeps that stage. 404 for a job
     posting that isn't open or isn't on a hiring system auto apply fills
     (app/auto_apply/hosts.py: every hiring system the Fill engine fills),
     its detail saying why. A job board's posting (LinkedIn, Indeed) is
     taken only through the employer's form it names, its `form_url`.
GET  /applicants/{id}/applications?stage=queued&stage=needs_you
     The applications, newest first (every stage without ?stage=), each
     with its job posting's listing and `open` (false once it closed).
     ?scored=true adds `match`, the Jobs page's score, and its `highlights`
     to each open one
     (the Applications page; null while the experience bank is empty).
GET  /applicants/{id}/applications/next?skip=<job id>&skip=...
     What the extension fills next: the oldest queued application whose job
     posting is open, or null when none is left. ?skip= leaves out the jobs
     batch apply already has open in its tabs (KAN-370).
GET  /applicants/{id}/applications/{job_id}
     The application for one job posting, as the list has it. 404 when the
     applicant has none.
DELETE /applicants/{id}/applications/{job_id}
     Takes a queued job posting out of the queue (the Auto Apply button's
     second click, Live Activity's cross): 204, and the job has no
     application again. 404 with no application, 409 when it is past queued.
POST /applicants/{id}/applications/{job_id}/resume
     The resume to attach, before the fill: the one tailored to the job
     posting, else the default resume, kept as a sent resume linked to the
     job posting. Answers SentResumeDownload (`url`: a 5-minute download
     link), or null when there is no such resume. A repeat with unchanged
     content answers the same sent resume. 404 with no application or a
     closed job posting, 409 when it isn't queued or needs_you, 503 when the
     PDF cannot be made, 502 when Storage refuses the file.
PUT  /applicants/{id}/applications/{job_id}/resume  {"built_resume_id": ...}
     The student's own pick of the resume a queued application goes out
     with (the Auto Apply page's Up Next, KAN-359): exactly one of
     built_resume_id or uploaded_resume_id (422 otherwise). Kept as a sent
     resume linked to the job posting, which the application names, so the
     POST above sends that resume (again, from its current content) instead
     of its own pick. Answers SentResumeResponse. 404 with no application,
     or a resume or job posting that isn't available; 409 when it isn't
     queued or needs_you; 503 when a built resume's PDF cannot be made.
PUT  /applicants/{id}/applications/{job_id}/fill  {"state": "needs_you"}
     How a batch apply tab's fill left the form (KAN-370): needs_you while
     anything is unfilled, ready (the stage goes back to queued) once
     everything is. Answers the stage. 404 with no application, 409 when it
     isn't queued or needs_you.
PUT  /applicants/{id}/applications/{job_id}/questions  {"questions": [...]}
     The questions a batch apply tab's form needs written (KAN-377), each
     {"name", "label", "required", "max_length"} (at most 50), kept for the
     student's own Claude to answer through the connector (app/connector/).
     A question asked again keeps its saved answer. Answers every question
     the application has, as GET below. 404 with no application, 409 when
     it isn't queued or needs_you.
GET  /applicants/{id}/applications/{job_id}/questions
     Those questions in the form's order, each with `answer`: the one the
     student's Claude saved, or null. The open tab fills each new answer.
     404 with no application.
PUT  /applicants/{id}/applications/{job_id}/answers  {"name", "label", "answer", "own"}
     The student's words for one of the tab's questions that need writing
     (KAN-379). `own`: written into a field WorkIt didn't fill, or
     replacing what it filled; it replaces the application's answer (their
     Claude is not asked for it, and its later save never replaces it), and
     later forms reuse it first. Not own: an edit of an answer WorkIt filled,
     kept as that answer's and checked as their Claude's (422 with the
     reasons when it fails). Answers {"answer", "own"}. 404 with no
     application.
DELETE /applicants/{id}/applications/{job_id}/answers?name=
     Undo on the tab's guess card (KAN-369): takes back the student's own
     answer to `name` (one Looks right or Save for next time saved), so
     later forms no longer fill it. A question the tab sent stays,
     unanswered, for their Claude; their Claude's answer is never touched.
     204, also when nothing was saved; 404 with no application.
POST /applicants/{id}/applications/{job_id}/review/keep     {"name"}
POST /applicants/{id}/applications/{job_id}/review/rewrite  {"name"}
     The tab's flag card (KAN-369) on an answer the pre-submit review
     flagged: keep it as it stands (no later review flags that text again),
     or send it back to the student's Claude (the answer is cleared, and
     get_next_application hands the question out with the flag). 204; 422
     when that answer isn't flagged, or (rewrite) is the student's own.
GET  /applicants/{id}/applications/{job_id}/answer-bank
     The answers saved on the student's other applications that this one's
     form may reuse, {question wording: {"answer", "own"}} (pipeline.answer_bank:
     never one about another company): the Fill engine's Answer bank for
     the form, so a question answered once is filled again without the
     student's Claude. `own` marks the student's own words. 404 with no
     application.
GET  /applicants/{id}/answer-bank?company=...
     The same for a form filled outside a batch, which has no application:
     every saved answer it may reuse, an answer about one company only when
     `company` (the page's, when the extension read it) is that company.
POST /applicants/{id}/applications/{job_id}/finish  {"outcome": "submitted"}
     How a fill ended: submitted → applied, skipped → skipped, failed →
     needs_you. 404 with no application, 409 when it isn't queued or
     needs_you.

Applicant accounts only, and only their own id (assert_applicant_owns).
"""

import uuid
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.auto_apply import pipeline
from app.auto_apply.queries import ResumeChoice
from app.db import get_session, get_supabase
from app.deps import assert_applicant_owns, get_current_account
from app.models.dto import application_stage
from app.queries.jobs.filters import JobFilters
from app.routers.jobs import EmptyBank, read_filters
from app.schemas.applications import (
    Application,
    ApplicationStage,
    BatchQueued,
    BatchRequest,
    ChooseResume,
    FillRequest,
    FinishRequest,
    FlagAnswer,
    OwnAnswer,
    QueueRequest,
    SavedAnswer,
    WrittenAnswer,
    WrittenQuestions,
)
from app.schemas.auth import AuthenticatedAccount
from app.schemas.jobs import ScoredJob
from app.schemas.sent_resume import SentResumeDownload, SentResumeResponse
from app.services.resume_render import TectonicUnavailable

router = APIRouter(prefix="/applicants/{applicant_id}", tags=["auto-apply"])


@router.get("/auto-apply/matches", response_model=list[ScoredJob])
async def get_matches(
    applicant_id: uuid.UUID,
    size: int = Query(pipeline.BATCH_SIZE, ge=1, le=50),
    filters: JobFilters = Depends(read_filters),
    account: AuthenticatedAccount = Depends(get_current_account),
    db: AsyncSession = Depends(get_session),
) -> list[ScoredJob]:
    """The matches a batch would queue, without queueing them."""
    assert_applicant_owns(account, applicant_id)
    try:
        return await pipeline.get_matches(db, account, filters=filters, size=size)
    except EmptyBank as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, str(exc)) from exc


@router.post("/auto-apply/batches", response_model=BatchQueued)
async def start_batch(
    applicant_id: uuid.UUID,
    body: BatchRequest,
    filters: JobFilters = Depends(read_filters),
    account: AuthenticatedAccount = Depends(get_current_account),
    db: AsyncSession = Depends(get_session),
) -> BatchQueued:
    """Queues a batch of the applicant's best matches."""
    assert_applicant_owns(account, applicant_id)
    try:
        queued = await pipeline.start_batch(db, account, filters=filters, size=body.size)
    except EmptyBank as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, str(exc)) from exc
    return BatchQueued(queued=queued)


@router.post("/applications", response_model=ApplicationStage)
async def queue_job(
    applicant_id: uuid.UUID,
    body: QueueRequest,
    account: AuthenticatedAccount = Depends(get_current_account),
    db: AsyncSession = Depends(get_session),
) -> ApplicationStage:
    """Queues one job posting for auto apply."""
    assert_applicant_owns(account, applicant_id)
    stage = await pipeline.queue_job(db, applicant_id, body.job_id)
    return ApplicationStage(job_id=body.job_id, stage=stage)


@router.get("/applications", response_model=list[Application])
async def list_applications(
    applicant_id: uuid.UUID,
    stage: list[application_stage] = Query([]),
    scored: bool = Query(False),
    account: AuthenticatedAccount = Depends(get_current_account),
    db: AsyncSession = Depends(get_session),
) -> list[Application]:
    """The applicant's applications, newest first; with ?scored=true, each
    open job posting's match score."""
    assert_applicant_owns(account, applicant_id)
    return await pipeline.list_applications(
        db, applicant_id, stage, score_for=account if scored else None
    )


@router.get("/applications/next", response_model=Application | None)
async def next_application(
    applicant_id: uuid.UUID,
    skip: list[uuid.UUID] = Query([]),
    account: AuthenticatedAccount = Depends(get_current_account),
    db: AsyncSession = Depends(get_session),
) -> Application | None:
    """The next application to fill, past the jobs in `skip`, or null."""
    assert_applicant_owns(account, applicant_id)
    return await pipeline.next_application(db, applicant_id, skip)


# After /applications/next: a job id is a UUID, so "next" would match this
# path first and fail its validation with a 422.
@router.get("/applications/{job_id}", response_model=Application)
async def get_application(
    applicant_id: uuid.UUID,
    job_id: uuid.UUID,
    account: AuthenticatedAccount = Depends(get_current_account),
    db: AsyncSession = Depends(get_session),
) -> Application:
    """The applicant's application for one job posting."""
    assert_applicant_owns(account, applicant_id)
    return await pipeline.get_application(db, applicant_id, job_id)


@router.delete("/applications/{job_id}", status_code=status.HTTP_204_NO_CONTENT)
async def dequeue_job(
    applicant_id: uuid.UUID,
    job_id: uuid.UUID,
    account: AuthenticatedAccount = Depends(get_current_account),
    db: AsyncSession = Depends(get_session),
) -> Response:
    """Takes one queued job posting out of the queue."""
    assert_applicant_owns(account, applicant_id)
    await pipeline.dequeue_job(db, applicant_id, job_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/applications/{job_id}/resume", response_model=SentResumeDownload | None)
async def prepare_resume(
    applicant_id: uuid.UUID,
    job_id: uuid.UUID,
    account: AuthenticatedAccount = Depends(get_current_account),
    db: AsyncSession = Depends(get_session),
) -> SentResumeDownload | None:
    """The resume one application attaches, kept as a sent resume, or null."""
    assert_applicant_owns(account, applicant_id)
    try:
        return await pipeline.prepare_resume(db, get_supabase().storage, applicant_id, job_id)
    except TectonicUnavailable as exc:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE, "The resume's PDF could not be made. Try again."
        ) from exc
    except pipeline.FileFailed as exc:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, str(exc)) from exc


@router.put("/applications/{job_id}/resume", response_model=SentResumeResponse)
async def choose_resume(
    applicant_id: uuid.UUID,
    job_id: uuid.UUID,
    body: ChooseResume,
    account: AuthenticatedAccount = Depends(get_current_account),
    db: AsyncSession = Depends(get_session),
) -> SentResumeResponse:
    """The student's pick of the resume one queued application goes out with."""
    assert_applicant_owns(account, applicant_id)
    choice = ResumeChoice(
        built_resume_id=body.built_resume_id, uploaded_resume_id=body.uploaded_resume_id
    )
    try:
        return await pipeline.choose_resume(db, applicant_id, job_id, choice)
    except TectonicUnavailable as exc:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE, "The resume's PDF could not be made. Try again."
        ) from exc


@router.post("/applications/{job_id}/finish", response_model=ApplicationStage)
async def finish_application(
    applicant_id: uuid.UUID,
    job_id: uuid.UUID,
    body: FinishRequest,
    account: AuthenticatedAccount = Depends(get_current_account),
    db: AsyncSession = Depends(get_session),
) -> ApplicationStage:
    """Records how one application's fill ended."""
    assert_applicant_owns(account, applicant_id)
    stage = await pipeline.finish_application(db, applicant_id, job_id, body.outcome)
    return ApplicationStage(job_id=job_id, stage=stage)


@router.put("/applications/{job_id}/questions", response_model=list[WrittenAnswer])
async def ask_questions(
    applicant_id: uuid.UUID,
    job_id: uuid.UUID,
    body: WrittenQuestions,
    account: AuthenticatedAccount = Depends(get_current_account),
    db: AsyncSession = Depends(get_session),
) -> list[WrittenAnswer]:
    """Keeps the questions a batch tab's form needs written, for the connector."""
    assert_applicant_owns(account, applicant_id)
    return await pipeline.ask_questions(db, applicant_id, job_id, body.questions)


@router.get("/applications/{job_id}/questions", response_model=list[WrittenAnswer])
async def written_answers(
    applicant_id: uuid.UUID,
    job_id: uuid.UUID,
    account: AuthenticatedAccount = Depends(get_current_account),
    db: AsyncSession = Depends(get_session),
) -> list[WrittenAnswer]:
    """An application's questions that need writing, with the answers saved so far and what the
    student's Claude's pre-submit review found (KAN-369)."""
    assert_applicant_owns(account, applicant_id)
    return await pipeline.reviewed_answers(db, applicant_id, job_id)


@router.post("/applications/{job_id}/review/{action}", status_code=status.HTTP_204_NO_CONTENT)
async def answer_flag(
    applicant_id: uuid.UUID,
    job_id: uuid.UUID,
    action: Literal["keep", "rewrite"],
    body: FlagAnswer,
    account: AuthenticatedAccount = Depends(get_current_account),
    db: AsyncSession = Depends(get_session),
) -> Response:
    """The batch tab's flag card (KAN-369): the student keeps a flagged answer
    as it stands, or sends it back to their Claude to rewrite."""
    assert_applicant_owns(account, applicant_id)
    try:
        await (pipeline.keep if action == "keep" else pipeline.rewrite)(db, applicant_id, job_id, body.name)
    except pipeline.Refused as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, str(exc)) from exc
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.put("/applications/{job_id}/answers", response_model=SavedAnswer)
async def save_own_answer(
    applicant_id: uuid.UUID,
    job_id: uuid.UUID,
    body: OwnAnswer,
    account: AuthenticatedAccount = Depends(get_current_account),
    db: AsyncSession = Depends(get_session),
) -> SavedAnswer:
    """The student's answer to a question their batch tab needs written."""
    assert_applicant_owns(account, applicant_id)
    try:
        await pipeline.save_own_answer(db, applicant_id, job_id, body)
    except pipeline.Refused as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, str(exc)) from exc
    return SavedAnswer(answer=body.answer.strip(), own=body.own)


@router.delete("/applications/{job_id}/answers", status_code=status.HTTP_204_NO_CONTENT)
async def drop_own_answer(
    applicant_id: uuid.UUID,
    job_id: uuid.UUID,
    name: str = Query(min_length=1, max_length=200),
    account: AuthenticatedAccount = Depends(get_current_account),
    db: AsyncSession = Depends(get_session),
) -> Response:
    """Undo on the batch tab's guess card: takes back an answer the student saved."""
    assert_applicant_owns(account, applicant_id)
    await pipeline.drop_own_answer(db, applicant_id, job_id, name)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/applications/{job_id}/answer-bank", response_model=dict[str, SavedAnswer])
async def answer_bank(
    applicant_id: uuid.UUID,
    job_id: uuid.UUID,
    account: AuthenticatedAccount = Depends(get_current_account),
    db: AsyncSession = Depends(get_session),
) -> dict[str, SavedAnswer]:
    """The saved answers this application's form may reuse, by question wording."""
    assert_applicant_owns(account, applicant_id)
    return await pipeline.answer_bank(db, applicant_id, job_id)


@router.get("/answer-bank", response_model=dict[str, SavedAnswer])
async def any_form_answer_bank(
    applicant_id: uuid.UUID,
    company: str | None = Query(default=None, max_length=200),
    account: AuthenticatedAccount = Depends(get_current_account),
    db: AsyncSession = Depends(get_session),
) -> dict[str, SavedAnswer]:
    """The saved answers a form filled outside a batch may reuse, by question wording."""
    assert_applicant_owns(account, applicant_id)
    return await pipeline.answer_bank(db, applicant_id, None, company)


@router.put("/applications/{job_id}/fill", response_model=ApplicationStage)
async def record_fill(
    applicant_id: uuid.UUID,
    job_id: uuid.UUID,
    body: FillRequest,
    account: AuthenticatedAccount = Depends(get_current_account),
    db: AsyncSession = Depends(get_session),
) -> ApplicationStage:
    """Records how a batch tab's fill left one application's form."""
    assert_applicant_owns(account, applicant_id)
    stage = await pipeline.record_fill(db, applicant_id, job_id, body.state)
    return ApplicationStage(job_id=job_id, stage=stage)
