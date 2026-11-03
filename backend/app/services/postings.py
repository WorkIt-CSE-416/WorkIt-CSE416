"""
Which job postings a student can reach: the ones the Jobs page lists. One
rule for the Jobs page, Scout, Tailor, the keyword match and Apply, so a
company's draft or a closed posting is never read, matched or applied to by
a route that forgot the status check.
"""

import uuid

from sqlalchemy import Text, and_, cast, exists, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import undefer

from app.models.applications import Job_Application
from app.models.dto import job_post_status
from app.models.jobs import Job_Post

# A published scraped job. Company jobs stay off the Jobs page until the
# company side ships a listing of its own.
LISTED = and_(Job_Post.company_id.is_(None), Job_Post.status == job_post_status.published)

# A job a student added by its link because WorkIt does not list it (KAN-542,
# ADR 0008). Compared as text, so the query runs on a database whose enum has
# no 'unlisted' yet (models/CLAUDE.md).
UNLISTED = and_(Job_Post.company_id.is_(None), cast(Job_Post.status, Text) == job_post_status.unlisted.value)


async def listed(session: AsyncSession, posting_id: uuid.UUID, *, keywords: bool = False) -> Job_Post | None:
    """The listed posting with this id, or None (unknown, draft, paused,
    closed, or a company's own). `keywords` loads the cached keywords too."""
    query = select(Job_Post).where(Job_Post.id == posting_id, LISTED)
    if keywords:
        query = query.options(undefer(Job_Post.keywords), undefer(Job_Post.keywords_hash))
    return await session.scalar(query)


def tracked_by(applicant_id: uuid.UUID):
    """A scraped posting this applicant has an application on, whatever its
    status: one they added by its link (unlisted), or one the feed closed or
    paused after they tracked it (KAN-544). Only the tracker and the
    student's own writes on it (applied, a Sent resume) reach it."""
    return and_(Job_Post.company_id.is_(None), exists().where(
        Job_Application.applicant_id == applicant_id, Job_Application.job_id == Job_Post.id))


async def reachable(session: AsyncSession, posting_id: uuid.UUID, applicant_id: uuid.UUID) -> Job_Post | None:
    """The posting, when it is listed or tracked by this applicant; else None."""
    return await session.scalar(
        select(Job_Post).where(Job_Post.id == posting_id, or_(LISTED, tracked_by(applicant_id))))
