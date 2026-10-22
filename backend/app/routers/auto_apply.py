"""
Auto apply (KAN-223), layer 3: each route checks the caller owns the
applicant, calls one layer-2 step (app/auto_apply/pipeline.py) and returns
its result. The webapp, the extension and later an MCP server call these
(auto-apply/architecture.md, "API routes").

GET  /applicants/{id}/auto-apply/matches
     The best matches not yet queued or applied, best first, as ScoredJobs.
     Only job postings auto apply fills (app/auto_apply/hosts.py), as a batch.
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
     (app/auto_apply/hosts.py).
GET  /applicants/{id}/applications?stage=queued&stage=needs_you
     The applications, newest first (every stage without ?stage=), each
     with its job posting's listing and `open` (false once it closed).
     ?scored=true adds `match`, the Jobs page's score, and its `highlights`
     to each open one
     (the Applications page; null while the experience bank is empty).
GET  /applicants/{id}/applications/next
     What the extension fills next: the oldest queued application whose job
     posting is open, or null when none is left.
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
     closed job posting, 409 when it isn't queued, needs_you, filling or
     approved, 503 when the PDF cannot be made, 502 when Storage refuses the
     file.
POST /applicants/{id}/applications/{job_id}/finish
     {"outcome": "submitted", "note": "..."}
     How a fill ended: submitted → applied, skipped → skipped, failed →
     needs_you. `note` (optional) is logged. 404 with no application, 409
     when it isn't queued, needs_you, filling, review or approved.

WorkIt Desktop (KAN-323, auto-apply/desktop.md):
POST /applicants/{id}/applications/claim  {"n": 1..10}
     A Desktop's claim: up to n of the oldest queued applications whose job
     posting is open, moved to filling and answered as Applications, oldest
     first; [] when none is left. Never the same one to two claims. First
     sends back to queued every filling one whose Desktop has not beaten
     for 10 minutes.
PUT  /applicants/{id}/applications/{job_id}/review  Review
     Desktop filled the form and stopped before Submit: keeps the review and
     answers the stage, review. 404 with no application, 409 when it isn't
     filling.
GET  /applicants/{id}/applications/{job_id}/review
     The Review; its `answers` are the approved ones once approved. 404 when
     it has none.
POST /applicants/{id}/applications/{job_id}/approve  {"answers": [ReviewAnswer]}
     The student approves it, with edited answers or [] for the review's
     own. Answers the stage, approved. 404 with no application, 409 when it
     isn't in review.
PUT  /applicants/{id}/desktop  DesktopBeat
     Desktop's heartbeat, every 15 s. Answers the DesktopStatus.
GET  /applicants/{id}/desktop
     DesktopStatus: `online` with a beat in the last 45 s; offline with
     null `last_seen` and 0 counts when it never beat.

Applicant accounts only, and only their own id (assert_applicant_owns).
"""

import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.auto_apply import pipeline
from app.db import get_session, get_supabase
from app.deps import assert_applicant_owns, get_current_account
from app.models.dto import application_stage
from app.queries.jobs.filters import JobFilters
from app.routers.jobs import EmptyBank, read_filters
from app.schemas.applications import (
    Application,
    ApplicationStage,
    ApproveRequest,
    BatchQueued,
    BatchRequest,
    ClaimRequest,
    DesktopBeat,
    DesktopStatus,
    FinishRequest,
    QueueRequest,
    Review,
)
from app.schemas.auth import AuthenticatedAccount
from app.schemas.jobs import ScoredJob
from app.schemas.sent_resume import SentResumeDownload
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
    try:
        stage = await pipeline.queue_job(db, applicant_id, body.job_id)
    except pipeline.NotFound as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, str(exc)) from exc
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
    account: AuthenticatedAccount = Depends(get_current_account),
    db: AsyncSession = Depends(get_session),
) -> Application | None:
    """The next application to fill, or null."""
    assert_applicant_owns(account, applicant_id)
    return await pipeline.next_application(db, applicant_id)


@router.post("/applications/claim", response_model=list[Application])
async def claim_applications(
    applicant_id: uuid.UUID,
    body: ClaimRequest,
    account: AuthenticatedAccount = Depends(get_current_account),
    db: AsyncSession = Depends(get_session),
) -> list[Application]:
    """A Desktop claims up to n queued applications to fill."""
    assert_applicant_owns(account, applicant_id)
    return await pipeline.claim_applications(db, applicant_id, body.n)


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
    try:
        return await pipeline.get_application(db, applicant_id, job_id)
    except pipeline.NotFound as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, str(exc)) from exc


