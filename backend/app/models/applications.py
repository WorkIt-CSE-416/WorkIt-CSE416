'''
each applicant's application to each job, and where it stands (KAN-232,
KAN-223)
ex: applicant 7 queued job 3 for auto apply on 2026-10-15, applied 2026-10-16
'''
import datetime
import uuid

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base, BaseModel
from app.models import dto


class Job_Application(Base):
    '''
    one row per (applicant, job) the applicant has applied to or queued. A
    join table rather than an array of applicant ids on the job: the foreign
    keys keep both sides real, an apply never rewrites the job row the import
    upserts, and the resume it went out with sits beside applied_at
    '''
    __tablename__ = "job_applications"
    applicant_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("applicant_profiles.id", ondelete="CASCADE"),
        primary_key=True
    )
    job_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("job_postings.id", ondelete="CASCADE"),
        primary_key=True
    )
    # Defaults to applied for the inserts written before stages existed;
    # auto apply's queue always names its stage
    stage: Mapped[dto.application_stage] = mapped_column(server_default="applied")
    # when the row was made: the auto apply queue's order
    created_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now())
    # when the applicant applied; NULL while the job only waits in the queue.
    # The now() default is for applied inserts: a queued one writes NULL
    applied_at: Mapped[datetime.datetime | None] = mapped_column(
        DateTime(timezone=True), server_default=func.now())
    # The resume it went out with (KAN-267): set by "Did You Apply?" and by
    # auto apply's resume step; NULL for one applied without a resume. Its
    # foreign key (below) is the applicant's own sent resumes only.
    sent_resume_id: Mapped[uuid.UUID | None] = mapped_column(index=True)
    # WorkIt Desktop's lease (KAN-323): when a claim moved it to filling, and
    # the running Desktop (its heartbeat's `instance`) that holds it. A claim
    # requeues a filling one whose lease ran out or whose Desktop restarted.
    claimed_at: Mapped[datetime.datetime | None] = mapped_column(DateTime(timezone=True))
    claimed_by: Mapped[uuid.UUID | None]

    __table_args__ = (
        # the primary key serves "this applicant's jobs" (the feed's filter);
        # this one serves "who applied to this job", for a company's view
        Index("job_applications_job_idx", "job_id", "applicant_id"),
        # an applied row always says when
        CheckConstraint(
            "stage <> 'applied' OR applied_at IS NOT NULL",
            name="job_applications_applied_dated",
        ),
        # Composite, so the database refuses a link to another applicant's
        # sent resume. Deleting the sent resume clears the link alone (SET
        # NULL on that one column: nulling applicant_id too would break the
        # primary key); the application stays.
        ForeignKeyConstraint(
            ["sent_resume_id", "applicant_id"], ["sent_resumes.id", "sent_resumes.applicant_id"],
            ondelete="SET NULL (sent_resume_id)", name="job_applications_sent_resume_fkey",
        ),
    )


class Application_Review(BaseModel):
    '''
    what WorkIt Desktop filled into one application before it stopped short
    of Submit (KAN-323, auto-apply/desktop.md): one row per application,
    written when it moves to review and replaced when it is reviewed again.
    `review` is the Review schema as Desktop sent it (schemas/applications.py);
    `approved_answers` the answers the student approved, maybe edited, NULL
    until they approve. Kept apart so the answers Desktop wrote stay readable
    after an edit.

    JSONB, not a row per answer: nothing queries one answer, and the form's
    questions differ by job.
    '''
    __tablename__ = "application_reviews"
    applicant_id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    job_id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    review: Mapped[dict] = mapped_column(JSONB, nullable=False)
    approved_answers: Mapped[list | None] = mapped_column(JSONB)

    __table_args__ = (
        # Goes with its application: dequeueing, the job posting or the
        # account deletes the review too.
        ForeignKeyConstraint(
            ["applicant_id", "job_id"],
            ["job_applications.applicant_id", "job_applications.job_id"],
            ondelete="CASCADE", name="application_reviews_application_fkey",
        ),
        CheckConstraint(
            "jsonb_typeof(review) = 'object'", name="application_reviews_review_object"
        ),
        CheckConstraint(
            "approved_answers IS NULL OR jsonb_typeof(approved_answers) = 'array'",
            name="application_reviews_approved_array",
        ),
    )
