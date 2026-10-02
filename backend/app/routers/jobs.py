"""
Company job postings: the routes behind the job composer
(frontend/src/app/company/jobs). Every route here acts on the caller's own
company, taken from the verified token, never from the request.
"""

import datetime
import logging
import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_session
from app.deps import get_company_member
from app.models.dto import job_post_status
from app.models.jobs import Job_Post
from app.schemas.auth import AuthenticatedAccount
from app.schemas.jobs import JobPosting, JobPostingCreate, JobStatusChange

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/company/jobs", tags=["jobs"])

_JOB_NOT_FOUND = HTTPException(status.HTTP_404_NOT_FOUND, "Job not found.")

# Where a job may go from each status through the status route. Draft to
# published isn't here: publishing goes through PUT with the full form, so the
# details are checked at the moment the job goes live. Closed is final.
_NEXT_STATUSES: dict[job_post_status, set[job_post_status]] = {
    job_post_status.published: {job_post_status.closed},
}


async def _commit(db: AsyncSession, job: Job_Post) -> None:
    '''
    commit a new or changed job and reload what the database filled in
    '''
    try:
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        # The schema already enforces salary and state/country agreement, so
        # what reaches here is a country or state code that isn't seeded.
        logger.info("Job write rejected: %s", exc.orig)
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            "That location isn't supported yet.",
        ) from exc

    # created_at and updated_at come from the database, so they aren't on the
    # object yet; reading them lazily would raise MissingGreenlet in async.
    await db.refresh(job)


async def _own_job(db: AsyncSession, job_id: uuid.UUID, account: AuthenticatedAccount) -> Job_Post:
    '''
    the job, if it belongs to the caller's company. Another company's job is a
    404 rather than a 403, so ids can't be probed for existence.
    '''
    job = await db.get(Job_Post, job_id)
    if job is None or job.company_id != account.company_id:
        raise _JOB_NOT_FOUND
    return job


@router.post("", response_model=JobPosting, status_code=status.HTTP_201_CREATED)
async def create_job(
    body: JobPostingCreate,
    account: AuthenticatedAccount = Depends(get_company_member),
    db: AsyncSession = Depends(get_session),
) -> Job_Post:
    '''
    save a new job, as a draft or published, under the caller's company
    '''
    job = Job_Post(
        **body.model_dump(),
        company_id=account.company_id,
        posted_by_recruiter_id=account.id,
    )
    db.add(job)
    await _commit(db, job)
    return job


@router.get("", response_model=list[JobPosting])
async def list_jobs(
    account: AuthenticatedAccount = Depends(get_company_member),
    db: AsyncSession = Depends(get_session),
) -> list[Job_Post]:
    '''
    every job the caller's company has, newest first
    '''
    rows = await db.execute(
        select(Job_Post)
        .where(Job_Post.company_id == account.company_id)
        .order_by(Job_Post.created_at.desc())
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
    body: JobPostingCreate,
    account: AuthenticatedAccount = Depends(get_company_member),
    db: AsyncSession = Depends(get_session),
) -> Job_Post:
    '''
    replace a job's details with the composer's full form. PUT, not PATCH: the
    form always sends every field, and the salary rules need all of them at
    once to check.

    Status may only stay put or move forward: a draft can be published, but a
    published job can't return to draft, and a closed job can't be edited.
    '''
    job = await _own_job(db, job_id, account)

    if job.status == job_post_status.closed:
        raise HTTPException(status.HTTP_409_CONFLICT, "A closed job can't be edited.")
    if job.status == job_post_status.published and body.status == job_post_status.draft:
        raise HTTPException(status.HTTP_409_CONFLICT, "A published job can't go back to being a draft.")

    for field, value in body.model_dump().items():
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
