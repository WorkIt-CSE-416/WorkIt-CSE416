"""
Layer 1, database: auto apply's reads and writes of job_applications
(auto-apply/architecture.md, "The function layers"). Each does one thing,
checks no ownership and never commits: the layer-2 step that calls it owns
the transaction.

The queue is the applicant's job_applications rows: `stage` says where each
stands (dto.application_stage), `created_at` orders them. pick_resume reads
the resume rows, never writes them. WorkIt Desktop (KAN-323,
auto-apply/desktop.md) claims queued rows, keeps each one's review in
application_reviews and beats into desktop_heartbeats.
"""

import datetime
import uuid
from collections.abc import Sequence
from dataclasses import dataclass

from sqlalchemy import (
    DateTime,
    Interval,
    Select,
    Uuid,
    and_,
    cast,
    delete,
    exists,
    func,
    literal,
    null,
    or_,
    select,
    update,
)
from sqlalchemy.dialects.postgresql import JSONB, insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.applications import Application_Review, Job_Application
from app.models.built_resume import Built_Resume
from app.models.desktop import Desktop_Heartbeat
from app.models.dto import application_stage
from app.models.jobs import Job_Post
from app.models.profiles import Applicant_Profile
from app.models.resume import Resume
from app.models.sent_resume import Sent_Resume
from app.queries.jobs.filters import AUTO_APPLY_SUPPORTED, LISTED
from app.queries.jobs.listings import LISTING_COLUMNS, to_listing
from app.schemas.applications import (
    Application,
    DesktopBeat,
    DesktopStatus,
    Review,
    ReviewAnswer,
)
from app.schemas.sent_resume import SentResumeResponse


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
    """This applicant's applications, each with its job posting's listing
    and the sent resume it names (KAN-267), if any."""
    return (
        select(
            *LISTING_COLUMNS,
            Job_Application.stage.label("stage"),
            Job_Application.created_at.label("added_at"),
            Job_Application.applied_at.label("applied_at"),
            LISTED.label("open"),
            Sent_Resume,
        )
        .join(Job_Application, Job_Application.job_id == Job_Post.id)
        .outerjoin(Sent_Resume, Sent_Resume.id == Job_Application.sent_resume_id)
        .where(Job_Application.applicant_id == applicant_id)
    )


def _to_application(row) -> Application:
    return Application(
        job=to_listing(row),
        stage=row.stage,
        added_at=row.added_at,
        applied_at=row.applied_at,
        open=row.open,
        sent_resume=SentResumeResponse.from_row(row.Sent_Resume) if row.Sent_Resume else None,
    )


