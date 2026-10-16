'''
Sent resumes (KAN-208): the exact file a student downloaded or applied with,
kept unchanged from that moment. Rows are written only through
`app/services/sent_resumes.py`.
'''
import uuid as _uuid

from sqlalchemy import CheckConstraint, ForeignKey, Index, text
from sqlalchemy.orm import Mapped, mapped_column

from app.db import BaseModel


class Sent_Resume(BaseModel):
    '''
    `storage_path` is a file in the Resume bucket: its own PDF (from a built
    resume) or an uploaded resume's file. The source links and the posting
    are nulled when their row goes; the sent resume stays.
    '''
    __tablename__ = "sent_resumes"
    __table_args__ = (
        CheckConstraint("num_nonnulls(built_resume_id, uploaded_resume_id) <= 1", name="sent_resumes_one_source"),
        Index("ix_sent_resumes_built_resume_id", "built_resume_id", "content_hash"),
    )

    id: Mapped[_uuid.UUID] = mapped_column(
        primary_key=True, default=_uuid.uuid4, server_default=text("gen_random_uuid()"))
    applicant_id: Mapped[_uuid.UUID] = mapped_column(
        ForeignKey("applicant_profiles.id", ondelete="CASCADE"), index=True)
    storage_path: Mapped[str]
    name: Mapped[str]
    built_resume_id: Mapped[_uuid.UUID | None] = mapped_column(
        ForeignKey("built_resumes.id", ondelete="SET NULL"))
    uploaded_resume_id: Mapped[_uuid.UUID | None] = mapped_column(
        ForeignKey("resumes.id", ondelete="SET NULL"), index=True)
    job_posting_id: Mapped[_uuid.UUID | None] = mapped_column(
        ForeignKey("job_postings.id", ondelete="SET NULL"), index=True)
    content_hash: Mapped[str | None]
