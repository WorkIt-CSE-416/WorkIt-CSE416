"""
Company job postings: the routes behind the job composer
(frontend/src/app/company/jobs). Every route here acts on the caller's own
company, taken from the verified token, never from the request.
"""

import datetime
import logging
import uuid

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import undefer
from workit_scout.llm import LLM, ScoutUnavailable

from app.db import get_session, get_sessionmaker
from app.deps import get_company_member
from app.models.dto import job_post_status
from app.models.jobs import Job_Post
from app.queries.company_jobs import (
    UnsupportedLocation,
    commit_job,
    list_company_jobs,
    locations,
    own_job,
    posting,
    set_location,
)
from app.schemas.auth import AuthenticatedAccount
from app.schemas.company_jobs import (
    JobPosting,
    JobPostingCreate,
    JobPostingSummary,
    JobPostingUpdate,
    JobStatusChange,
)
from app.services import keywords
from app.services.models import get_small_llm

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/company/jobs", tags=["company jobs"])

# In the form's body but not columns of the job: they become its one
# job_locations row. A company job has one place; several are for scraped jobs.
_LOCATION_FIELDS = {"location_country", "location_state"}


# Where a job may go from each status through the status route. Draft to
# published isn't here: publishing goes through PUT with the full form, so the
# details are checked at the moment the job goes live. Closed is final.
_NEXT_STATUSES: dict[job_post_status, set[job_post_status]] = {
    job_post_status.published: {job_post_status.paused, job_post_status.closed},
    job_post_status.paused: {job_post_status.published, job_post_status.closed},
}


# A function, not a shared instance: see _not_authenticated in app/deps.py.
def _job_not_found() -> HTTPException:
    return HTTPException(status.HTTP_404_NOT_FOUND, "Job not found.")


async def _own_job_or_404(
    db: AsyncSession, job_id: uuid.UUID, account: AuthenticatedAccount, *, lock: bool = False
) -> Job_Post:
    """The job, if it belongs to the caller's company (own_job). Another
    company's job is a 404 rather than a 403, so ids can't be probed for
    existence."""
    job = await own_job(db, job_id, account, lock=lock)
    if job is None:
        raise _job_not_found()
    return job


async def _commit(db: AsyncSession, job: Job_Post) -> None:
    """Commit through the query layer; map its error to HTTP."""
    try:
        await commit_job(db, job)
    except UnsupportedLocation as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, str(exc)) from exc


async def _fill_keywords(job_id: uuid.UUID, llm: LLM) -> None:
    '''
    extract the job's keywords once it is live, so no student's first
    keyword match or Tailor run waits on (or spends a use on) it. Runs after
    the response, in its own session: the request's has closed. A failure
    only logs; `keywords.ensure` still extracts on a student's first match.
    '''
    async with get_sessionmaker()() as db:
        job = await db.get(
            Job_Post, job_id, options=[undefer(Job_Post.keywords), undefer(Job_Post.keywords_hash)])
        if job is None or job.status != job_post_status.published:
            return
        try:
            _, extracted = await keywords.ensure(job, llm)
        except ScoutUnavailable:
            logger.warning("Keyword extraction failed for company job %s", job_id, exc_info=True)
            return
        if extracted:
            await db.commit()


def _after_save(tasks: BackgroundTasks, job: Job_Post, llm: LLM) -> None:
    '''
    queue the keyword extraction for a job saved as published. Drafts wait:
    no student sees one, and its text keeps changing. A cache that still
    matches the description makes the task a no-op.
    '''
    if job.status == job_post_status.published:
        tasks.add_task(_fill_keywords, job.id, llm)


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
    tasks: BackgroundTasks,
    account: AuthenticatedAccount = Depends(get_company_member),
    db: AsyncSession = Depends(get_session),
    llm: LLM = Depends(get_small_llm),
) -> JobPosting:
    '''
    save a new job, as a draft or published, under the caller's company
    '''
    if body.status == job_post_status.published:
        _reject_past_close(body.closes_at)
    job = Job_Post(
        **body.model_dump(exclude=_LOCATION_FIELDS),
        company_id=account.company_id,
        posted_by_recruiter_id=account.id,
    )
    db.add(job)
    await db.flush()
    await set_location(db, job.id, body.location_country, body.location_state)
    await _commit(db, job)
    _after_save(tasks, job, llm)
    return await posting(db, job)


