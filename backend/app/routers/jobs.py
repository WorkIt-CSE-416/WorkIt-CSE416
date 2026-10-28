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

GET /jobs also enriches each listing with `match` and `highlights` when the
viewer is a signed-in applicant whose experience bank is non-empty, using the
same `score_jobs` path as GET /jobs/recommended. A scoring failure is logged
and swallowed: the feed still loads, just without scores.

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
?job_type= (internship among them, KAN-233) and ?experience= (new_grad,
experienced; repeated, any of: new_grad takes in the internships, whose
level is student, KAN-284), ?posted_within=
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

GET /jobs/search-facts?q= lists the facts a search's words name that the
filter row also offers (an experience level, a work style, a start term),
each with the search its words leave out: /search shows them beside the
row, so a filter the words set is never invisible (KAN-308).
"""

import datetime
import logging
import uuid
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_session
from app.deps import (
    assert_applicant_owns,
    get_current_account,
    get_signed_in_applicant,
    get_signed_in_applicant_id,
)
from app.models import dto
from app.queries.jobs import home
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
    HomeMatches,
    JobCount,
    JobFacets,
    JobListing,
    JobLocationOption,
    JobRoleOption,
    JobTypeKey,
    PlaceCode,
    RoleSlug,
    ScoredJob,
    SearchFact,
    SeasonKey,
)
from app.schemas.requirements import JobRequirement
from app.services import postings, requirements
from app.services.bank import load_bank
from app.services.search_facts import without_words

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/jobs", tags=["jobs"])


async def read_filters(
    # Repeated for several: ?location=US-CA&location=US-NY. Capped so a URL
    # can't turn into a thousand-clause query.
    location: list[PlaceCode] = Query([], max_length=60),
    # The rest of the filter row; each repeated for several, any of them.
    work_style: list[dto.work_style] = Query([], max_length=3),
    # job_roles slugs: "software_engineer" (KAN-155). Capped like ?location=.
    role: list[RoleSlug] = Query([], max_length=60),
    experience: list[Literal["student", "new_grad", "experienced"]] = Query([], max_length=3),
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
    visa: Literal["sponsors"] | None = None,
    # All Filters' "Auto Apply Supported": only job postings auto apply can
    # fill (every hiring system the Fill engine fills, app/auto_apply/hosts.py).
    auto_apply: bool = False,
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
        auto_apply_only=auto_apply,
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
    account: AuthenticatedAccount | None = Depends(get_signed_in_applicant),
    db: AsyncSession = Depends(get_session),
) -> list[JobListing]:
    """Newest roles first, with match scores when the viewer is a signed-in
    applicant with a non-empty experience bank. Empty until the first import
    has run."""
    listings = await fetch_listings(db, limit, filters, offset)
    if account is not None and listings:
        try:
            bank = await load_bank(db, account.id)
            if bank.entries or bank.skills:
                scored = await score_jobs(
                    db, account, bank,
                    JobFilters(job_ids=[uuid.UUID(j.id) for j in listings]),
                )
                by_id = {s.id: s for s in scored}
                for listing in listings:
                    hit = by_id.get(listing.id)
                    if hit is not None:
                        listing.match = hit.match
                        listing.highlights = hit.highlights
        except Exception:
            logger.exception("Scoring failed for applicant %s", account.id)
    return listings


@router.get("/count", response_model=JobCount)
async def count_jobs(
    filters: JobFilters = Depends(read_filters),
    db: AsyncSession = Depends(get_session),
) -> JobCount:
    """How many jobs GET /jobs would list for the same filters, uncapped: the
    All Filters panel's "Show 128 jobs"."""
    return JobCount(jobs=await fetch_count(db, filters))


@router.get("/search-facts", response_model=list[SearchFact])
async def search_facts(
    q: str = Query(max_length=200),
    db: AsyncSession = Depends(get_session),
) -> list[SearchFact]:
    """The filters a search's words set, in the order typed, each once: a
    fact named twice ("remote remote") is one, and dropping it drops both."""
    at: dict[tuple[str, str], list[int]] = {}
    for fact in (await read_search(db, q)).facts:
        at.setdefault((fact.facet, fact.value), []).extend(fact.at)
    return [
        SearchFact(facet=facet, value=value, without=without_words(q, places))
        for (facet, value), places in at.items()
    ]


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


