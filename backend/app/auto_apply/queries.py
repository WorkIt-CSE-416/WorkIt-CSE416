"""
Layer 1, database: auto apply's reads and writes of job_applications
(auto-apply/architecture.md, "The function layers"). Each does one thing,
checks no ownership and never commits: the layer-2 step that calls it owns
the transaction.

The queue is the applicant's job_applications rows: `stage` says where each
stands (dto.application_stage), `created_at` orders them.
"""

import uuid
from collections.abc import Sequence

from sqlalchemy import DateTime, Select, Uuid, cast, func, literal, null, select, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.applications import Job_Application
from app.models.dto import application_stage
from app.models.jobs import Job_Post
from app.queries.jobs.filters import LISTED
from app.queries.jobs.listings import LISTING_COLUMNS, to_listing
from app.schemas.applications import Application


async def queue_applications(
    db: AsyncSession, applicant_id: uuid.UUID, job_ids: Sequence[uuid.UUID]
) -> set[uuid.UUID]:
    """
    Saves as queued each of `job_ids` that is listed (open, scraped) and has
    no application of this applicant yet; answers the ones it queued. One
    with an application at any stage keeps it: queueing never moves an
    applied or skipped job back.
    """
    if not job_ids:
        return set()
    stage_type = Job_Application.__table__.c.stage.type
    listed = select(
        literal(applicant_id, Uuid()),
        Job_Post.id,
        # Cast: a bare parameter in a SELECT list reaches Postgres as text,
        # which it won't put in an enum column.
        cast(literal(application_stage.queued, stage_type), stage_type),
        # Not applied yet: NULL in place of the column's now() default.
        cast(null(), DateTime(timezone=True)),
    ).where(Job_Post.id.in_(job_ids), LISTED)
    queued = await db.scalars(
        insert(Job_Application)
        .from_select(["applicant_id", "job_id", "stage", "applied_at"], listed)
        .on_conflict_do_nothing(index_elements=["applicant_id", "job_id"])
        .returning(Job_Application.job_id)
    )
    return set(queued)


async def fetch_stage(
    db: AsyncSession, applicant_id: uuid.UUID, job_id: uuid.UUID
) -> application_stage | None:
    """This applicant's stage for this job, or None when they have no
    application for it."""
    return await db.scalar(
        select(Job_Application.stage).where(
            Job_Application.applicant_id == applicant_id,
            Job_Application.job_id == job_id,
        )
    )


def _applications(applicant_id: uuid.UUID) -> Select:
    """This applicant's applications, each with its job posting's listing."""
    return (
        select(
            *LISTING_COLUMNS,
            Job_Application.stage.label("stage"),
            Job_Application.created_at.label("added_at"),
            Job_Application.applied_at.label("applied_at"),
            LISTED.label("open"),
        )
        .join(Job_Application, Job_Application.job_id == Job_Post.id)
        .where(Job_Application.applicant_id == applicant_id)
    )


def _to_application(row) -> Application:
    return Application(
        job=to_listing(row),
        stage=row.stage,
        added_at=row.added_at,
        applied_at=row.applied_at,
        open=row.open,
    )


async def fetch_applications(
    db: AsyncSession,
    applicant_id: uuid.UUID,
    stages: Sequence[application_stage] = (),
) -> list[Application]:
    """This applicant's applications in `stages` (every stage when empty),
    newest first. Closed job postings stay in, marked `open=False`."""
    query = _applications(applicant_id)
    if stages:
        query = query.where(Job_Application.stage.in_(stages))
    rows = await db.execute(
        query.order_by(Job_Application.created_at.desc(), Job_Application.job_id)
    )
    return [_to_application(row) for row in rows]


async def fetch_application(
    db: AsyncSession, applicant_id: uuid.UUID, job_id: uuid.UUID
) -> Application | None:
    """This applicant's application for this job, or None when they have
    none. A closed job posting's comes back marked `open=False`."""
    row = (
        await db.execute(_applications(applicant_id).where(Job_Application.job_id == job_id))
    ).first()
    return _to_application(row) if row else None


async def fetch_next_application(
    db: AsyncSession, applicant_id: uuid.UUID
) -> Application | None:
    """The oldest queued application whose job posting is still open, or
    None when nothing is left to fill. A closed one is passed over: its page
    is gone."""
    row = (
        await db.execute(
            _applications(applicant_id)
            .where(Job_Application.stage == application_stage.queued, LISTED)
            .order_by(Job_Application.created_at, Job_Application.job_id)
            .limit(1)
        )
    ).first()
    return _to_application(row) if row else None


async def set_stage(
    db: AsyncSession, applicant_id: uuid.UUID, job_id: uuid.UUID, stage: application_stage
) -> None:
    """Moves this application to `stage`. Applied also records when, unless
    it already has a date."""
    values: dict = {"stage": stage}
    if stage == application_stage.applied:
        values["applied_at"] = func.coalesce(Job_Application.applied_at, func.now())
    await db.execute(
        update(Job_Application)
        .where(
            Job_Application.applicant_id == applicant_id,
            Job_Application.job_id == job_id,
        )
        .values(**values)
    )
