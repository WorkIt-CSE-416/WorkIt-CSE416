"""
What a request names, read against the database: ?q= in its parts
(read_search) and the start terms postings use for a season (terms_in).

?q= is a search, read in four parts (docs/search.md):

0. the companies it names, by whole name ("jump trading"), before anything
   else so a name keeps its words; a typo in what the other parts leave is
   corrected to the one name close to it ("strpe" is Stripe). A job must be
   at one of them (services/company_resolver.py);
1. the roles it names, by the same role resolver the import tags jobs with
   (services/role_resolver.py, read_query, typos corrected); a job must have
   each of them, as a tag or as the phrases that named it in its title
   (title_says, whole words): "software" finds "Embedded Software Engineer", tagged
   embedded_engineer, as well as every software_engineer job;
2. the facts it names that have columns (query_facts): "intern" is the
   internship experience level, "new grad" new_grad, "remote" / "hybrid" /
   "onsite" the work style, "summer 2027" or a bare "2027" the start term.
   Read from the whole query, so "marketing intern" is the marketing role
   and internships both. Like the filters they echo, each hides a job that
   doesn't state that fact, except that a start term and "remote" also
   match a title that says them ("Fall 2027", "Remote"): about half the
   jobs state no start term in its column;
3. every other word, each of which must be in the job's text (job_postings.
   fts) or its company's name: "stripe intern" is internships at Stripe or
   that mention it. A stop word ("at", "the") is passed over.

A search orders nothing: results are newest first, as the feed is. Ranking
is the recommendations' job, not search's.
"""

import time
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field

from sqlalchemy import distinct, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import dto
from app.models.job_roles import Job_Role
from app.models.jobs import Job_Post
from app.queries.jobs.filters import LISTED
from app.services.company_resolver import CompanyResolver
from app.services.role_resolver import RoleResolver, raw_words
from app.services.search_facts import query_facts
from app.services.start_terms import season_of


@dataclass(frozen=True)
class Search:
    '''?q= read: JobFilters' query_ fields, the start seasons still as keys'''
    companies: tuple[str, ...] = ()
    roles: tuple[str, ...] = ()
    role_words: Mapping[str, tuple[tuple[str, ...], ...]] = field(default_factory=dict)
    levels: tuple[str, ...] = ()
    work_styles: tuple[dto.work_style, ...] = ()
    seasons: tuple[str, ...] = ()
    season_phrases: tuple[str, ...] = ()
    remote_phrases: tuple[str, ...] = ()
    words: tuple[str, ...] = ()


async def read_search(db: AsyncSession, q: str | None) -> Search:
    '''
    a search in its parts (the module docstring): the companies it names by
    whole name, first, so a name keeps its words ("Bedrock Robotics" is not
    the robotics role); the roles the role resolver finds in what is left;
    the facts query_facts finds there, a word a role's alias used included
    ("marketing intern"'s "intern"); then a typo in the words still left,
    corrected to the one company close to it; and the words left after all
    of that
    '''
    text = (q or "").strip()
    if not text:
        return Search()
    companies = await company_resolver(db)
    named = companies.read(raw_words(text))
    read = (await role_resolver(db)).read_query(" ".join(named.rest))
    facts = query_facts(named.rest)
    # The words no role used, less the ones that named a fact, then less a
    # company's name typed wrong.
    left = query_facts(read.rest).used
    fixed = companies.correct(w for i, w in enumerate(read.rest) if i not in left)
    return Search(
        companies=tuple(sorted(named.companies | fixed.companies)),
        roles=tuple(sorted(read.roles)),
        role_words=read.said,
        levels=facts.levels,
        work_styles=facts.work_styles,
        seasons=facts.seasons,
        season_phrases=facts.season_phrases,
        remote_phrases=facts.remote_phrases,
        words=fixed.rest,
    )


# The company names ?q= is read against, from the listed jobs, kept for
# COMPANY_TTL seconds: companies come and go with each import (every three
# hours), so the list is refreshed rather than kept for the process's life.
# Tests stand company_resolver in.
COMPANY_TTL = 300
_companies: tuple[float, CompanyResolver] | None = None


async def company_resolver(db: AsyncSession) -> CompanyResolver:
    '''
    the company resolver for searches, over the names of the published
    scraped jobs. A one-word name that is a search's own word (a role's
    alias, "intern", "remote") is left out, so it keeps its meaning
    '''
    global _companies
    now = time.monotonic()
    if _companies is None or now - _companies[0] > COMPANY_TTL:
        roles = await role_resolver(db)
        names = (await db.execute(
            select(distinct(Job_Post.company_name)).where(LISTED, Job_Post.company_name.is_not(None))
        )).scalars().all()
        reserved = lambda key: bool(roles.resolve(" ".join(key)) or query_facts(key).used)
        _companies = (now, CompanyResolver(names, reserved))
    return _companies[1]


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


async def terms_in(db: AsyncSession, seasons: Sequence[str]) -> list[str]:
    '''the start terms postings use that fall in any of these seasons'''
    terms = (await db.execute(
        select(distinct(Job_Post.start_term)).where(LISTED, Job_Post.start_term.is_not(None))
    )).scalars()
    wanted = set(seasons)
    return [t for t in terms if season_of(t) in wanted]
