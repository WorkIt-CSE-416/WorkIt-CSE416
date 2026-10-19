"""
Layer 1, database: auto apply's reads and writes of job_applications
(auto-apply/architecture.md, "The function layers"). Each does one thing,
checks no ownership and never commits: the layer-2 step that calls it owns
the transaction.

The queue is the applicant's job_applications rows: `stage` says where each
stands (dto.application_stage), `created_at` orders them. pick_resume reads
the resume rows, never writes them.
"""

import uuid
from collections.abc import Sequence
from dataclasses import dataclass

from sqlalchemy import (
    DateTime,
    Select,
    Uuid,
    and_,
    cast,
    delete,
    func,
    literal,
    null,
    select,
    update,
)
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.applications import Job_Application
from app.models.built_resume import Built_Resume
from app.models.dto import application_stage
from app.models.jobs import Job_Post
from app.models.profiles import Applicant_Profile
from app.models.resume import Resume
from app.queries.jobs.filters import AUTO_APPLY_SUPPORTED, LISTED
from app.queries.jobs.listings import LISTING_COLUMNS, to_listing
from app.schemas.applications import Application


async def queue_applications(
    db: AsyncSession, applicant_id: uuid.UUID, job_ids: Sequence[uuid.UUID]
) -> set[uuid.UUID]:
    """
    Saves as queued each of `job_ids` that is listed (open, scraped), is on a
    hiring system auto apply fills (AUTO_APPLY_SUPPORTED), and has no
    application of this applicant yet, or only a saved one (KAN-261);
    answers the ones it queued. One with an application at any other stage
    keeps it: queueing never moves an applied or skipped job back.
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
    ).where(Job_Post.id.in_(job_ids), LISTED, AUTO_APPLY_SUPPORTED)
    queued = await db.scalars(
        insert(Job_Application)
        .from_select(["applicant_id", "job_id", "stage", "applied_at"], listed)
        # A saved job is no application yet: it becomes queued. RETURNING
        # names it as queued too, so the button and the batch count it. Its
        # created_at moves to now, since that orders the queue: kept, a job
        # saved last month would jump ahead of everything queued since.
        .on_conflict_do_update(
            index_elements=["applicant_id", "job_id"],
            set_={"stage": application_stage.queued, "created_at": func.now()},
            where=Job_Application.stage == application_stage.saved,
        )
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


async def remove_queued(db: AsyncSession, applicant_id: uuid.UUID, job_id: uuid.UUID) -> bool:
    """Deletes this application if it is still queued; answers whether it
    did. The stage is in the same statement, so a fill that finishes it in
    between is never undone."""
    removed = await db.scalar(
        delete(Job_Application)
        .where(
            Job_Application.applicant_id == applicant_id,
            Job_Application.job_id == job_id,
            Job_Application.stage == application_stage.queued,
        )
        .returning(Job_Application.job_id)
    )
    return removed is not None


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


@dataclass(frozen=True)
class ResumeChoice:
    """The resume an application sends: exactly one of the two ids."""

    built_resume_id: uuid.UUID | None = None
    uploaded_resume_id: uuid.UUID | None = None


async def pick_resume(
    db: AsyncSession, applicant_id: uuid.UUID, job_id: uuid.UUID
) -> ResumeChoice | None:
    """
    The resume to attach to this applicant's application for this job
    (auto-apply/architecture.md, "Picking the resume"): the one tailored to
    the job posting, else the default resume, a base or an uploaded one
    (set_default keeps one pointer, never both). None when there is neither,
    or the default upload has no stored file: the form is filled without one.
    """
    tailored = await db.scalar(
        select(Built_Resume.id).where(
            Built_Resume.applicant_id == applicant_id,
            Built_Resume.job_posting_id == job_id,
        )
    )
    if tailored is not None:
        return ResumeChoice(built_resume_id=tailored)
    default = (
        await db.execute(
            select(Applicant_Profile.default_built_resume_id, Resume.id.label("uploaded_id"))
            .outerjoin(
                Resume,
                and_(
                    Resume.id == Applicant_Profile.default_resume_id,
                    Resume.storage_path.is_not(None),
                ),
            )
            .where(Applicant_Profile.id == applicant_id)
        )
    ).first()
    if default is None:
        return None
    if default.default_built_resume_id is not None:
        return ResumeChoice(built_resume_id=default.default_built_resume_id)
    if default.uploaded_id is not None:
        return ResumeChoice(uploaded_resume_id=default.uploaded_id)
    return None