@router.delete("/applications/{job_id}", status_code=status.HTTP_204_NO_CONTENT)
async def dequeue_job(
    applicant_id: uuid.UUID,
    job_id: uuid.UUID,
    account: AuthenticatedAccount = Depends(get_current_account),
    db: AsyncSession = Depends(get_session),
) -> Response:
    """Takes one queued job posting out of the queue."""
    assert_applicant_owns(account, applicant_id)
    try:
        await pipeline.dequeue_job(db, applicant_id, job_id)
    except pipeline.NotFound as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, str(exc)) from exc
    except pipeline.WrongStage as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, str(exc)) from exc
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
    except pipeline.NotFound as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, str(exc)) from exc
    except pipeline.WrongStage as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, str(exc)) from exc
    except TectonicUnavailable as exc:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE, "The resume's PDF could not be made. Try again."
        ) from exc
    except pipeline.FileFailed as exc:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, str(exc)) from exc


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
    try:
        stage = await pipeline.finish_application(
            db, applicant_id, job_id, body.outcome, body.note
        )
    except pipeline.NotFound as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, str(exc)) from exc
    except pipeline.WrongStage as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, str(exc)) from exc
    return ApplicationStage(job_id=job_id, stage=stage)


@router.put("/applications/{job_id}/review", response_model=ApplicationStage)
async def submit_review(
    applicant_id: uuid.UUID,
    job_id: uuid.UUID,
    body: Review,
    account: AuthenticatedAccount = Depends(get_current_account),
    db: AsyncSession = Depends(get_session),
) -> ApplicationStage:
    """Keeps what Desktop filled, for the student's review."""
    assert_applicant_owns(account, applicant_id)
    try:
        stage = await pipeline.submit_review(db, applicant_id, job_id, body)
    except pipeline.NotFound as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, str(exc)) from exc
    except pipeline.WrongStage as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, str(exc)) from exc
    return ApplicationStage(job_id=job_id, stage=stage)


@router.get("/applications/{job_id}/review", response_model=Review)
async def get_review(
    applicant_id: uuid.UUID,
    job_id: uuid.UUID,
    account: AuthenticatedAccount = Depends(get_current_account),
    db: AsyncSession = Depends(get_session),
) -> Review:
    """One application's review."""
    assert_applicant_owns(account, applicant_id)
    try:
        return await pipeline.get_review(db, applicant_id, job_id)
    except pipeline.NotFound as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, str(exc)) from exc


@router.post("/applications/{job_id}/approve", response_model=ApplicationStage)
async def approve_application(
    applicant_id: uuid.UUID,
    job_id: uuid.UUID,
    body: ApproveRequest,
    account: AuthenticatedAccount = Depends(get_current_account),
    db: AsyncSession = Depends(get_session),
) -> ApplicationStage:
    """The student approves a reviewed application for Desktop to submit."""
    assert_applicant_owns(account, applicant_id)
    try:
        stage = await pipeline.approve_application(db, applicant_id, job_id, body.answers)
    except pipeline.NotFound as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, str(exc)) from exc
    except pipeline.WrongStage as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, str(exc)) from exc
    return ApplicationStage(job_id=job_id, stage=stage)


@router.put("/desktop", response_model=DesktopStatus)
async def desktop_beat(
    applicant_id: uuid.UUID,
    body: DesktopBeat,
    account: AuthenticatedAccount = Depends(get_current_account),
    db: AsyncSession = Depends(get_session),
) -> DesktopStatus:
    """Desktop's heartbeat."""
    assert_applicant_owns(account, applicant_id)
    return await pipeline.desktop_beat(db, applicant_id, body)


@router.get("/desktop", response_model=DesktopStatus)
async def desktop_status(
    applicant_id: uuid.UUID,
    account: AuthenticatedAccount = Depends(get_current_account),
    db: AsyncSession = Depends(get_session),
) -> DesktopStatus:
    """Whether the applicant's Desktop is running."""
    assert_applicant_owns(account, applicant_id)
    return await pipeline.desktop_status(db, applicant_id)
