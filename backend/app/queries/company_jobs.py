"""Company job posting queries: the database work behind routers/company_jobs.py."""

import logging
import uuid

from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.jobs import Job_Location, Job_Post
from app.schemas.auth import AuthenticatedAccount
from app.schemas.company_jobs import JobPosting

logger = logging.getLogger(__name__)

# The foreign keys a job's location is checked against.
_LOCATION_CONSTRAINTS = {"job_locations_country_fkey", "job_locations_state_country_fkey"}


async def own_job(
    db: AsyncSession, job_id: uuid.UUID, account: AuthenticatedAccount, *, lock: bool = False
) -> Job_Post | None:
    """The job, if it belongs to the caller's company. Returns None when it
    doesn't exist or belongs to another company."""
    job = await db.get(Job_Post, job_id, with_for_update=lock)
    if job is None or job.company_id != account.company_id:
        return None
    return job


async def set_location(
    db: AsyncSession, job_id: uuid.UUID, country: str | None, state: str | None
) -> None:
    """Replace the job's place with the form's. Run after the job is flushed."""
    await db.execute(delete(Job_Location).where(Job_Location.job_id == job_id))
    if country is not None:
        db.add(Job_Location(job_id=job_id, country=country, state=state))


async def locations(db: AsyncSession, job_ids: list[uuid.UUID]) -> dict[uuid.UUID, Job_Location]:
    """Each job's place, one per company job."""
    rows = await db.execute(select(Job_Location).where(Job_Location.job_id.in_(job_ids)))
    return {loc.job_id: loc for loc in rows.scalars()}


async def posting(db: AsyncSession, job: Job_Post) -> JobPosting:
    """The job as the API returns it, with its place filled in."""
    loc = (await locations(db, [job.id])).get(job.id)
    result = JobPosting.model_validate(job)
    if loc is None:
        return result
    return result.model_copy(update={"location_country": loc.country, "location_state": loc.state})


async def list_company_jobs(
    db: AsyncSession, company_id: uuid.UUID, limit: int, offset: int
) -> list[Job_Post]:
    """A page of the company's jobs, newest first."""
    rows = await db.execute(
        select(Job_Post)
        .where(Job_Post.company_id == company_id)
        # id breaks ties, so two jobs created in one transaction can't swap
        # places between pages and be skipped or shown twice.
        .order_by(Job_Post.created_at.desc(), Job_Post.id)
        .limit(limit)
        .offset(offset)
    )
    return list(rows.scalars())


class UnsupportedLocation(Exception):
    """A country or state code that isn't seeded."""


async def commit_job(db: AsyncSession, job: Job_Post) -> None:
    """Commit a new or changed job and reload what the database filled in.
    Raises UnsupportedLocation when a location foreign key fails."""
    try:
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        constraint = getattr(exc.orig.__cause__, "constraint_name", None)
        if constraint not in _LOCATION_CONSTRAINTS:
            raise
        logger.info("Job write rejected: %s", exc.orig)
        raise UnsupportedLocation("That location isn't supported yet.") from exc
    await db.refresh(job)
