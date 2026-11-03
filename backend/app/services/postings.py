"""
Which job postings a student can reach: the ones the Jobs page lists. One
rule for the Jobs page, Scout, Tailor, the keyword match and Apply, so a
company's draft or a closed posting is never read, matched or applied to by
a route that forgot the status check.
"""

import uuid

from sqlalchemy import and_, case, exists, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import undefer

from app.models.applications import Job_Application
from app.models.dto import job_post_status
from app.models.jobs import Job_Post

# A published scraped job, or one a student added from its form (KAN-515):
# open to the applications that hold it. Company jobs stay off the Jobs page
# until the company side ships a listing of its own.
OPEN = and_(Job_Post.company_id.is_(None), Job_Post.status == job_post_status.published)
# A published scraped job: the Jobs page's. A job a student added is theirs
# alone, so every feed, count and lookup that reads LISTED leaves it out;
# only a query of an applicant's own applications reads OPEN.
LISTED = and_(OPEN, Job_Post.added_by_student.is_(False))

# A job a student added (KAN-515, POST /jobs/added-by-link): open, on no
# feed. The feed import clears the flag when it lists the same job.
ADDED = and_(Job_Post.company_id.is_(None), Job_Post.added_by_student.is_(True))


def typed_text(posting_column, typed_column):
    """The posting's company or title as one student sees it: on an added
    job (ADDED), the text that student typed when they added it (their
    application's `typed_column`), never another student's; else the
    posting's own. Labeled as the posting's column, so to_listing reads it.
    Use it in each query that shows a student's applications."""
    return case((ADDED, func.coalesce(typed_column, posting_column)), else_=posting_column).label(posting_column.key)


async def listed(session: AsyncSession, posting_id: uuid.UUID, *, keywords: bool = False) -> Job_Post | None:
    """The listed posting with this id, or None (unknown, draft, paused,
    closed, or a company's own). `keywords` loads the cached keywords too."""
    query = select(Job_Post).where(Job_Post.id == posting_id, LISTED)
    if keywords:
        query = query.options(undefer(Job_Post.keywords), undefer(Job_Post.keywords_hash))
    return await session.scalar(query)


def tracked_by(applicant_id: uuid.UUID):
    """A scraped posting this applicant has an application on, whatever its
    status: one a student added (ADDED), or one the feed closed or paused
    after they tracked it (KAN-544). Only the tracker and the student's own
    writes on it (applied, a Sent resume) reach it."""
    return and_(Job_Post.company_id.is_(None), exists().where(
        Job_Application.applicant_id == applicant_id, Job_Application.job_id == Job_Post.id))


async def reachable(session: AsyncSession, posting_id: uuid.UUID, applicant_id: uuid.UUID) -> Job_Post | None:
    """The posting, when it is listed or tracked by this applicant; else None."""
    return await session.scalar(
        select(Job_Post).where(Job_Post.id == posting_id, or_(LISTED, tracked_by(applicant_id))))
