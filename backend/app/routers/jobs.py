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

?q= is a search, read in three parts (read_search; docs/search.md):

1. the roles it names, by the same role resolver the import tags jobs with
   (services/role_resolver.py, read_query, typos corrected); a job must be
   tagged with each of them;
2. the facts it names that have columns (query_facts): "intern" is the
   internship experience level, "new grad" new_grad, "remote" / "hybrid" /
   "onsite" the work style, "summer 2027" or a bare "2027" the start term.
   Read from the whole query, so "marketing intern" is the marketing role
   and internships both. Like the filters they echo, each hides a job that
   doesn't state that fact (a start term most of all: about half state one);
3. every other word, each of which must be in the job's text (job_postings.
   fts) or its company's name: "stripe intern" is internships at Stripe or
   that mention it. A stop word ("at", "the") is passed over.

A search orders nothing: results are newest first, as the feed is. Ranking
is the recommendations' job, not search's.

Descriptions are left out of the list: the cards never show them, and at
several thousand characters each they would make every feed load many times
heavier — so the query doesn't read them either. fetch_listing does, for Scout
and for GET /jobs/{job_id}, the job's own page.
"""

import datetime
import re
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
    literal_column,
    or_,
    select,
)
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_session
from app.models import dto
from app.models.dto import job_post_status
from app.models.job_roles import Job_Role, Job_Role_Tag
from app.models.jobs import Job_Location, Job_Post
from app.models.locations import Country, State
from app.schemas.jobs import (
    FacetCount,
    JobCount,
    JobFacets,
    JobListing,
    JobLocationOption,
    JobRoleOption,
)
from app.services.role_resolver import RoleResolver, raw_words

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

# A job_roles slug ("software_engineer"). Only the shape is checked, as for a
# place: a slug no job is tagged with matches nothing. The seed's
# job_roles_slug_shape CHECK holds the same pattern, capped here.
RoleSlug = Annotated[str, StringConstraints(pattern=r"^[a-z][a-z0-9_]{0,63}$")]

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
    # The job_roles slugs the Role filter asked for; none means every role. A
    # job matches when it is tagged with any of them (job_role_tags).
    roles: Sequence[str] = ()
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
    # ?q= (read_search): the roles it names, each of which a job must be
    # tagged with; the facts it names, each narrowing on its own beside the
    # filters above (a search's "remote" and a ticked Hybrid make nothing);
    # and the other words, each of which must be in the job's text or its
    # company's name. On the server, so a search reaches every job and not
    # only the page of them the feed has loaded.
    query_roles: Sequence[str] = ()
    query_levels: Sequence[str] = ()
    query_work_styles: Sequence[dto.work_style] = ()
    # The start terms postings name for the season or year searched for, as
    # start_terms above; None when the search named none.
    query_start_terms: Sequence[str] | None = None
    query_words: Sequence[str] = ()


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


def tagged_with(slugs: Iterable[str]) -> ColumnElement[bool]:
    '''
    true for a job tagged with any of these job_roles slugs. The primary key
    (job_id, role_slug) serves it
    '''
    return exists().where(
        Job_Role_Tag.job_id == Job_Post.id, Job_Role_Tag.role_slug.in_(list(slugs))
    )


def word_matches(word: str) -> ColumnElement[bool]:
    '''
    true for a job whose text (title and description, fts, stemmed: "stripes"
    is "stripe") holds the word, or whose company's name contains it as
    typed. One word at a time, so "stripe intern" finds Stripe by its name
    even when its postings never say "intern" in a way the name could. A stop
    word ("at", "the") makes an empty query, numnode 0, and is passed over
    rather than matching nothing
    '''
    # The config written into the SQL, not bound: the parameter would have to
    # reach asyncpg as a regconfig, and a constant needs no such typing.
    query = func.plainto_tsquery(literal_column("'english'"), word)
    return or_(
        func.numnode(query) == 0,
        Job_Post.fts.bool_op("@@")(query),
        Job_Post.company_name.icontains(word, autoescape=True),
    )


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
        clauses.append(tagged_with(filters.roles))
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
    # Each role a search names narrows on its own: "ml software" is jobs
    # tagged with both, unlike the Role filter's any of.
    clauses.extend(tagged_with([slug]) for slug in filters.query_roles)
    if filters.query_levels:
        clauses.append(Job_Post.experience_level.in_(filters.query_levels))
    if filters.query_work_styles:
        clauses.append(Job_Post.work_style.in_(filters.query_work_styles))
    if filters.query_start_terms is not None:
        clauses.append(Job_Post.start_term.in_(filters.query_start_terms))
    clauses.extend(word_matches(word) for word in filters.query_words)
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


# Words in a search that name a fact a column holds, read as that column's
# filter rather than looked for in the text (query_facts). Each phrase is in
# words as raw_words splits them: "co-op" is "co op", "on-site" "on site".
_LEVEL_WORDS = {
    ("intern",): "internship", ("interns",): "internship",
    ("internship",): "internship", ("internships",): "internship",
    ("co", "op"): "internship", ("coop",): "internship", ("co", "ops"): "internship",
    ("new", "grad"): "new_grad", ("new", "grads"): "new_grad", ("newgrad",): "new_grad",
    ("new", "graduate"): "new_grad", ("new", "graduates"): "new_grad",
    ("early", "career"): "new_grad", ("entry", "level"): "new_grad",
}
_WORK_STYLE_WORDS = {
    ("remote",): dto.work_style.remote, ("hybrid",): dto.work_style.hybrid,
    ("onsite",): dto.work_style.onsite, ("on", "site"): dto.work_style.onsite,
    ("in", "person"): dto.work_style.onsite, ("in", "office"): dto.work_style.onsite,
}
_YEAR = re.compile(r"^20[2-3][0-9]$")


@dataclass(frozen=True)
class QueryFacts:
    '''the facts a search's words name, and the positions those words take'''
    levels: tuple[str, ...] = ()
    work_styles: tuple[dto.work_style, ...] = ()
    # Start Date keys: "summer-2027", or for a bare year every season of it
    # and the year itself ("2027": a posting naming the year alone).
    seasons: tuple[str, ...] = ()
    used: frozenset[int] = frozenset()


def query_facts(words: Sequence[str]) -> QueryFacts:
    '''
    the experience levels, work styles and start seasons these words name,
    longest phrase first: "summer 2027" is one season, and "2027" alone is
    any start in that year. A season with no year ("summer") is no season,
    as season_of reads one, and stays a word
    '''
    levels: list[str] = []
    styles: list[dto.work_style] = []
    seasons: list[str] = []
    used: set[int] = set()

    def take(phrase: tuple[str, ...]) -> bool:
        if phrase in _LEVEL_WORDS:
            levels.append(_LEVEL_WORDS[phrase])
        elif phrase in _WORK_STYLE_WORDS:
            styles.append(_WORK_STYLE_WORDS[phrase])
        elif len(phrase) == 2 and "-" in (season_of(" ".join(phrase)) or ""):
            seasons.append(season_of(" ".join(phrase)))
        elif len(phrase) == 1 and _YEAR.match(phrase[0]):
            seasons.extend([*(f"{season}-{phrase[0]}" for season in _SEASONS), phrase[0]])
        else:
            return False
        return True

    i = 0
    while i < len(words):
        span = next((n for n in (2, 1) if i + n <= len(words) and take(tuple(words[i:i + n]))), 0)
        used.update(range(i, i + span))
        i += span or 1
    return QueryFacts(
        tuple(dict.fromkeys(levels)), tuple(dict.fromkeys(styles)),
        tuple(dict.fromkeys(seasons)), frozenset(used),
    )


@dataclass(frozen=True)
class Search:
    '''?q= read: JobFilters' query_ fields, the start seasons still as keys'''
    roles: tuple[str, ...] = ()
    levels: tuple[str, ...] = ()
    work_styles: tuple[dto.work_style, ...] = ()
    seasons: tuple[str, ...] = ()
    words: tuple[str, ...] = ()


async def read_search(db: AsyncSession, q: str | None) -> Search:
    '''
    a search in its three parts (the module docstring): the roles the role
    resolver finds, the facts query_facts finds anywhere in the query (so a
    word a role's alias used, "marketing intern"'s "intern", still counts),
    and the words left once both have taken theirs
    '''
    text = (q or "").strip()
    if not text:
        return Search()
    read = (await role_resolver(db)).read_query(text)
    facts = query_facts(raw_words(text))
    # The words no role used, less the ones that named a fact.
    left = query_facts(read.rest).used
    return Search(
        roles=tuple(sorted(read.roles)),
        levels=facts.levels,
        work_styles=facts.work_styles,
        seasons=facts.seasons,
        words=tuple(w for i, w in enumerate(read.rest) if i not in left),
    )


# The resolver ?q= is read with, built from job_roles on first use and kept
# for the life of the process: the roles change only by a migration, and a
# deploy (a new process) follows one. Tests stand role_resolver in.
_resolver: RoleResolver | None = None


async def role_resolver(db: AsyncSession) -> RoleResolver:
    '''
    the role resolver for searches, over the roles the database holds, as the
    import builds its own
    '''
    global _resolver
    if _resolver is None:
        roles = {row.slug: row.name for row in await db.execute(select(Job_Role.slug, Job_Role.name))}
        _resolver = RoleResolver(roles)
    return _resolver


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
        query_roles=search.roles,
        query_levels=search.levels,
        query_work_styles=search.work_styles,
        query_start_terms=(
            await terms_in(db, search.seasons) if search.seasons else None
        ),
        query_words=search.words,
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


async def fetch_role_options(db: AsyncSession, *, with_jobs_only: bool) -> list[JobRoleOption]:
    '''
    the job_roles roles in their sort_order, each with how many published
    scraped jobs are tagged with it. `with_jobs_only` leaves out the roles no
    job has (the Role filter); without it every role is listed (onboarding)
    '''
    jobs = (
        select(Job_Role_Tag.role_slug, func.count().label("jobs"))
        .join(Job_Post, Job_Post.id == Job_Role_Tag.job_id)
        .where(_LISTED)
        .group_by(Job_Role_Tag.role_slug)
        .subquery()
    )
    query = (
        select(Job_Role.slug, Job_Role.name, func.coalesce(jobs.c.jobs, 0).label("jobs"))
        .outerjoin(jobs, jobs.c.role_slug == Job_Role.slug)
        .order_by(Job_Role.sort_order)
    )
    if with_jobs_only:
        query = query.where(jobs.c.jobs > 0)
    return [
        JobRoleOption(value=row.slug, label=row.name, jobs=row.jobs)
        for row in await db.execute(query)
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
        role=await fetch_role_options(db, with_jobs_only=True),
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
