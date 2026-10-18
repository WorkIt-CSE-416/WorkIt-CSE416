"""
job_applications' queries, behind routers/applications.py: when an applicant
marked a job as applied, and marking it; saving a job and taking it back out
(KAN-261). Auto apply's queue reads and writes the same rows
(auto_apply/queries.py).
"""

import datetime
import uuid

from sqlalchemy import delete, func, select
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


async def save_job(
    db: AsyncSession, applicant_id: uuid.UUID, job_id: uuid.UUID
) -> application_stage | None:
    '''
    keeps this job as saved and answers its stage, or None for a job that
    isn't in the feed. A job that already has an application (queued,
    applied...) keeps it and answers that stage: saving never moves one back
    '''
    listed = await db.scalar(select(Job_Post.id).where(Job_Post.id == job_id, LISTED))
    if listed is None:
        return None
    # applied_at NULL in place of the column's now() default, as a queued
    # insert writes it: nobody applied to a saved job
    await db.execute(
        insert(Job_Application)
        .values(
            applicant_id=applicant_id,
            job_id=job_id,
            stage=application_stage.saved,
            applied_at=None,
        )
        .on_conflict_do_nothing(index_elements=["applicant_id", "job_id"])
    )
    await db.commit()
    return await db.scalar(
        select(Job_Application.stage).where(
            Job_Application.applicant_id == applicant_id,
            Job_Application.job_id == job_id,
        )
    )


async def unsave_job(
    db: AsyncSession, applicant_id: uuid.UUID, job_id: uuid.UUID
) -> application_stage | None:
    '''
    takes this job out of saved and answers None, or answers the stage it
    has instead when it is past saved: a queued or applied job is a record,
    not a bookmark, so this never deletes it. A job never saved is None too
    '''
    removed = await db.scalar(
        delete(Job_Application)
        .where(
            Job_Application.applicant_id == applicant_id,
            Job_Application.job_id == job_id,
            Job_Application.stage == application_stage.saved,
        )
        .returning(Job_Application.job_id)
    )
    if removed is not None:
        await db.commit()
        return None
    return await db.scalar(
        select(Job_Application.stage).where(
            Job_Application.applicant_id == applicant_id,
            Job_Application.job_id == job_id,
        )
    )
