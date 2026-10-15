"""
The filter row's options and counts: each option's job count across the
whole feed (fetch_facets), the roles (fetch_role_options) and the places
that have jobs (fetch_location_options).
"""

import datetime
from collections.abc import Iterable

from sqlalchemy import ColumnElement, Row, and_, distinct, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import dto
from app.models.job_roles import Job_Role, Job_Role_Tag
from app.models.jobs import Job_Location, Job_Post
from app.models.locations import Country, State
from app.queries.jobs.filters import INTERNSHIP, LISTED, unplaced_remote
from app.schemas.jobs import FacetCount, JobFacets, JobLocationOption, JobRoleOption
from app.services.start_terms import season_is_over, season_of, season_order

# The catch-all country for places outside the seed (models/CLAUDE.md), named
# "Other". It goes last, and its placeholder state ZZ-ZZ is never listed.
_OTHER = "ZZ"


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
    listed = and_(Job_Post.id == Job_Location.job_id, LISTED)
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
        select(func.count()).select_from(Job_Post).where(LISTED, unplaced_remote())
    )
    return location_options(countries.all(), states.all(), anywhere or 0)


async def fetch_role_options(db: AsyncSession, *, with_jobs_only: bool) -> list[JobRoleOption]:
    '''
    the job_roles roles in their sort_order, each with how many published
    scraped jobs are tagged with it. `with_jobs_only` leaves out the roles no
    job has (the Role filter); without it every role is listed (onboarding)
    '''
    jobs = (
        select(Job_Role_Tag.role_slug, func.count().label("jobs"))
        .join(Job_Post, Job_Post.id == Job_Role_Tag.job_id)
        .where(LISTED)
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


async def fetch_facets(db: AsyncSession) -> JobFacets:
    '''
    how many published scraped jobs each filter option holds, across the whole
    feed (not narrowed by the other filters), so the filter row can show a
    count beside every option
    '''
    async def by(column, *where: ColumnElement[bool]) -> list[FacetCount]:
        rows = await db.execute(
            select(column, func.count())
            .where(LISTED, column.is_not(None), *where)
            .group_by(column)
        )
        return [FacetCount(value=str(value), jobs=n) for value, n in rows]

    now = datetime.datetime.now(datetime.UTC)
    posted = (await db.execute(
        select(*(
            func.count().filter(Job_Post.posted_at >= now - datetime.timedelta(days=d))
            for d in (1, 7, 30)
        )).where(LISTED)
    )).one()
    sponsors, not_ruled_out = (await db.execute(
        select(
            func.count().filter(Job_Post.sponsorship == dto.visa_sponsorship.sponsors),
            func.count().filter(or_(
                Job_Post.sponsorship.is_(None),
                Job_Post.sponsorship == dto.visa_sponsorship.sponsors,
            )),
        ).where(LISTED)
    )).one()
    return JobFacets(
        work_style=await by(Job_Post.work_style),
        role=await fetch_role_options(db, with_jobs_only=True),
        experience=await by(Job_Post.experience_level),
        # As the page shows them: internships count under "internship" alone.
        job_type=[
            *await by(Job_Post.job_type, ~INTERNSHIP),
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