@router.get("", response_model=list[JobPostingSummary])
async def list_jobs(
    limit: int = Query(100, ge=1, le=200),
    offset: int = Query(0, ge=0),
    account: AuthenticatedAccount = Depends(get_company_member),
    db: AsyncSession = Depends(get_session),
) -> list[JobPostingSummary]:
    '''
    a page of the caller's company's jobs, newest first. Summaries only: the
    table never shows a description, so it isn't sent. A page shorter than
    `limit` is the last one.
    '''
    jobs = await list_company_jobs(db, account.company_id, limit, offset)
    locs = await locations(db, [job.id for job in jobs])
    summaries = []
    for job in jobs:
        summary = JobPostingSummary.model_validate(job)
        if (loc := locs.get(job.id)) is not None:
            summary = summary.model_copy(update={"location_country": loc.country, "location_state": loc.state})
        summaries.append(summary)
    return summaries


@router.get("/{job_id}", response_model=JobPosting)
async def get_job(
    job_id: uuid.UUID,
    account: AuthenticatedAccount = Depends(get_company_member),
    db: AsyncSession = Depends(get_session),
) -> JobPosting:
    '''
    one of the caller's company's jobs
    '''
    return await posting(db, await _own_job_or_404(db, job_id, account))


@router.put("/{job_id}", response_model=JobPosting)
async def update_job(
    job_id: uuid.UUID,
    body: JobPostingUpdate,
    tasks: BackgroundTasks,
    account: AuthenticatedAccount = Depends(get_company_member),
    db: AsyncSession = Depends(get_session),
    llm: LLM = Depends(get_small_llm),
) -> JobPosting:
    '''
    replace a job's details with the composer's full form. PUT, not PATCH: the
    form always sends every field, and the salary rules need all of them at
    once to check.

    Only a draft's status changes here (to published, when Publish is
    pressed). A live job keeps its status, paused included, because pausing,
    resuming and closing go through the status route; a closed job can't be
    edited at all. A form loaded before someone else's save is refused (409),
    never merged.
    '''
    # Locked, or two saves could both pass the updated_at check below before
    # either commits.
    job = await _own_job_or_404(db, job_id, account, lock=True)

    if body.updated_at != job.updated_at:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Someone else changed this job since you opened it. Reload to see their changes.",
        )
    if job.status == job_post_status.closed:
        raise HTTPException(status.HTTP_409_CONFLICT, "A closed job can't be edited.")
    if job.status != job_post_status.draft and body.status == job_post_status.draft:
        raise HTTPException(status.HTTP_409_CONFLICT, "A live job can't go back to being a draft.")

    # Checked only when the date matters now: a draft going live, or a live
    # job's date being moved. Fixing a typo on a live job whose closing date
    # has lapsed doesn't make anyone pick a new date first.
    goes_live = job.status == job_post_status.draft and body.status != job_post_status.draft
    date_moved = job.status != job_post_status.draft and body.closes_at != job.closes_at
    if goes_live or date_moved:
        _reject_past_close(body.closes_at)

    keep = {"updated_at"} if job.status == job_post_status.draft else {"updated_at", "status"}
    for field, value in body.model_dump(exclude=keep | _LOCATION_FIELDS).items():
        setattr(job, field, value)
    await set_location(db, job.id, body.location_country, body.location_state)
    await _commit(db, job)
    _after_save(tasks, job, llm)
    return await posting(db, job)


@router.post("/{job_id}/status", response_model=JobPosting)
async def change_job_status(
    job_id: uuid.UUID,
    body: JobStatusChange,
    tasks: BackgroundTasks,
    account: AuthenticatedAccount = Depends(get_company_member),
    db: AsyncSession = Depends(get_session),
    llm: LLM = Depends(get_small_llm),
) -> JobPosting:
    '''
    pause, resume or close a job. Only the moves in _NEXT_STATUSES are
    allowed; anything else is a 409. A caller holding the form sends the
    updatedAt it loaded, and is refused (409) if the job changed since.
    '''
    # Locked, or two moves could both pass the check below against the same
    # old status, and the later commit could undo a close.
    job = await _own_job_or_404(db, job_id, account, lock=True)

    if body.updated_at is not None and body.updated_at != job.updated_at:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Someone else changed this job since you opened it. Reload to see their changes.",
        )

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
    _after_save(tasks, job, llm)
    return await posting(db, job)
