"""Bank queries: the database work behind routers/bank.py."""

import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.profiles import Applicant_Profile
from app.models.resume import Resume


async def resume_to_import(
    session: AsyncSession, applicant_id: uuid.UUID, resume_id: uuid.UUID | None
) -> Resume | None:
    """The upload to import: the given one, the default, or the newest.
    Returns None when no upload exists."""
    mine = select(Resume).where(Resume.applicant_id == applicant_id)
    if resume_id is not None:
        return await session.scalar(mine.where(Resume.id == resume_id))
    default_id = await session.scalar(
        select(Applicant_Profile.default_resume_id).where(Applicant_Profile.id == applicant_id)
    )
    resume = default_id and await session.scalar(mine.where(Resume.id == default_id))
    return resume or await session.scalar(mine.order_by(Resume.created_at.desc()).limit(1))
