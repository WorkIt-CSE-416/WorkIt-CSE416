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
leaves it out (models/CLAUDE.md, the resolver section), except a remote one:
a posting whose location is only "Remote" names no place to be in, so it
matches every place, and every place's count includes it (unplaced_remote).
Without that, Remote + United States hid 15 of the feed's 82 remote roles.

The job board's other filters narrow it the same way (JobFilters, KAN-170),
each by a column every scraped row fills when the posting states it:
?work_style=, ?role= (the discipline: software, data_ai, product, quant or
hardware), ?job_type= and ?experience= (repeated, any of), ?posted_within=
(days), and ?min_pay= and ?max_pay= with ?pay_per= (hour or year), a range that
matches any posting whose own pay range overlaps it. Pay is compared as a yearly
figure, so an internship paid by the hour, week or month and a new-grad role
paid by the year meet one threshold: hourly x 2,080, weekly x 52, monthly x 12,
the same full-time year the frontend's options assume. A posting's top meets the
minimum and its bottom the maximum, and only US dollars compare: 88% of stated pay is USD,
and the rest can't be weighed against a dollar threshold without exchange
rates. A job that states no pay, or no value for a filtered column, is left out
by that filter, as one with no location is by ?location=.

Descriptions are left out of the list: the cards never show them, and at
several thousand characters each they would make every feed load many times
heavier — so the query doesn't read them either. fetch_listing does, for Scout
and for GET /jobs/{job_id}, the job's own page.
"""

import datetime
import uuid
from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import StringConstraints
from sqlalchemy import (
    ColumnElement,
    Row,
    and_,
    case,
    distinct,
    exists,
    func,
    or_,
    select,
)
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_session
from app.models import dto
from app.models.dto import job_post_status
from app.models.jobs import Job_Location, Job_Post
from app.models.locations import Country, State
from app.schemas.jobs import (
    FacetCount,
    JobCount,
    JobFacets,
    JobListing,
    JobLocationOption,
)

router = APIRouter(prefix="/jobs", tags=["jobs"])

_COLUMNS = (
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
    Job_Post.job_type,
    Job_Post.min_years_experience,
    Job_Post.start_term,
    Job_Post.sponsorship,
    Job_Post.role_category,
    Job_Post.salary,
    Job_Post.salary_min,
    Job_Post.salary_max,
    Job_Post.salary_currency,
    Job_Post.salary_period,
)

_LISTED = and_(Job_Post.company_id.is_(None), Job_Post.status == job_post_status.published)

# A Start Date option: "summer-2027", or a year, "2027".
SeasonKey = Annotated[
    str, StringConstraints(pattern=r"^((winter|spring|summer|fall)-)?20[0-9]{2}$")
]


# A country ("US") or a state ("US-CA"). Only the shape is checked: a code no
# job uses matches nothing, which is the right answer for it.
PlaceCode = Annotated[str, StringConstraints(pattern=r"^[A-Z]{2}(-[A-Z0-9]{1,3})?$")]

# The catch-all country for places outside the seed (models/CLAUDE.md), named
# "Other". It goes last, and its placeholder state ZZ-ZZ is never listed.
_OTHER = "ZZ"


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
        location_label=row.location_label,
        posted_at=row.posted_at.isoformat() if row.posted_at else None,
        logo_url=row.company_logo_url,
        description=description,
        job_type=row.job_type,
        min_years_experience=row.min_years_experience,
        start_term=row.start_term,
        sponsorship=row.sponsorship,
        role_category=row.role_category,
        salary=row.salary,
        salary_min=row.salary_min,
        salary_max=row.salary_max,
        # NOT NULL with defaults, so they mean something only beside an amount.
        salary_currency=row.salary_currency if paid else None,
        salary_period=row.salary_period if paid else None,
    )


def unplaced_remote() -> ColumnElement[bool]:
    '''
    true for a remote job with no job_locations rows: its posting says only
    "Remote" or "Work Remotely", which the resolver reads as no place. It
    names nowhere it must be done from, so a location filter keeps it.
    models/CLAUDE.md once filed these under ZZ, but that would have put them
    beside the roles in Peru and Colombia, hidden from Remote + United States
    all the same
    '''
    return and_(
        Job_Post.work_style == dto.work_style.remote,
        ~exists().where(Job_Location.job_id == Job_Post.id),
    )


def offered_in(places: Iterable[str]):
    '''
    true for a job with a job_locations row in any of these places, or a
    remote one that names no place (unplaced_remote). A state code is matched
    with its country too, so job_locations_place_idx, which leads with
    country, serves it
    '''
    clauses = [
        and_(Job_Location.country == code[:2], Job_Location.state == code)
        if "-" in code
        else Job_Location.country == code
        for code in places
    ]
    return or_(
        exists().where(Job_Location.job_id == Job_Post.id, or_(*clauses)),
        unplaced_remote(),
    )


# A full-time year: the factor that turns each pay period into a yearly figure.
# Whole numbers, so a threshold and a posting's pay compare exactly.
YEARLY = {
    dto.salary_period.hour: 2080,
    dto.salary_period.week: 52,
    dto.salary_period.month: 12,
    dto.salary_period.year: 1,
}


@dataclass(frozen=True)
class JobFilters:
    '''
    what the job board's filter row asked for. An empty field doesn't filter;
    several values in one field mean any of them
    '''
    places: Sequence[str] = ()
    work_styles: Sequence[dto.work_style] = ()
    # The disciplines asked for (KAN-171); none means every one.
    roles: Sequence[dto.role_category] = ()
    levels: Sequence[str] = ()
    # "internship" is every internship, whatever its hours: the Jobs page shows
    # that as an internship's job type, so full_time and the rest match only
    # the roles that aren't internships (KAN-171).
    job_types: Sequence[str] = ()
    posted_since: datetime.datetime | None = None
    # Yearly figures in US dollars: ?min_pay=45&pay_per=hour is 93,600. A
    # posting matches when its pay range overlaps this one.
    min_yearly_pay: float | None = None
    max_yearly_pay: float | None = None
    # The start terms postings name ("Summer 2027") for the seasons asked for.
    # None: any start date. Empty: seasons were asked for that no posting
    # names, which matches nothing (never a placeholder value: Postgres
    # refuses some, as a NUL byte once proved with a 500).
    start_terms: Sequence[str] | None = None
    # "sponsors": the posting says it sponsors visas. "not_ruled_out": hide a
    # posting that says it doesn't, or wants US citizens only, and keep the
    # ones that say nothing, which is most of them (KAN-168).
    visa: Literal["sponsors", "not_ruled_out"] | None = None
    # /search's words, matched in the title or the company's name, ignoring
    # case. On the server, so a search reaches every job and not only the
    # page of them the feed has loaded.
    query: str | None = None


# ?job_type=: the column's three, plus "internship" (see JobFilters.job_types).
JobTypeKey = Literal["full_time", "part_time", "contract", "internship"]

_INTERNSHIP = Job_Post.experience_level == dto.experience_level.internship


def job_type_matches(job_types: Sequence[str]) -> ColumnElement[bool]:
    '''
    a job of any of these types, as the Jobs page shows them: "internship" is
    every internship, and full_time, part_time and contract are those types
    among the jobs that aren't internships (an internship states its hours, if
    at all, in a field the page doesn't show)
    '''
    either: list[ColumnElement[bool]] = []
    if "internship" in job_types:
        either.append(_INTERNSHIP)
    kinds = [t for t in job_types if t != "internship"]
    if kinds:
        either.append(and_(~_INTERNSHIP, Job_Post.job_type.in_(kinds)))
    return or_(*either)


def yearly_pay(end: Literal["top", "bottom"] = "top") -> ColumnElement[float]:
    '''
    one end of a posting's pay range as a yearly figure, times its period's
    factor: the top (or its one amount, or its floor when it gives only that),
    or the bottom the same way round
    '''
    amount = (
        func.coalesce(Job_Post.salary_max, Job_Post.salary, Job_Post.salary_min)
        if end == "top"
        else func.coalesce(Job_Post.salary_min, Job_Post.salary, Job_Post.salary_max)
    )
    factor = case(
        *((Job_Post.salary_period == period, n) for period, n in YEARLY.items()),
        else_=None,
    )
    return amount * factor


def matching(filters: JobFilters) -> list[ColumnElement[bool]]:
    '''
    the WHERE clauses for these filters, beyond published and scraped
    '''
    clauses: list[ColumnElement[bool]] = []
    if filters.places:
        clauses.append(offered_in(filters.places))
    if filters.work_styles:
        clauses.append(Job_Post.work_style.in_(filters.work_styles))
    if filters.roles:
        clauses.append(Job_Post.role_category.in_(filters.roles))
    if filters.levels:
        clauses.append(Job_Post.experience_level.in_(filters.levels))
    if filters.job_types:
        clauses.append(job_type_matches(filters.job_types))
    if filters.posted_since is not None:
        clauses.append(Job_Post.posted_at >= filters.posted_since)
    if filters.min_yearly_pay is not None or filters.max_yearly_pay is not None:
        clauses.append(Job_Post.salary_currency == "USD")
    # Ranges overlap: the posting can pay at least the minimum (its top reaches
    # it) and starts at or under the maximum (its bottom is within it).
    if filters.min_yearly_pay is not None:
        clauses.append(yearly_pay("top") >= filters.min_yearly_pay)
    if filters.max_yearly_pay is not None:
        clauses.append(yearly_pay("bottom") <= filters.max_yearly_pay)
    if filters.start_terms is not None:
        # An empty list renders as an always-false IN.
        clauses.append(Job_Post.start_term.in_(filters.start_terms))
    if filters.query:
        clauses.append(
            or_(
                Job_Post.title.icontains(filters.query, autoescape=True),
                Job_Post.company_name.icontains(filters.query, autoescape=True),
            )
        )
    if filters.visa == "sponsors":
        clauses.append(Job_Post.sponsorship == dto.visa_sponsorship.sponsors)
    elif filters.visa == "not_ruled_out":
        clauses.append(
            or_(
                Job_Post.sponsorship.is_(None),
                Job_Post.sponsorship == dto.visa_sponsorship.sponsors,
            )
        )
    return clauses


async def fetch_listings(
    db: AsyncSession, limit: int, filters: JobFilters = JobFilters(), offset: int = 0
) -> list[JobListing]:
    '''
    the newest published scraped jobs, by when their board says they went up,
    narrowed by whatever `filters` asks for, `offset` of them in
    '''
    query = select(*_COLUMNS).where(_LISTED, *matching(filters))
    rows = await db.execute(
        # id breaks ties, so the order is the same on every request and a
        # page picks up exactly where the last one stopped.
        query.order_by(Job_Post.posted_at.desc().nulls_last(), Job_Post.id)
        .offset(offset)
        .limit(limit)
    )
    return [to_listing(row) for row in rows]


def location_options(
    countries: Iterable[Row], states: Iterable[Row], anywhere: int = 0
) -> list[JobLocationOption]:
    '''
    each country, busiest first, followed by its states A to Z; the catch-all
    country last, without its placeholder state. A state is labelled with its
    own name: the job board lists it under its country. `countries` rows are
    (code, name, jobs) and `states` rows (code, country, name, jobs).
    `anywhere` (the unplaced remote jobs, which every place matches) is added
    to each count, so a count is what picking that place shows
    '''
    by_country: dict[str, list[Row]] = {}
    for state in states:
        by_country.setdefault(state.country, []).append(state)

    options = []
    for country in sorted(countries, key=lambda c: (c.code == _OTHER, -c.jobs, c.name)):
        options.append(
            JobLocationOption(code=country.code, label=country.name, jobs=country.jobs + anywhere)
        )
        if country.code == _OTHER:
            continue
        for state in sorted(by_country.get(country.code, []), key=lambda s: s.name):
            options.append(
                JobLocationOption(code=state.code, label=state.name, jobs=state.jobs + anywhere)
            )
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
    anywhere = await db.scalar(
        select(func.count()).select_from(Job_Post).where(_LISTED, unplaced_remote())
    )
    return location_options(countries.all(), states.all(), anywhere or 0)


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


async def read_filters(
    # Repeated for several: ?location=US-CA&location=US-NY. Capped so a URL
    # can't turn into a thousand-clause query.
    location: list[PlaceCode] = Query([], max_length=60),
    # The rest of the filter row; each repeated for several, any of them.
    work_style: list[dto.work_style] = Query([], max_length=3),
    role: list[dto.role_category] = Query([], max_length=5),
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
    # /search's words. A % or _ in them is matched as itself.
    q: str | None = Query(None, max_length=200),
    db: AsyncSession = Depends(get_session),
) -> JobFilters:
    '''
    the job board's filters from the query, shared by GET /jobs and GET
    /jobs/count so a count always describes the list it stands for
    '''
    # A range given backwards is still the range meant, as the frontend reads it.
    if min_pay is not None and max_pay is not None and min_pay > max_pay:
        min_pay, max_pay = max_pay, min_pay
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
        query=(q or "").strip() or None,
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


async def fetch_count(db: AsyncSession, filters: JobFilters) -> int:
    '''how many published scraped jobs these filters keep, past any limit'''
    return (await db.execute(
        select(func.count()).select_from(Job_Post).where(_LISTED, *matching(filters))
    )).scalar_one()


@router.get("/count", response_model=JobCount)
async def count_jobs(
    filters: JobFilters = Depends(read_filters),
    db: AsyncSession = Depends(get_session),
) -> JobCount:
    """How many jobs GET /jobs would list for the same filters, uncapped: the
    All Filters panel's "Show 128 jobs"."""
    return JobCount(jobs=await fetch_count(db, filters))


