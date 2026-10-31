"""
Reading the feed's rows: a page of them (fetch_listings), how many
(fetch_count), and one with its description (fetch_listing, for the job's
own page and for Scout), each in the JobListing shape (to_listing).

Descriptions are left out of the list: the cards never show them, and at
several thousand characters each they would make every feed load many times
heavier — so the query doesn't read them either. fetch_listing does, for Scout
and for GET /jobs/{job_id}, the job's own page.
"""

import uuid

from sqlalchemy import Row, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.jobs import Job_Post
from app.queries.jobs.filters import FORM_URL, LISTED, JobFilters, matching
from app.schemas.jobs import JobListing

LISTING_COLUMNS = (
    Job_Post.id,
    Job_Post.title,
    Job_Post.company_name,
    Job_Post.apply_url,
    Job_Post.experience_level,
    Job_Post.work_style,
    Job_Post.location_raw,
    Job_Post.location_label,
    Job_Post.posted_at,
    Job_Post.company_logo_url,
    Job_Post.company_domain,
    Job_Post.job_type,
    Job_Post.min_years_experience,
    Job_Post.start_term,
    Job_Post.sponsorship,
    Job_Post.salary,
    Job_Post.salary_min,
    Job_Post.salary_max,
    Job_Post.salary_currency,
    Job_Post.salary_period,
    FORM_URL.label("form_url"),
)


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
        form_url=row.form_url,
        experience_level=row.experience_level.value,
        work_style=row.work_style,
        location=row.location_raw,
        location_label=row.location_label,
        posted_at=row.posted_at.isoformat() if row.posted_at else None,
        logo_url=row.company_logo_url,
        company_domain=row.company_domain,
        description=description,
        job_type=row.job_type,
        min_years_experience=row.min_years_experience,
        start_term=row.start_term,
        sponsorship=row.sponsorship,
        salary=row.salary,
        salary_min=row.salary_min,
        salary_max=row.salary_max,
        # NOT NULL with defaults, so they mean something only beside an amount.
        salary_currency=row.salary_currency if paid else None,
        salary_period=row.salary_period if paid else None,
    )


async def fetch_listings(
    db: AsyncSession, limit: int, filters: JobFilters = JobFilters(), offset: int = 0
) -> list[JobListing]:
    '''
    the newest published scraped jobs, by when their board says they went up,
    narrowed by whatever `filters` asks for, `offset` of them in
    '''
    query = select(*LISTING_COLUMNS).where(LISTED, *matching(filters))
    rows = await db.execute(
        # id breaks ties, so the order is the same on every request and a
        # page picks up exactly where the last one stopped.
        query.order_by(Job_Post.posted_at.desc().nulls_last(), Job_Post.id)
        .offset(offset)
        .limit(limit)
    )
    return [to_listing(row) for row in rows]


async def fetch_count(db: AsyncSession, filters: JobFilters) -> int:
    '''how many published scraped jobs these filters keep, past any limit'''
    return (await db.execute(
        select(func.count()).select_from(Job_Post).where(LISTED, *matching(filters))
    )).scalar_one()


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
    row = (await db.execute(select(*LISTING_COLUMNS, Job_Post.description).where(LISTED, match))).first()
    return to_listing(row, row.description) if row else None
