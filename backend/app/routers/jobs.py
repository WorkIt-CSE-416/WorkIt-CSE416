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

?location= narrows the feed to jobs offered in any of the places named, by
their job_locations rows: a country code ("US") matches every job in that
country, a state code ("US-CA") its state. GET /jobs/locations lists the
places that have jobs, with names, for the job board's Location filter. A job
the location resolver couldn't place has no rows, so any location filter
leaves it out (models/CLAUDE.md, the resolver section).

?workplace= (remote, hybrid, onsite) and ?experience= (internship, new_grad)
keep jobs with any of the values named, and ?posted= (day, week, month) those
posted within that long. Each narrows on top of the others, so ticking two
workplaces widens the feed and ticking a workplace and a place narrows it. A
job missing the column (a few have no work_style) is left out by any filter
on it.

Descriptions are left out of the list: the cards never show them, and at
several thousand characters each they would make every feed load many times
heavier — so the query doesn't read them either. fetch_listing does, for Scout.
"""

import uuid
from collections.abc import Iterable, Sequence
from datetime import UTC, datetime, timedelta
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Query
from pydantic import StringConstraints
from sqlalchemy import Row, and_, distinct, exists, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_session
from app.models.dto import experience_level, job_post_status, work_style
from app.models.jobs import Job_Location, Job_Post
from app.models.locations import Country, State
from app.schemas.jobs import JobListing, JobLocationOption

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

# A country ("US") or a state ("US-CA"). Only the shape is checked: a code no
# job uses matches nothing, which is the right answer for it. The frontend's
# readPlaces (jobs/listings.ts) filters ?location= by the same pattern.
PlaceCode = Annotated[str, StringConstraints(pattern=r"^[A-Z]{2}(-[A-Z0-9]{1,3})?$")]

# The catch-all country for places outside the seed (models/CLAUDE.md), named
# "Other". It goes last, and its placeholder state ZZ-ZZ is never listed.
_OTHER = "ZZ"

# ?posted=: how far back each choice reaches. A month is 30 days.
PostedWithin = Literal["day", "week", "month"]
_POSTED_WITHIN: dict[str, timedelta] = {
    "day": timedelta(days=1),
    "week": timedelta(days=7),
    "month": timedelta(days=30),
}


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


def offered_in(places: Iterable[str]):
    '''
    true for a job with a job_locations row in any of these places. A state
    code is matched with its country too, so job_locations_place_idx, which
    leads with country, serves it
    '''
    clauses = [
        and_(Job_Location.country == code[:2], Job_Location.state == code)
        if "-" in code
        else Job_Location.country == code
        for code in places
    ]
    return exists().where(Job_Location.job_id == Job_Post.id, or_(*clauses))


async def fetch_listings(
    db: AsyncSession,
    limit: int,
    places: Sequence[str] = (),
    workplaces: Sequence[work_style] = (),
    levels: Sequence[experience_level] = (),
    posted: PostedWithin | None = None,
) -> list[JobListing]:
    '''
    the newest published scraped jobs, by when their board says they went up,
    offered in any of `places`, in any of `workplaces`, at any of `levels`
    and posted within `posted`, each only when it names some
    '''
    query = select(*_COLUMNS).where(_LISTED)
    if places:
        query = query.where(offered_in(places))
    if workplaces:
        query = query.where(Job_Post.work_style.in_(workplaces))
    if levels:
        query = query.where(Job_Post.experience_level.in_(levels))
    if posted:
        query = query.where(Job_Post.posted_at >= datetime.now(UTC) - _POSTED_WITHIN[posted])
    rows = await db.execute(
        # id breaks ties, so the order is the same on every request.
        query.order_by(Job_Post.posted_at.desc().nulls_last(), Job_Post.id).limit(limit)
    )
    return [to_listing(row) for row in rows]


def location_options(
    countries: Iterable[Row], states: Iterable[Row]
) -> list[JobLocationOption]:
    '''
    each country, busiest first, followed by its states A to Z; the catch-all
    country last, without its placeholder state. A state is labelled with its
    own name: the job board lists it under its country. `countries` rows are
    (code, name, jobs) and `states` rows (code, country, name, jobs)
    '''
    by_country: dict[str, list[Row]] = {}
    for state in states:
        by_country.setdefault(state.country, []).append(state)

    options = []
    for country in sorted(countries, key=lambda c: (c.code == _OTHER, -c.jobs, c.name)):
        options.append(JobLocationOption(code=country.code, label=country.name, jobs=country.jobs))
        if country.code == _OTHER:
            continue
        for state in sorted(by_country.get(country.code, []), key=lambda s: s.name):
            options.append(JobLocationOption(code=state.code, label=state.name, jobs=state.jobs))
    return options


async def fetch_location_options(db: AsyncSession) -> list[JobLocationOption]:
    '''
    every country and state with a published scraped job, and how many
    '''
    jobs = func.count(distinct(Job_Location.job_id)).label("jobs")
    listed = and_(Job_Post.id == Job_Location.job_id, _LISTED)
    countries = await db.execute(
        select(Country.code, Country.name, jobs)
        .join(Job_Location, Job_Location.country == Country.code)
        .join(Job_Post, listed)
        .group_by(Country.code, Country.name)
    )
    states = await db.execute(
        select(State.code, State.country_code.label("country"), State.name, jobs)
        .join(Job_Location, and_(
            Job_Location.country == State.country_code, Job_Location.state == State.code
        ))
        .join(Job_Post, listed)
        .group_by(State.code, State.country_code, State.name)
    )
    return location_options(countries.all(), states.all())


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
    # Repeated for several: ?location=US-CA&location=US-NY. Capped so a URL
    # can't turn into a thousand-clause query.
    location: list[PlaceCode] = Query([], max_length=60),
    # Repeated like ?location=. The enums bound them, so no cap is needed.
    workplace: list[work_style] = Query([]),
    experience: list[experience_level] = Query([]),
    posted: PostedWithin | None = None,
    db: AsyncSession = Depends(get_session),
) -> list[JobListing]:
    """Newest roles first. Empty until the first import has run."""
    return await fetch_listings(db, limit, location, workplace, experience, posted)


@router.get("/locations", response_model=list[JobLocationOption])
async def list_locations(db: AsyncSession = Depends(get_session)) -> list[JobLocationOption]:
    """The places GET /jobs?location= can narrow to: only those with a job."""
    return await fetch_location_options(db)