@router.get("/locations", response_model=list[JobLocationOption])
async def list_locations(db: AsyncSession = Depends(get_session)) -> list[JobLocationOption]:
    """The places GET /jobs?location= can narrow to: only those with a job."""
    return await fetch_location_options(db)


# A posting's start term ("Summer 2027", "January 2027", "2027") as the season a
# student plans around, for the Start Date filter: 32 different spellings in
# the feed on 2026-10-09 come down to a handful of seasons. A month joins the
# season it falls in, December the next year's Winter; a bare year is its own
# option ("2027", season not stated). A term naming no year ("Summer") is in
# no season: the scraper doesn't guess one, and neither does this.
_MONTH = {
    "january": 1, "february": 2, "march": 3, "april": 4, "may": 5, "june": 6,
    "july": 7, "august": 8, "september": 9, "october": 10, "november": 11,
    "december": 12,
}
_SEASONS = ("winter", "spring", "summer", "fall")
# The season a month falls in, and the month each season starts.
_SEASON_OF_MONTH = {1: "winter", 2: "winter", 3: "spring", 4: "spring", 5: "spring",
                    6: "summer", 7: "summer", 8: "summer", 9: "fall", 10: "fall",
                    11: "fall", 12: "winter"}
_SEASON_START = {"winter": 1, "spring": 3, "summer": 6, "fall": 9}
_SEASON_END = {"winter": 3, "spring": 6, "summer": 9, "fall": 12}


