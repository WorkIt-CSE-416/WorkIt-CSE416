"""
The job board's filters as WHERE clauses: JobFilters is what a request asked
for (routers/jobs.py read_filters builds it), and matching() turns it into
clauses over job_postings. Every query that lists, counts or scores the feed
narrows by LISTED and matching(), so a count always describes its list.

?location= matches a job by its job_locations rows: a country code ("US")
every job in that country, a state code ("US-CA") its state. A job the
location resolver couldn't place has no rows, so any location filter leaves
it out (models/CLAUDE.md, the resolver section), except a remote one: a
posting whose location is only "Remote" names no place to be in, so it
matches every place, and every place's count includes it (unplaced_remote).
Without that, Remote + United States hid 15 of the feed's 82 remote roles.

Pay is compared as a yearly figure, so an internship paid by the hour, week
or month and a new-grad role paid by the year meet one threshold: hourly x
2,080, weekly x 52, monthly x 12, the same full-time year the frontend's
options assume. A posting's top meets the minimum and its bottom the maximum,
and only US dollars compare: 88% of stated pay is USD, and the rest can't be
weighed against a dollar threshold without exchange rates. A job that states
no pay, or no value for a filtered column, is left out by that filter, as one
with no location is by ?location=.

A signed-in applicant's applied jobs (job_applications, KAN-232) are left
out by applied_by; auto apply's matches leave out every job the applicant has
an application for at any stage, queued or skipped too, by
no_application_by.
"""

import datetime
import uuid
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass, field
from typing import Literal

from sqlalchemy import ColumnElement, and_, case, exists, func, literal_column, or_

from app.models import dto
from app.models.applications import Job_Application
from app.models.job_roles import Job_Role_Tag
from app.models.jobs import Job_Location, Job_Post
from app.queries.jobs.legacy_levels import IS_INTERNSHIP, stored_levels
from app.services.location_resolver import Place
from app.services.postings import LISTED  # noqa: F401 (re-export)
from app.services.role_resolver import title_pattern


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
        and_(Job_Location.country == p.country, Job_Location.state == p.state)
        if p.state
        else Job_Location.country == p.country
        for p in map(Place.from_code, places)
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
    # "internship" is a job type of its own (KAN-233); job_type_matches reads
    # the rows an older import wrote as the level too, until migration B.
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
    # The companies a search names, as job_postings holds them; a job at any
    # of them matches (a job has one company, so two named means either).
    query_companies: Sequence[str] = ()
    query_roles: Sequence[str] = ()
    # Each of query_roles, the phrases that named it (read_query's said): a
    # title saying all of them matches beside the tag. A role absent here is
    # the tag alone.
    query_role_words: Mapping[str, Sequence[Sequence[str]]] = field(default_factory=dict)
    query_levels: Sequence[str] = ()
    query_work_styles: Sequence[dto.work_style] = ()
    # The start terms postings name for the season or year searched for, as
    # start_terms above; None when the search named none.
    query_start_terms: Sequence[str] | None = None
    # The season or year as typed ("fall 2027", "2027"), which a title saying
    # it matches too, so a job whose start term is only in its title is found.
    query_start_phrases: Sequence[str] = ()
    # "remote" as typed, when searched for: a title saying it matches beside
    # the work_style column. Hybrid and onsite are the column alone.
    query_work_style_phrases: Sequence[str] = ()
    query_words: Sequence[str] = ()
    # The signed-in applicant: the jobs they marked as applied are left out.
    # A job they only queued for auto apply stays in. None (signed out)
    # lists them all.
    applied_by: uuid.UUID | None = None
    # Auto apply's matches (auto_apply/pipeline.py): every job this applicant
    # has an application for, at any stage, is left out, so a new batch
    # never queues a job twice or one they skipped.
    no_application_by: uuid.UUID | None = None


def job_type_matches(job_types: Sequence[str]) -> ColumnElement[bool]:
    '''
    a job of any of these types. "internship" is a job type of its own
    (KAN-233); until migration B moves the rows that still state it as an
    experience level, IS_INTERNSHIP reads both spellings, and full_time and
    the rest leave such a row out as they always have (an old internship's
    stated hours aren't its job type)
    '''
    either: list[ColumnElement[bool]] = []
    if "internship" in job_types:
        either.append(IS_INTERNSHIP)
    kinds = [t for t in job_types if t != "internship"]
    if kinds:
        either.append(and_(~IS_INTERNSHIP, Job_Post.job_type.in_(kinds)))
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


def in_title(phrases: Iterable[str]) -> list[ColumnElement[bool]]:
    '''
    a clause per phrase, true for a title containing it, ignoring case: the
    raw match beside a search's start term and "remote". The title only, not
    the description: a description's "graduating in 2027" or "not remote" is
    no start or work style. No index, and none needed: it rides on the scan
    the column's own test already makes (about 0.2 ms over 1,096 jobs, 8 ms
    over 110,000, measured 2026-10-11)
    '''
    return [Job_Post.title.icontains(phrase, autoescape=True) for phrase in phrases]


def title_says(phrases: Sequence[Sequence[str]]) -> ColumnElement[bool]:
    '''
    true for a job whose title says each phrase, its words in order, as whole
    words in any spelling WORD_FORMS gives them (role_resolver.title_pattern):
    "software engineer" finds "Embedded Software Engineering". The title
    only, as in_title: a description's "work with our software engineers" is
    no software job. No index, like in_title: about 1.3 µs a title per
    one-word phrase (3 ms over 3,600 jobs, 140 ms over 108,000; 2026-10-13)
    '''
    return and_(*(Job_Post.title.regexp_match(title_pattern(p), flags="i") for p in phrases))


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
        clauses.append(Job_Post.experience_level.in_(stored_levels(filters.levels)))
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
    if filters.query_companies:
        clauses.append(Job_Post.company_name.in_(filters.query_companies))
    # Each role a search names narrows on its own: "ml software" is jobs
    # with both, unlike the Role filter's any of. A role is its tag or its
    # words in the title: the longest alias wins a title's words, so
    # "Embedded Software Engineer" is tagged embedded_engineer only, and a
    # search for "software" would miss it on the tag alone.
    for slug in filters.query_roles:
        said = filters.query_role_words.get(slug)
        clauses.append(or_(tagged_with([slug]), title_says(said)) if said else tagged_with([slug]))
    if filters.query_levels:
        clauses.append(Job_Post.experience_level.in_(stored_levels(filters.query_levels)))
    if filters.query_work_styles:
        clauses.append(or_(
            Job_Post.work_style.in_(filters.query_work_styles),
            *in_title(filters.query_work_style_phrases),
        ))
    if filters.query_start_terms is not None:
        clauses.append(or_(
            Job_Post.start_term.in_(filters.query_start_terms),
            *in_title(filters.query_start_phrases),
        ))
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
    if filters.applied_by is not None:
        clauses.append(~exists().where(
            Job_Application.job_id == Job_Post.id,
            Job_Application.applicant_id == filters.applied_by,
            Job_Application.stage == dto.application_stage.applied,
        ))
    if filters.no_application_by is not None:
        clauses.append(~exists().where(
            Job_Application.job_id == Job_Post.id,
            Job_Application.applicant_id == filters.no_application_by,
        ))
    return clauses
