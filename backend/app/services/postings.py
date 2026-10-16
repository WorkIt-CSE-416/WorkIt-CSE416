"""
Which job postings a student can reach: the ones the Jobs page lists. One
rule for the Jobs page, Scout, Tailor, the keyword match and Apply, so a
company's draft or a closed posting is never read, matched or applied to by
a route that forgot the status check.
"""

import uuid

from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import undefer

from app.models.dto import job_post_status
from app.models.jobs import Job_Post

# A published scraped job. Company jobs stay off the Jobs page until the
# company side ships a listing of its own.
LISTED = and_(Job_Post.company_id.is_(None), Job_Post.status == job_post_status.published)


async def listed(session: AsyncSession, posting_id: uuid.UUID, *, keywords: bool = False) -> Job_Post | None:
    """The listed posting with this id, or None (unknown, draft, paused,
    closed, or a company's own). `keywords` loads the cached keywords too."""
    query = select(Job_Post).where(Job_Post.id == posting_id, LISTED)
    if keywords:
        query = query.options(undefer(Job_Post.keywords), undefer(Job_Post.keywords_hash))
    return await session.scalar(query)
