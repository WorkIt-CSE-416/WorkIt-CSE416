"""
GET /jobs — the seeker feed: scraped roles, read from job_postings.

The scraper's feed.json reaches the database through app/scripts/import_jobs.py,
which upserts it into job_postings (company_id NULL) and resolves its locations
into job_locations. This route reads those rows and never the file, so the
deployed API needs no snapshot and serves whatever the last import left.

Scraped jobs only, for now. A company's own posting has no apply URL and no
company_name, both of which JobListing — and the frontend type that mirrors it
(frontend/src/app/(seeker)/jobs/listings.ts) — require. Putting company jobs in
the seeker feed is its own change, with its own response shape.

`id` is the row's UUID. Scout is handed it back to name the job a question is
about, and looks it up with fetch_listing.

Public on purpose: a list of public job postings says nothing about the caller.

Descriptions are left out of the list: the cards never show them, and at
several thousand characters each they would make every feed load many times
heavier — so the query doesn't read them either. fetch_listing does, for Scout.
"""

import uuid

from fastapi import APIRouter, Depends, Query
from sqlalchemy import Row, and_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_session
from app.models.dto import job_post_status
from app.models.jobs import Job_Post
from app.schemas.jobs import JobListing

router = APIRouter(prefix="/jobs", tags=["jobs"])

_COLUMNS = (
    Job_Post.id,
    Job_Post.title,
    Job_Post.company_name,
    Job_Post.apply_url,
    Job_Post.experience_level,
    Job_Post.work_style,
    Job_Post.location_raw,
    Job_Post.posted_at,
    Job_Post.company_logo_url,
    Job_Post.job_type,
    Job_Post.min_years_experience,
    Job_Post.start_term,
    Job_Post.salary,
    Job_Post.salary_min,
    Job_Post.salary_max,
    Job_Post.salary_currency,
    Job_Post.salary_period,
)

_LISTED = and_(Job_Post.company_id.is_(None), Job_Post.status == job_post_status.published)


def to_listing(row: Row, description: str | None = None) -> JobListing:
    '''
    a job_postings row in the shape the feed has always had, so the frontend
    and Scout read it unchanged
    '''
    paid = row.salary is not None or row.salary_min is not None
    return JobListing(
        id=str(row.id),
        title=row.title,
        company=row.company_name,
        apply_url=row.apply_url,
        experience_level=row.experience_level.value,
        work_style=row.work_style,
        location=row.location_raw,
        posted_at=row.posted_at.isoformat() if row.posted_at else None,
        logo_url=row.company_logo_url,
        description=description,
        job_type=row.job_type,
        min_years_experience=row.min_years_experience,
        start_term=row.start_term,
        salary=row.salary,
        salary_min=row.salary_min,
        salary_max=row.salary_max,
        # NOT NULL with defaults, so they mean something only beside an amount.
        salary_currency=row.salary_currency if paid else None,
        salary_period=row.salary_period if paid else None,
    )


async def fetch_listings(db: AsyncSession, limit: int) -> list[JobListing]:
    '''
    the newest published scraped jobs, by when their board says they went up
    '''
    rows = await db.execute(
        select(*_COLUMNS)
        .where(_LISTED)
        # id breaks ties, so the order is the same on every request.
        .order_by(Job_Post.posted_at.desc().nulls_last(), Job_Post.id)
        .limit(limit)
    )
    return [to_listing(row) for row in rows]


async def fetch_listing(db: AsyncSession, job_id: str) -> JobListing | None:
    '''
    one published scraped job with its description, or None. Its UUID, as
    GET /jobs sends it; an apply URL also works, since that was a job's id
    before the feed moved into the database, and a Scout panel left open
    across the deploy still holds one.
    '''
    try:
        match = Job_Post.id == uuid.UUID(job_id)
    except ValueError:
        match = Job_Post.apply_url == job_id
    row = (await db.execute(select(*_COLUMNS, Job_Post.description).where(_LISTED, match))).first()
    return to_listing(row, row.description) if row else None


@router.get(
    "",
    response_model=list[JobListing],
    response_model_exclude={"__all__": {"description"}},
)
async def list_jobs(
    limit: int = Query(50, ge=1, le=500),
    db: AsyncSession = Depends(get_session),
) -> list[JobListing]:
    """Newest roles first. Empty until the first import has run."""
    return await fetch_listings(db, limit)
