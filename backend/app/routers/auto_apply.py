"""
Auto apply (KAN-223), layer 3: each route checks the caller owns the
applicant, calls one layer-2 step (app/auto_apply/pipeline.py) and returns
its result. The webapp, the extension and later an MCP server call these
(auto-apply/architecture.md, "API routes").

GET  /applicants/{id}/auto-apply/matches
     The best matches not yet queued or applied, best first, as ScoredJobs.
     ?size= (default 10) and the Jobs page's own filters (?location=, ?visa=...).
     404 without a parsed primary resume.
POST /applicants/{id}/auto-apply/batches  {"size": 10}
     Start Auto Apply: queues that many matches, same filters. Answers
     {"queued": [job ids]}, best first; fewer when fewer are left. 404 without
     a parsed primary resume.
POST /applicants/{id}/applications  {"job_id": ...}
     A job's Auto Apply button: queues one job posting. Answers its stage;
     a job that already has an application keeps that stage. 404 for a job
     posting that isn't open.
GET  /applicants/{id}/applications?stage=queued&stage=needs_you
     The applications, newest first (every stage without ?stage=), each
     with its job posting's listing and `open` (false once it closed).
GET  /applicants/{id}/applications/next
     What the extension fills next: the oldest queued application whose job
     posting is open, or null when none is left.
GET  /applicants/{id}/applications/{job_id}
     The application for one job posting, as the list has it. 404 when the
     applicant has none.
POST /applicants/{id}/applications/{job_id}/finish  {"outcome": "submitted"}
     How a fill ended: submitted → applied, skipped → skipped, failed →
     needs_you. 404 with no application, 409 when it isn't queued or
     needs_you.

Applicant accounts only, and only their own id (assert_applicant_owns).
"""

import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.auto_apply import pipeline
from app.db import get_session
from app.deps import assert_applicant_owns, get_current_account
from app.models.dto import application_stage
from app.queries.jobs.filters import JobFilters
from app.routers.jobs import NoResume, read_filters
from app.schemas.applications import (
    Application,
    ApplicationStage,
    BatchQueued,
    BatchRequest,
    FinishRequest,
    QueueRequest,
)
from app.schemas.auth import AuthenticatedAccount
from app.schemas.jobs import ScoredJob

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
        return await pipeline.get_matches(db, applicant_id, filters=filters, size=size)
    except NoResume as exc:
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
        queued = await pipeline.start_batch(db, applicant_id, filters=filters, size=body.size)
    except NoResume as exc:
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
    account: AuthenticatedAccount = Depends(get_current_account),
    db: AsyncSession = Depends(get_session),
) -> list[Application]:
    """The applicant's applications, newest first."""
    assert_applicant_owns(account, applicant_id)
    return await pipeline.list_applications(db, applicant_id, stage)


@router.get("/applications/next", response_model=Application | None)
async def next_application(
    applicant_id: uuid.UUID,
    account: AuthenticatedAccount = Depends(get_current_account),
    db: AsyncSession = Depends(get_session),
) -> Application | None:
    """The next application to fill, or null."""
    assert_applicant_owns(account, applicant_id)
    return await pipeline.next_application(db, applicant_id)


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
        stage = await pipeline.finish_application(db, applicant_id, job_id, body.outcome)
    except pipeline.NotFound as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, str(exc)) from exc
    except pipeline.WrongStage as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, str(exc)) from exc
    return ApplicationStage(job_id=job_id, stage=stage)