def season_of(term: str) -> str | None:
    '''
    the Start Date option a term belongs to: "summer-2027", or "2027" for a year
    with no season, or None for a term naming no year
    '''
    words = term.lower().replace("autumn", "fall").split()
    years = [int(w) for w in words if w.isdigit() and len(w) == 4]
    if not years:
        return None
    year = years[0]
    season = next((w for w in words if w in _SEASONS), None)
    if season is None:
        month = next((_MONTH[w] for w in words if w in _MONTH), None)
        if month is None:
            return str(year)
        season = _SEASON_OF_MONTH[month]
        if month == 12:
            year += 1
    return f"{season}-{year}"


def season_order(key: str) -> tuple[int, int]:
    '''calendar order, a bare year before its seasons'''
    if "-" not in key:
        return (int(key), 0)
    season, year = key.split("-")
    return (int(year), _SEASON_START[season])


def season_is_over(key: str, today: datetime.date) -> bool:
    '''
    true once a season has ended: an option for it would only find postings
    whose start date has passed. A bare year lasts to its end
    '''
    if "-" not in key:
        return int(key) < today.year
    season, year = key.split("-")
    # Each season ends where the next starts: winter (from January here, its
    # December counted as the year before) at spring's March, fall at December.
    end = datetime.date(int(year), _SEASON_END[season], 1)
    return end <= today


