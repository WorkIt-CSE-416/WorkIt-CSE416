"""
Home's matches (KAN-425): Top Matches, the ones auto apply can fill, and the
Strong Matches posting dates, from one scoring pass, kept per applicant
until something they depend on changes.

ONE PASS, NOT THREE. Home asked GET /jobs/recommended three times at once
(the top 12, the top 12 auto apply fills, and every recent Strong Match a
page of 500 at a time), and the tracker scored a fourth. Each pass scans
every listed job's vector, so the three ran side by side on one small
Postgres: on 2026-10-28 one pass took 4 to 6 s alone and three at once 13
to 23 s. score_job_sets scans once and ranks each set on its own, so each
list is the one its own GET /jobs/recommended call returns.

KEPT UNTIL IT GOES STALE. A return to Home scored everything again. The
result is kept in this process under what it was made from: the bank's
updated_at (every entry, bullet or skill change sets it, services/bank.py),
the newest job_postings.updated_at (the import, its embeddings and every
closing set it), and the jobs the applicant marked applied, which GET
/jobs/recommended leaves out. Any change makes a new key, so a kept result
is never served after one; HOME_CACHE_SECONDS bounds the rest (a posting's
freshness and the Strong Matches window move with the clock). Each process
keeps its own: a Vercel Function's lasts while the instance does, the
container's for good. Reading the key costs one small query.
"""

import datetime
import time
import uuid
from collections import OrderedDict

from sqlalchemy import Text, cast, func, select
from sqlalchemy.dialects.postgresql import aggregate_order_by
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import dto
from app.models.applications import Job_Application
from app.models.bank import Experience_Bank
from app.models.jobs import Job_Post
from app.queries.jobs.filters import AUTO_APPLY_SUPPORTED, JobFilters
from app.queries.jobs.recommendations import score_job_sets
from app.schemas.auth import AuthenticatedAccount
from app.schemas.jobs import HomeMatches
from app.services.bank import Bank

# How long a kept result may be served when nothing in its key changed.
HOME_CACHE_SECONDS = 600
# The most applicants kept at once; the least recently read goes first.
HOME_CACHE_SIZE = 256

_kept: OrderedDict[tuple, tuple[float, HomeMatches]] = OrderedDict()


async def home_version(db: AsyncSession, applicant_id: uuid.UUID) -> tuple:
    """What a kept result was made from, read in one query: the bank's
    updated_at, the newest job posting change, and a hash of the jobs this
    applicant marked applied."""
    applied = (
        select(func.md5(func.coalesce(func.string_agg(
            cast(Job_Application.job_id, Text),
            aggregate_order_by(",", Job_Application.job_id),
        ), "")))
        .where(
            Job_Application.applicant_id == applicant_id,
            Job_Application.stage.not_in(dto.BEFORE_APPLIED),
        )
        .scalar_subquery()
    )
    row = (await db.execute(select(
        select(Experience_Bank.updated_at)
        .where(Experience_Bank.applicant_id == applicant_id)
        .scalar_subquery(),
        select(func.max(Job_Post.updated_at)).scalar_subquery(),
        applied,
    ))).one()
    return tuple(row)


def kept(key: tuple) -> HomeMatches | None:
    """The result kept under this key, while it is young enough."""
    hit = _kept.get(key)
    if hit is None or time.monotonic() - hit[0] > HOME_CACHE_SECONDS:
        return None
    _kept.move_to_end(key)
    return hit[1]


def keep(key: tuple, matches: HomeMatches) -> None:
    _kept[key] = (time.monotonic(), matches)
    _kept.move_to_end(key)
    while len(_kept) > HOME_CACHE_SIZE:
        _kept.popitem(last=False)


async def home_matches(
    db: AsyncSession,
    account: AuthenticatedAccount,
    bank: Bank,
    *,
    posted_within: int,
    min_match: int,
    limit: int,
) -> HomeMatches:
    """Home's three lists from one scoring pass. Checks no ownership: the
    route has."""
    since = datetime.datetime.now(datetime.UTC) - datetime.timedelta(days=posted_within)
    scored = await score_job_sets(
        db,
        account,
        bank,
        # The applied jobs stay out, as GET /jobs/recommended leaves them out
        # for a signed-in applicant (read_filters).
        JobFilters(applied_by=account.id),
        {
            "top": None,
            "auto_apply": AUTO_APPLY_SUPPORTED,
            "recent": Job_Post.posted_at >= since,
        },
    )
    return HomeMatches(
        top=scored["top"][:limit],
        auto_apply=scored["auto_apply"][:limit],
        strong_posted=[
            job.posted_at for job in scored["recent"] if job.match >= min_match and job.posted_at
        ],
    )
