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
A signed-in applicant's token is still read when sent: GET /jobs, /jobs/count
and /jobs/recommended then leave out the jobs that applicant marked as applied
(job_applications, routers/applications.py). Without a token, or with one
that isn't an applicant's, every job is listed (get_signed_in_applicant_id).

This file is the HTTP layer only: the routes, their query parameters and
read_filters, which turns those into JobFilters. What each filter matches
and how the database is asked live in app/queries/jobs/ (filters.py has the
rules below in full); the pure word and season parsing in app/services/
(search_facts.py, start_terms.py).

?location= narrows the feed to jobs offered in any of the places named, by
their job_locations rows: a country code ("US") matches every job in that
country, a state code ("US-CA") its state. GET /jobs/locations lists the
places that have jobs, with names, for the job board's Location filter. A job
the location resolver couldn't place has no rows, so any location filter
leaves it out (models/CLAUDE.md, the resolver section), except a remote one:
a posting whose location is only "Remote" names no place to be in, so it
matches every place, and every place's count includes it (unplaced_remote).
Without that, Remote + United States hid 15 of the feed's 82 remote roles.

The job board's other filters narrow it the same way (JobFilters, KAN-170),
each by a column every scraped row fills when the posting states it:
?work_style=, ?role= (job_roles slugs, "software_engineer"; repeated, any
of: a job tagged in job_role_tags with any of them, KAN-155),
?job_type= and ?experience= (repeated, any of), ?posted_within=
(days), and ?min_pay= and ?max_pay= with ?pay_per= (hour or year), a range that
matches any posting whose own pay range overlaps it. Pay is compared as a yearly
figure, so an internship paid by the hour, week or month and a new-grad role
paid by the year meet one threshold: hourly x 2,080, weekly x 52, monthly x 12,
the same full-time year the frontend's options assume. A posting's top meets the
minimum and its bottom the maximum, and only US dollars compare: 88% of stated pay is USD,
and the rest can't be weighed against a dollar threshold without exchange
rates. A job that states no pay, or no value for a filtered column, is left out
by that filter, as one with no location is by ?location=.

?q= is a search: the companies, roles and facts it names, and every other
word in the job's text (queries/jobs/search.py has the four parts;
docs/search.md the design). A search orders nothing: results are newest
first, as the feed is. Ranking is the recommendations' job, not search's.
"""

import datetime
import uuid
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import StringConstraints
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import undefer

from app.db import get_session
from app.deps import (
    assert_applicant_owns,
    get_current_account,
    get_signed_in_applicant_id,
)
from app.models import dto
from app.models.dto import ParsedResume
from app.models.profiles import Applicant_Profile
from app.models.resume import Resume
from app.queries.jobs.facets import (
    fetch_facets,
    fetch_location_options,
    fetch_role_options,
)
from app.queries.jobs.filters import YEARLY, JobFilters
from app.queries.jobs.listings import fetch_count, fetch_listing, fetch_listings
from app.queries.jobs.recommendations import score_jobs
from app.queries.jobs.search import read_search, terms_in
from app.schemas.auth import AuthenticatedAccount
from app.schemas.jobs import (
    JobCount,
    JobFacets,
    JobListing,
    JobLocationOption,
    JobRoleOption,
    ScoredJob,
)

router = APIRouter(prefix="/jobs", tags=["jobs"])

# A Start Date option: "summer-2027", or a year, "2027".
SeasonKey = Annotated[
    str, StringConstraints(pattern=r"^((winter|spring|summer|fall)-)?20[0-9]{2}$")
]


# A country ("US") or a state ("US-CA"). Only the shape is checked: a code no
# job uses matches nothing, which is the right answer for it.
PlaceCode = Annotated[str, StringConstraints(pattern=r"^[A-Z]{2}(-[A-Z0-9]{1,3})?$")]

# A job_roles slug ("software_engineer"). Only the shape is checked, as for a
# place: a slug no job is tagged with matches nothing. The seed's
# job_roles_slug_shape CHECK holds the same pattern, capped here.
RoleSlug = Annotated[str, StringConstraints(pattern=r"^[a-z][a-z0-9_]{0,63}$")]

# ?job_type=: the column's three, plus "internship" (see JobFilters.job_types).
JobTypeKey = Literal["full_time", "part_time", "contract", "internship"]


async def read_filters(
    # Repeated for several: ?location=US-CA&location=US-NY. Capped so a URL
    # can't turn into a thousand-clause query.
    location: list[PlaceCode] = Query([], max_length=60),
    # The rest of the filter row; each repeated for several, any of them.
    work_style: list[dto.work_style] = Query([], max_length=3),
    # job_roles slugs: "software_engineer" (KAN-155). Capped like ?location=.
    role: list[RoleSlug] = Query([], max_length=60),
    experience: list[Literal["internship", "new_grad"]] = Query([], max_length=2),
    job_type: list[JobTypeKey] = Query([], max_length=4),
    # Days back from now: 1, 7 or 30 from the board, any whole number here.
    posted_within: int | None = Query(None, ge=1, le=365),
    # A pay range in US dollars, per `pay_per`; either end may be left open.
    # Capped at a figure no posting reaches.
    min_pay: float | None = Query(None, gt=0, le=10_000_000),
    max_pay: float | None = Query(None, gt=0, le=10_000_000),
    pay_per: Literal["hour", "year"] = "year",
    # Seasons as GET /jobs/facets lists them ("summer-2027", or "2027"); any.
    start_term: list[SeasonKey] = Query([], max_length=12),
    visa: Literal["sponsors", "not_ruled_out"] | None = None,
    # /search's words, read by the role resolver (JobFilters.query_roles).
    q: str | None = Query(None, max_length=200),
    applicant_id: uuid.UUID | None = Depends(get_signed_in_applicant_id),
    db: AsyncSession = Depends(get_session),
) -> JobFilters:
    '''
    the job board's filters from the query, shared by GET /jobs and GET
    /jobs/count so a count always describes the list it stands for
    '''
    # A range given backwards is still the range meant, as the frontend reads it.
    if min_pay is not None and max_pay is not None and min_pay > max_pay:
        min_pay, max_pay = max_pay, min_pay
    search = await read_search(db, q)
    return JobFilters(
        places=location,
        work_styles=work_style,
        roles=role,
        levels=experience,
        job_types=job_type,
        posted_since=(
            datetime.datetime.now(datetime.UTC) - datetime.timedelta(days=posted_within)
            if posted_within is not None
            else None
        ),
        min_yearly_pay=(
            min_pay * YEARLY[dto.salary_period(pay_per)] if min_pay is not None else None
        ),
        max_yearly_pay=(
            max_pay * YEARLY[dto.salary_period(pay_per)] if max_pay is not None else None
        ),
        # The seasons as the raw terms postings use, so the query stays a
        # plain IN. A season no posting names matches nothing, as it should.
        start_terms=(await terms_in(db, start_term)) if start_term else None,
        visa=visa,
        query_companies=search.companies,
        query_roles=search.roles,
        query_role_words=search.role_words,
        query_levels=search.levels,
        query_work_styles=search.work_styles,
        query_start_terms=(
            await terms_in(db, search.seasons) if search.seasons else None
        ),
        query_start_phrases=search.season_phrases,
        query_work_style_phrases=search.remote_phrases,
        query_words=search.words,
        applied_by=applicant_id,
    )


@router.get(
    "",
    response_model=list[JobListing],
    response_model_exclude={"__all__": {"description"}},
)
async def list_jobs(
    limit: int = Query(50, ge=1, le=500),
    # How many to skip: the job board's Load More asks for the next page
    # from where its list ends. An offset rather than a cursor, since an
    # import landing between pages can only repeat a job, which the board
    # drops by id, or skip one it shows next visit.
    offset: int = Query(0, ge=0, le=100_000),
    filters: JobFilters = Depends(read_filters),
    db: AsyncSession = Depends(get_session),
) -> list[JobListing]:
    """Newest roles first. Empty until the first import has run."""
    return await fetch_listings(db, limit, filters, offset)


@router.get("/count", response_model=JobCount)
async def count_jobs(
    filters: JobFilters = Depends(read_filters),
    db: AsyncSession = Depends(get_session),
) -> JobCount:
    """How many jobs GET /jobs would list for the same filters, uncapped: the
    All Filters panel's "Show 128 jobs"."""
    return JobCount(jobs=await fetch_count(db, filters))


