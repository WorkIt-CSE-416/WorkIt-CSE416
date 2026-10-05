"""
Company job postings: the routes behind the job composer
(frontend/src/app/company/jobs). Every route here acts on the caller's own
company, taken from the verified token, never from the request.
"""

import datetime
import logging
import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_session
from app.deps import get_company_member
from app.models.dto import job_post_status
from app.models.jobs import Job_Post
from app.schemas.auth import AuthenticatedAccount
from app.schemas.company_jobs import (
    JobPosting,
    JobPostingCreate,
    JobPostingSummary,
    JobPostingUpdate,
    JobStatusChange,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/company/jobs", tags=["company jobs"])

# The foreign keys a job's location is checked against. Anything else that
# fails on commit is a bug of ours, not an unsupported location.
_LOCATION_CONSTRAINTS = {"job_postings_location_country_fkey", "country_state_reference_exist"}


# Where a job may go from each status through the status route. Draft to
# published isn't here: publishing goes through PUT with the full form, so the
# details are checked at the moment the job goes live. Closed is final.
_NEXT_STATUSES: dict[job_post_status, set[job_post_status]] = {
    job_post_status.published: {job_post_status.closed},
}


# A function, not a shared instance: see _not_authenticated in app/deps.py.
def _job_not_found() -> HTTPException:
    return HTTPException(status.HTTP_404_NOT_FOUND, "Job not found.")


async def _commit(db: AsyncSession, job: Job_Post) -> None:
    '''
    commit a new or changed job and reload what the database filled in
    '''
    try:
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        # The schema already enforces salary and state/country agreement, so
        # a location foreign key failing means a country or state code that
        # isn't seeded. asyncpg's own error, which names the constraint, is
        # the cause of the DBAPI error SQLAlchemy wraps.
        constraint = getattr(exc.orig.__cause__, "constraint_name", None)
        if constraint not in _LOCATION_CONSTRAINTS:
            raise
        logger.info("Job write rejected: %s", exc.orig)
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            "That location isn't supported yet.",
        ) from exc

    # created_at and updated_at come from the database, so they aren't on the
    # object yet; reading them lazily would raise MissingGreenlet in async.
    await db.refresh(job)


async def _own_job(
    db: AsyncSession, job_id: uuid.UUID, account: AuthenticatedAccount, *, lock: bool = False
) -> Job_Post:
    '''
    the job, if it belongs to the caller's company. Another company's job is a
    404 rather than a 403, so ids can't be probed for existence. `lock` holds
    the row until commit, for a write that first checks what it read.
    '''
    job = await db.get(Job_Post, job_id, with_for_update=lock)
    if job is None or job.company_id != account.company_id:
        raise _job_not_found()
    return job


def _reject_past_close(closes_at: datetime.datetime | None) -> None:
    '''
    the date picker blocks past days, but a direct call or a form left open
    past its own closing date could otherwise put a job live that has
    already closed
    '''
    if closes_at is not None and closes_at < datetime.datetime.now(datetime.UTC):
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            "The closing date has already passed. Pick a later one, or clear it.",
        )


@router.post("", response_model=JobPosting, status_code=status.HTTP_201_CREATED)
async def create_job(
    body: JobPostingCreate,
    account: AuthenticatedAccount = Depends(get_company_member),
    db: AsyncSession = Depends(get_session),
) -> Job_Post:
    '''
    save a new job, as a draft or published, under the caller's company
    '''
    if body.status == job_post_status.published:
        _reject_past_close(body.closes_at)
    job = Job_Post(
        **body.model_dump(),
        company_id=account.company_id,
        posted_by_recruiter_id=account.id,
    )
    db.add(job)
    await _commit(db, job)
    return job


@router.get("", response_model=list[JobPostingSummary])
async def list_jobs(
    limit: int = Query(100, ge=1, le=200),
    offset: int = Query(0, ge=0),
    account: AuthenticatedAccount = Depends(get_company_member),
    db: AsyncSession = Depends(get_session),
) -> list[Job_Post]:
    '''
    a page of the caller's company's jobs, newest first. Summaries only: the
    table never shows a description, so it isn't sent. A page shorter than
    `limit` is the last one.
    '''
    rows = await db.execute(
        select(Job_Post)
        .where(Job_Post.company_id == account.company_id)
        # id breaks ties, so two jobs created in one transaction can't swap
        # places between pages and be skipped or shown twice.
        .order_by(Job_Post.created_at.desc(), Job_Post.id)
        .limit(limit)
        .offset(offset)
    )
    return list(rows.scalars())


@router.get("/{job_id}", response_model=JobPosting)
async def get_job(
    job_id: uuid.UUID,
    account: AuthenticatedAccount = Depends(get_company_member),
    db: AsyncSession = Depends(get_session),
) -> Job_Post:
    '''
    one of the caller's company's jobs
    '''
    return await _own_job(db, job_id, account)


@router.put("/{job_id}", response_model=JobPosting)
async def update_job(
    job_id: uuid.UUID,
    body: JobPostingUpdate,
    account: AuthenticatedAccount = Depends(get_company_member),
    db: AsyncSession = Depends(get_session),
) -> Job_Post:
    '''
    replace a job's details with the composer's full form. PUT, not PATCH: the
    form always sends every field, and the salary rules need all of them at
    once to check.

    Status may only stay put or move forward: a draft can be published, but a
    published job can't return to draft, and a closed job can't be edited.
    A form loaded before someone else's save is refused (409), never merged.
    '''
    # Locked, or two saves could both pass the updated_at check below before
    # either commits.
    job = await _own_job(db, job_id, account, lock=True)

    if body.updated_at != job.updated_at:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Someone else changed this job since you opened it. Reload to see their changes.",
        )
    if job.status == job_post_status.closed:
        raise HTTPException(status.HTTP_409_CONFLICT, "A closed job can't be edited.")
    if job.status == job_post_status.published and body.status == job_post_status.draft:
        raise HTTPException(status.HTTP_409_CONFLICT, "A published job can't go back to being a draft.")

    # Checked only when the date matters now: a draft going live, or a live
    # job's date being moved. Fixing a typo on a live job whose closing date
    # has lapsed doesn't make anyone pick a new date first.
    goes_live = job.status == job_post_status.draft and body.status != job_post_status.draft
    date_moved = job.status != job_post_status.draft and body.closes_at != job.closes_at
    if goes_live or date_moved:
        _reject_past_close(body.closes_at)

    for field, value in body.model_dump(exclude={"updated_at"}).items():
        setattr(job, field, value)
    await _commit(db, job)
    return job


@router.post("/{job_id}/status", response_model=JobPosting)
async def change_job_status(
    job_id: uuid.UUID,
    body: JobStatusChange,
    account: AuthenticatedAccount = Depends(get_company_member),
    db: AsyncSession = Depends(get_session),
) -> Job_Post:
    '''
    move a job along its lifecycle, e.g. close it. Only the moves in
    _NEXT_STATUSES are allowed; anything else is a 409.
    '''
    job = await _own_job(db, job_id, account)

    if body.status not in _NEXT_STATUSES.get(job.status, set()):
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"A {job.status.value} job can't be changed to {body.status.value}.",
        )

    job.status = body.status
    if body.status == job_post_status.closed:
        # Applications stop now, so a later closing date would be a lie.
        now = datetime.datetime.now(datetime.UTC)
        if job.closes_at is None or job.closes_at > now:
            job.closes_at = now

    await _commit(db, job)
    return job