class EmptyBank(Exception):
    """The applicant's experience bank has no entries and no skills: nothing
    to score against. The route answers 404 with this message."""


async def fetch_recommended(
    db: AsyncSession,
    account: AuthenticatedAccount,
    *,
    filters: JobFilters = JobFilters(),
    min_match: int = 0,
    limit: int = 50,
    offset: int = 0,
) -> list[ScoredJob]:
    '''
    the published scraped jobs scored against this applicant's experience bank
    (never an uploaded resume), best first, with `match` (0-100), its
    `score_breakdown` and up to 3 `highlights`. Raises EmptyBank.

    Checks no ownership: the caller has done that (the route, with
    assert_applicant_owns). Takes the account, not only its id, because the
    bank's embedding text reads its identity (load_identity). Auto apply
    calls this to find what to apply to (auto-apply/architecture.md, "Match
    (built)").

    `min_match` leaves out jobs scored below it before `offset`, so a page
    never comes back short with more matches behind it.
    '''
    bank = await load_bank(db, account.id)
    if not bank.entries and not bank.skills:
        raise EmptyBank("Your experience bank is empty")

    scored = await score_jobs(db, account, bank, filters)
    # score_jobs sorts best first; drop those under min_match before offset
    scored = [s for s in scored if s.match >= min_match]
    return scored[offset:offset + limit]


@router.get("/recommended/{applicant_id}", response_model=list[ScoredJob])
async def recommended_jobs(
    applicant_id: uuid.UUID,
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0, le=100_000),
    # Annotated, so a direct call (tests/test_recommended_jobs.py) gets 0, not a Query object
    min_match: Annotated[int, Query(ge=0, le=100)] = 0,
    filters: JobFilters = Depends(read_filters),
    account: AuthenticatedAccount = Depends(get_current_account),
    db: AsyncSession = Depends(get_session),
) -> list[ScoredJob]:
    """Jobs scored against the applicant's experience bank (fetch_recommended).
    Returns `match` (0-100), its `score_breakdown` (effective weights,
    component points before freshness, the final rounded score) and up to 3
    `highlights`. 404 while the bank is empty."""
    assert_applicant_owns(account, applicant_id)
    try:
        return await fetch_recommended(
            db, account, filters=filters, min_match=min_match, limit=limit, offset=offset
        )
    except EmptyBank as exc:
        raise HTTPException(404, str(exc)) from exc


@router.get("/recommended/{applicant_id}/home", response_model=HomeMatches)
async def recommended_home(
    applicant_id: uuid.UUID,
    # Strong Matches' window: Home sends its longest range's days.
    posted_within: int = Query(ge=1, le=365),
    min_match: int = Query(ge=0, le=100),
    limit: int = Query(12, ge=1, le=50),
    account: AuthenticatedAccount = Depends(get_current_account),
    db: AsyncSession = Depends(get_session),
) -> HomeMatches:
    """Home's matches from one scoring pass (queries/jobs/home.py): the
    best `limit`, the best `limit` auto apply can fill, and when each job
    posted within `posted_within` days scoring at least `min_match` went
    up. Served from the kept result while nothing it was made from has
    changed. 404 while the bank is empty."""
    assert_applicant_owns(account, applicant_id)
    key = (account.id, await home.home_version(db, account.id), posted_within, min_match, limit)
    if (hit := home.kept(key)) is not None:
        return hit
    bank = await load_bank(db, account.id)
    if not bank.entries and not bank.skills:
        raise HTTPException(404, "Your experience bank is empty")
    matches = await home.home_matches(
        db, account, bank, posted_within=posted_within, min_match=min_match, limit=limit
    )
    home.keep(key, matches)
    return matches


@router.get("/{job_id}/requirements", response_model=list[JobRequirement])
async def get_job_requirements(
    job_id: uuid.UUID,
    db: AsyncSession = Depends(get_session),
) -> list[JobRequirement]:
    """Public posting statements only; no applicant profile or comparison."""
    job = await postings.listed(db, job_id)
    if job is None:
        raise HTTPException(404, "That job isn't open any more.")
    return requirements.extract(job.description)


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