async def link_resume(
    db: AsyncSession, applicant_id: uuid.UUID, job_id: uuid.UUID, sent_resume_id: uuid.UUID
) -> None:
    """Names the sent resume an application goes out with (KAN-267): auto
    apply's resume step, which made it for this job posting. Flushes; the
    caller commits."""
    await db.execute(
        update(Job_Application)
        .where(Job_Application.applicant_id == applicant_id, Job_Application.job_id == job_id)
        .values(sent_resume_id=sent_resume_id)
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


async def move_stage(
    db: AsyncSession,
    applicant_id: uuid.UUID,
    job_id: uuid.UUID,
    stage: application_stage,
    allowed: Sequence[application_stage],
) -> bool:
    """Moves this application to `stage` only if it is at one of `allowed`,
    in one conditional UPDATE, so two moves at once can't both pass a check
    made before either writes. False when it isn't (or there is none).
    Applied also records when, unless it already has a date."""
    values: dict = {"stage": stage}
    if stage == application_stage.applied:
        values["applied_at"] = func.coalesce(Job_Application.applied_at, func.now())
    moved = await db.scalar(
        update(Job_Application)
        .where(
            Job_Application.applicant_id == applicant_id,
            Job_Application.job_id == job_id,
            Job_Application.stage.in_(list(allowed)),
        )
        .values(**values)
        .returning(Job_Application.job_id)
    )
    return moved is not None


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
    the job posting, else the default resume, a built or an uploaded one
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


# --- WorkIt Desktop (KAN-323) ---

# A `filling` application whose Desktop has been silent this long goes back
# to queued on the next claim: the Desktop crashed or was closed.
STALE_AFTER = datetime.timedelta(minutes=10)
# A `filling` application held this long since its claim goes back to queued
# on the next claim, even while its Desktop beats: its review or finish never
# reached WorkIt. Longer than any one fill.
LEASE = datetime.timedelta(minutes=30)
# Desktop beats every 15 s; three missed beats and it reads as offline.
ONLINE_WITHIN = datetime.timedelta(seconds=45)


def _since(window: datetime.timedelta):
    """now() less `window`, on the database's clock."""
    return func.now() - literal(window, Interval())


def _current_instance(applicant_id: uuid.UUID):
    """The running Desktop's instance, from its last beat (NULL when none sent)."""
    return (
        select(Desktop_Heartbeat.instance)
        .where(Desktop_Heartbeat.applicant_id == applicant_id)
        .scalar_subquery()
    )


def _not_held(applicant_id: uuid.UUID):
    """Whether an application's Desktop no longer holds it: the Desktop has
    not beaten for STALE_AFTER (or never has), or its lease ran out (claimed
    LEASE ago), or an earlier run of Desktop claimed it (its `claimed_by`
    isn't the instance now beating)."""
    alive = exists().where(
        Desktop_Heartbeat.applicant_id == applicant_id,
        Desktop_Heartbeat.last_seen >= _since(STALE_AFTER),
    )
    current = _current_instance(applicant_id)
    return or_(
        ~alive,
        Job_Application.claimed_at < _since(LEASE),
        # A Desktop too old to send an instance never matches, and never strands one.
        and_(current.is_not(None), Job_Application.claimed_by.is_distinct_from(current)),
    )


async def requeue_stale(db: AsyncSession, applicant_id: uuid.UUID) -> set[uuid.UUID]:
    """Sends back to queued each of this applicant's `filling` applications
    its Desktop no longer holds (_not_held). Answers which. They keep their
    created_at, so the next claim takes them first."""
    requeued = await db.scalars(
        update(Job_Application)
        .where(
            Job_Application.applicant_id == applicant_id,
            Job_Application.stage == application_stage.filling,
            _not_held(applicant_id),
        )
        .values(stage=application_stage.queued)
        .returning(Job_Application.job_id)
    )
    return set(requeued)


async def strand_submitting(db: AsyncSession, applicant_id: uuid.UUID) -> set[uuid.UUID]:
    """Moves to needs_you each of this applicant's `submitting` applications
    its Desktop no longer holds (_not_held). Never back to approved: its form
    may have been sent, so it is never submitted again; the student checks
    it. Answers which."""
    stranded = await db.scalars(
        update(Job_Application)
        .where(
            Job_Application.applicant_id == applicant_id,
            Job_Application.stage == application_stage.submitting,
            _not_held(applicant_id),
        )
        .values(stage=application_stage.needs_you)
        .returning(Job_Application.job_id)
    )
    return set(stranded)


async def claim_queued(db: AsyncSession, applicant_id: uuid.UUID, n: int) -> list[Application]:
    """
    Moves up to `n` of this applicant's oldest queued applications whose job
    posting is open to `filling`, and answers them, oldest first. One
    statement whose pick locks with FOR UPDATE SKIP LOCKED: a second claim at
    the same moment passes over the rows this one holds, and one that reads
    them after this commits sees them `filling`, so two Workers never get
    the same application. Empty when nothing is queued.
    """
    return await _claim(db, applicant_id, n, application_stage.queued, application_stage.filling, LISTED)


async def claim_approved(db: AsyncSession, applicant_id: uuid.UUID, n: int) -> list[Application]:
    """
    Moves up to `n` of this applicant's oldest approved applications to
    `submitting`, leased to the beating Desktop as claim_queued leases, and
    answers them: a submit is taken once, so no restart or second Desktop
    sends a form twice. A closed job posting is taken too: its fill finds it
    closed and finishes it skipped.
    """
    return await _claim(db, applicant_id, n, application_stage.approved, application_stage.submitting)


async def _claim(
    db: AsyncSession,
    applicant_id: uuid.UUID,
    n: int,
    from_stage: application_stage,
    to_stage: application_stage,
    *where,
) -> list[Application]:
    # A materialized CTE, run once: as a plain IN (subquery), Postgres can run
    # the LIMIT again on a recheck and take more than `n`.
    picked = (
        select(Job_Application.job_id)
        .join(Job_Post, Job_Post.id == Job_Application.job_id)
        .where(
            Job_Application.applicant_id == applicant_id,
            Job_Application.stage == from_stage,
            *where,
        )
        .order_by(Job_Application.created_at, Job_Application.job_id)
        .limit(n)
        .with_for_update(of=Job_Application, skip_locked=True)
        .cte("picked")
        .prefix_with("MATERIALIZED", dialect="postgresql")
    )
    claimed = list(
        await db.scalars(
            update(Job_Application)
            .where(
                Job_Application.applicant_id == applicant_id,
                Job_Application.job_id.in_(select(picked.c.job_id)),
                Job_Application.stage == from_stage,
            )
            .values(
                stage=to_stage,
                claimed_at=func.now(),
                claimed_by=_current_instance(applicant_id),
            )
            .returning(Job_Application.job_id)
        )
    )
    if not claimed:
        return []
    rows = await db.execute(
        _applications(applicant_id)
        .where(Job_Application.job_id.in_(claimed))
        .order_by(Job_Application.created_at, Job_Application.job_id)
    )
    return [_to_application(row) for row in rows]


async def save_review(
    db: AsyncSession, applicant_id: uuid.UUID, job_id: uuid.UUID, review: Review
) -> None:
    """Keeps what Desktop filled into this application, replacing an earlier
    review and the answers approved from it. Flushes; the caller commits."""
    upsert = insert(Application_Review).values(
        applicant_id=applicant_id, job_id=job_id, review=review.model_dump(mode="json")
    )
    await db.execute(
        upsert.on_conflict_do_update(
            index_elements=[Application_Review.applicant_id, Application_Review.job_id],
            set_={
                "review": upsert.excluded.review,
                # null(), not None: a JSONB column writes None as JSON null.
                "approved_answers": null(),
                "updated_at": func.now(),
            },
        )
    )


async def fetch_review(
    db: AsyncSession, applicant_id: uuid.UUID, job_id: uuid.UUID
) -> Review | None:
    """This application's review, with the approved answers in place of
    Desktop's once the student approved it; None when it has none."""
    row = (
        await db.execute(
            select(Application_Review.review, Application_Review.approved_answers).where(
                Application_Review.applicant_id == applicant_id,
                Application_Review.job_id == job_id,
            )
        )
    ).first()
    if row is None:
        return None
    if row.approved_answers is None:
        return Review.model_validate(row.review)
    return Review.model_validate({**row.review, "answers": row.approved_answers})


async def approve_review(
    db: AsyncSession,
    applicant_id: uuid.UUID,
    job_id: uuid.UUID,
    answers: Sequence[ReviewAnswer],
) -> bool:
    """Keeps the answers the student approved: `answers`, or the review's
    own when it is empty. Answers whether the application has a review.
    Flushes; the caller commits."""
    approved = (
        literal([a.model_dump(mode="json") for a in answers], JSONB)
        if answers
        else Application_Review.review["answers"]
    )
    kept = await db.scalar(
        update(Application_Review)
        .where(
            Application_Review.applicant_id == applicant_id,
            Application_Review.job_id == job_id,
        )
        .values(approved_answers=approved, updated_at=func.now())
        .returning(Application_Review.job_id)
    )
    return kept is not None


_STATUS = (
    (Desktop_Heartbeat.last_seen >= _since(ONLINE_WITHIN)).label("online"),
    Desktop_Heartbeat.last_seen,
    Desktop_Heartbeat.workers,
    Desktop_Heartbeat.busy,
    Desktop_Heartbeat.usage,
)


async def save_beat(db: AsyncSession, applicant_id: uuid.UUID, beat: DesktopBeat) -> DesktopStatus:
    """Records a Desktop heartbeat, stamped with the database's now(), over
    the last one; answers the status it makes. The caller commits."""
    upsert = insert(Desktop_Heartbeat).values(
        applicant_id=applicant_id,
        workers=beat.workers,
        busy=beat.busy,
        usage=beat.usage.model_dump() if beat.usage else null(),
        version=beat.version,
        instance=beat.instance,
        last_seen=func.now(),
    )
    row = (
        await db.execute(
            upsert.on_conflict_do_update(
                index_elements=[Desktop_Heartbeat.applicant_id],
                set_={
                    column: upsert.excluded[column]
                    for column in ("workers", "busy", "usage", "version", "instance", "last_seen")
                },
            ).returning(*_STATUS)
        )
    ).one()
    return DesktopStatus.model_validate(row, from_attributes=True)


async def fetch_desktop(db: AsyncSession, applicant_id: uuid.UUID) -> DesktopStatus | None:
    """This applicant's Desktop as its last heartbeat left it; None when it
    never beat."""
    row = (
        await db.execute(select(*_STATUS).where(Desktop_Heartbeat.applicant_id == applicant_id))
    ).first()
    return DesktopStatus.model_validate(row, from_attributes=True) if row else None