async def terms_in(db: AsyncSession, seasons: Sequence[str]) -> list[str]:
    '''the start terms postings use that fall in any of these seasons'''
    terms = (await db.execute(
        select(distinct(Job_Post.start_term)).where(_LISTED, Job_Post.start_term.is_not(None))
    )).scalars()
    wanted = set(seasons)
    return [t for t in terms if season_of(t) in wanted]


async def fetch_facets(db: AsyncSession) -> JobFacets:
    '''
    how many published scraped jobs each filter option holds, across the whole
    feed (not narrowed by the other filters), so the filter row can show a
    count beside every option
    '''
    async def by(column, *where: ColumnElement[bool]) -> list[FacetCount]:
        rows = await db.execute(
            select(column, func.count())
            .where(_LISTED, column.is_not(None), *where)
            .group_by(column)
        )
        return [FacetCount(value=str(value), jobs=n) for value, n in rows]

    now = datetime.datetime.now(datetime.UTC)
    posted = (await db.execute(
        select(*(
            func.count().filter(Job_Post.posted_at >= now - datetime.timedelta(days=d))
            for d in (1, 7, 30)
        )).where(_LISTED)
    )).one()
    sponsors, not_ruled_out = (await db.execute(
        select(
            func.count().filter(Job_Post.sponsorship == dto.visa_sponsorship.sponsors),
            func.count().filter(or_(
                Job_Post.sponsorship.is_(None),
                Job_Post.sponsorship == dto.visa_sponsorship.sponsors,
            )),
        ).where(_LISTED)
    )).one()
    return JobFacets(
        work_style=await by(Job_Post.work_style),
        role=await by(Job_Post.role_category),
        experience=await by(Job_Post.experience_level),
        # As the page shows them: internships count under "internship" alone.
        job_type=[
            *await by(Job_Post.job_type, ~_INTERNSHIP),
            *[f for f in await by(Job_Post.experience_level) if f.value == "internship"],
        ],
        posted_within=[FacetCount(value=str(d), jobs=n) for d, n in zip((1, 7, 30), posted)],
        visa=[
            FacetCount(value="sponsors", jobs=sponsors),
            FacetCount(value="not_ruled_out", jobs=not_ruled_out),
        ],
        start_term=_season_counts(await by(Job_Post.start_term), now.date()),
    )


def _season_counts(terms: list[FacetCount], today: datetime.date) -> list[FacetCount]:
    '''per-term counts summed into the seasons that haven't ended, in order'''
    totals: dict[str, int] = {}
    for term in terms:
        key = season_of(term.value)
        if key is not None and not season_is_over(key, today):
            totals[key] = totals.get(key, 0) + term.jobs
    return [FacetCount(value=k, jobs=totals[k]) for k in sorted(totals, key=season_order)]


@router.get("/facets", response_model=JobFacets)
async def list_facets(db: AsyncSession = Depends(get_session)) -> JobFacets:
    """Each filter option's job count, for the job board's filter row."""
    return await fetch_facets(db)


# Last, so the paths above ("/count", "/facets", "/locations") are matched as
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