@router.get("/roles", response_model=list[JobRoleOption])
async def list_roles(db: AsyncSession = Depends(get_session)) -> list[JobRoleOption]:
    """Every job_roles role, in its sort_order, with its job count, those with
    none included: what onboarding offers. The Role filter reads the ones with
    jobs from GET /jobs/facets."""
    return await fetch_role_options(db, with_jobs_only=False)


@router.get("/locations", response_model=list[JobLocationOption])
async def list_locations(db: AsyncSession = Depends(get_session)) -> list[JobLocationOption]:
    """The places GET /jobs?location= can narrow to: only those with a job."""
    return await fetch_location_options(db)


@router.get("/facets", response_model=JobFacets)
async def list_facets(db: AsyncSession = Depends(get_session)) -> JobFacets:
    """Each filter option's job count, for the job board's filter row."""
    return await fetch_facets(db)


@router.get("/recommended/{applicant_id}", response_model=list[ScoredJob])
async def recommended_jobs(
    applicant_id: uuid.UUID,
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0, le=100_000),
    filters: JobFilters = Depends(read_filters),
    account: AuthenticatedAccount = Depends(get_current_account),
    db: AsyncSession = Depends(get_session),
) -> list[ScoredJob]:
    """Jobs scored against the applicant's default resume. Returns `match`
    (0-100) and up to 3 `highlights`. Jobs without embeddings still appear,
    scored on other components. Includes score_breakdown with effective weights,
    component points before freshness, and the final rounded score."""
    assert_applicant_owns(account, applicant_id)

    # Load the default resume
    profile = await db.get(Applicant_Profile, applicant_id)
    if profile is None or profile.default_resume_id is None:
        raise HTTPException(404, "No default resume set")

    resume_row = (await db.execute(
        select(Resume).where(Resume.id == profile.default_resume_id)
        .options(undefer(Resume.embedding))
    )).scalar_one_or_none()
    if resume_row is None or resume_row.parsed_json is None:
        raise HTTPException(404, "Resume not found or not parsed")

    parsed = ParsedResume.model_validate(resume_row.parsed_json)

    scored = await score_jobs(db, resume_row, parsed, filters)
    return scored[offset:offset + limit]


# Last, so the paths above ("/count", "/facets", "/locations", "/roles") are matched as
# themselves before this one reads them as an id.
@router.get("/{job_id}", response_model=JobListing)
async def get_job(job_id: str, db: AsyncSession = Depends(get_session)) -> JobListing:
    """One published scraped job, with its description, for the job's own page
    (/jobs/[jobId]). 404 for one that closed, a company's own, or no job at all,
    which a seeker can't apply to either way."""
    job = await fetch_listing(db, job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="That job isn't open any more.")
    return job
