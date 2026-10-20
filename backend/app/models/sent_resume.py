'''
Sent resumes (KAN-208): the exact file a student applied with, kept
unchanged from that moment. Downloads were kept too until KAN-267; their
rows stay, with no job posting. Rows are written only through
`app/services/sent_resumes.py`.
'''
import uuid as _uuid

from sqlalchemy import (
    CheckConstraint,
    ForeignKey,
    Index,
    LargeBinary,
    UniqueConstraint,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db import BaseModel


class Resume_Snapshot(BaseModel):
    '''
    What a sent resume's PDF is made from, frozen (KAN-267,
    docs/sent_resume.md): gzipped JSON, rendered again whenever it is
    opened, in place of a stored PDF. `source` "built" is a built resume's
    view, exact; "upload" is an uploaded file's text as the parser read it,
    kept once that upload was replaced or deleted, and approximate. One per
    content: sent resumes of the same content share it.
    '''
    __tablename__ = "resume_snapshots"
    __table_args__ = (
        UniqueConstraint("applicant_id", "content_hash", name="resume_snapshots_applicant_hash_key"),
        CheckConstraint("source IN ('built', 'upload')", name="resume_snapshots_source_check"),
    )

    id: Mapped[_uuid.UUID] = mapped_column(
        primary_key=True, default=_uuid.uuid4, server_default=text("gen_random_uuid()"))
    # The unique key leads with it, so it needs no index of its own.
    applicant_id: Mapped[_uuid.UUID] = mapped_column(
        ForeignKey("applicant_profiles.id", ondelete="CASCADE"))
    content_hash: Mapped[str]
    source: Mapped[str]
    data: Mapped[bytes] = mapped_column(LargeBinary)


class Sent_Resume(BaseModel):
    '''
    Its file is one of two (`sent_resumes_one_file`): `storage_path`, a file
    in the Resume bucket (an uploaded resume's own, or a PDF kept before
    KAN-267), or `snapshot_id`, a snapshot rendered again on open. A row
    from an uploaded resume moves from the first to the second once, when
    that upload is replaced or deleted. The source links and the posting
    are nulled when their row goes; the sent resume stays.
    '''
    __tablename__ = "sent_resumes"
    __table_args__ = (
        CheckConstraint("num_nonnulls(built_resume_id, uploaded_resume_id) <= 1", name="sent_resumes_one_source"),
        CheckConstraint("num_nonnulls(storage_path, snapshot_id) = 1", name="sent_resumes_one_file"),
        Index("ix_sent_resumes_built_resume_id", "built_resume_id", "content_hash"),
    )

    id: Mapped[_uuid.UUID] = mapped_column(
        primary_key=True, default=_uuid.uuid4, server_default=text("gen_random_uuid()"))
    applicant_id: Mapped[_uuid.UUID] = mapped_column(
        ForeignKey("applicant_profiles.id", ondelete="CASCADE"), index=True)
    storage_path: Mapped[str | None]
    # RESTRICT: the service deletes a snapshot only once no sent resume uses it.
    snapshot_id: Mapped[_uuid.UUID | None] = mapped_column(
        ForeignKey("resume_snapshots.id", ondelete="RESTRICT"), index=True)
    name: Mapped[str]
    built_resume_id: Mapped[_uuid.UUID | None] = mapped_column(
        ForeignKey("built_resumes.id", ondelete="SET NULL"))
    uploaded_resume_id: Mapped[_uuid.UUID | None] = mapped_column(
        ForeignKey("resumes.id", ondelete="SET NULL"), index=True)
    job_posting_id: Mapped[_uuid.UUID | None] = mapped_column(
        ForeignKey("job_postings.id", ondelete="SET NULL"), index=True)
    # A built resume's content hash; NULL on a row from an uploaded resume,
    # also after its upload is frozen into a snapshot.
    content_hash: Mapped[str | None]
