'''
which jobs each applicant has marked as applied (KAN-232)
ex: applicant 7 applied to job 3 on 2026-10-15
'''
import datetime
import uuid

from sqlalchemy import DateTime, ForeignKey, Index, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class Job_Application(Base):
    '''
    one row per (applicant, job) the applicant has applied to. A join table
    rather than an array of applicant ids on the job: the foreign keys keep
    both sides real, an apply never rewrites the job row the import upserts,
    and a status or resume column can join applied_at later
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
    applied_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now())

    __table_args__ = (
        # the primary key serves "this applicant's jobs" (the feed's filter);
        # this one serves "who applied to this job", for a company's view
        Index("job_applications_job_idx", "job_id", "applicant_id"),
    )
