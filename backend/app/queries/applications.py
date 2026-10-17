"""
job_applications' queries, behind routers/applications.py: when an applicant
marked a job as applied, and marking it. Auto apply's queue reads and writes
the same rows (auto_apply/queries.py).
"""

import datetime
import uuid

from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.applications import Job_Application
from app.models.dto import application_stage
from app.models.jobs import Job_Post
from app.queries.jobs.filters import LISTED


async def fetch_applied_at(
    db: AsyncSession, applicant_id: uuid.UUID, job_id: uuid.UUID
) -> datetime.datetime | None:
    '''when this applicant marked this job as applied, or None. A job only
    queued for auto apply has no applied_at, so it reads None too'''
    return await db.scalar(
        select(Job_Application.applied_at).where(
            Job_Application.applicant_id == applicant_id,
            Job_Application.job_id == job_id,
        )
    )


async def mark_applied(
    db: AsyncSession, applicant_id: uuid.UUID, job_id: uuid.UUID
) -> datetime.datetime | None:
    '''
    marks this job as applied and answers when, or None for a job that isn't
    in the feed: the same jobs GET /jobs/{job_id} shows, since a seeker can't
    apply to the rest
    '''
    listed = await db.scalar(select(Job_Post.id).where(Job_Post.id == job_id, LISTED))
    if listed is None:
        return None
    # A job queued, skipped or left to the applicant by auto apply becomes
    # applied. One already applied keeps its first date: the WHERE leaves a
    # second click (or two tabs at once) changing nothing.
    applied = {"stage": application_stage.applied, "applied_at": func.now()}
    await db.execute(
        insert(Job_Application)
        .values(applicant_id=applicant_id, job_id=job_id, **applied)
        .on_conflict_do_update(
            index_elements=["applicant_id", "job_id"],
            set_=applied,
            where=Job_Application.applied_at.is_(None),
        )
    )
    await db.commit()
    return await fetch_applied_at(db, applicant_id, job_id)
