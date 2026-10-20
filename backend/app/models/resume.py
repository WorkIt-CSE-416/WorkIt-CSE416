import uuid as _uuid

from sqlalchemy import ForeignKey, Index, text
from sqlalchemy.orm import Mapped, mapped_column

from app.db import BaseModel
from app.models.dto import ResumeStatus


class Resume(BaseModel):
    __tablename__ = "resumes"
    __table_args__ = (
        # One upload per text for each student (KAN-267): the duplicate check
        # in routers/resumes.py, backed here so two uploads at once cannot
        # both pass it. An upload with no text has no hash and is never matched.
        Index("resumes_text_hash_key", "applicant_id", "text_hash", unique=True,
              postgresql_where=text("text_hash IS NOT NULL")),
    )

    id: Mapped[_uuid.UUID] = mapped_column(primary_key=True, server_default=text("gen_random_uuid()"))
    applicant_id: Mapped[_uuid.UUID] = mapped_column(ForeignKey("applicant_profiles.id", ondelete="CASCADE"), index=True)
    original_filename: Mapped[str | None]
    storage_path: Mapped[str | None]
    status: Mapped[ResumeStatus] = mapped_column(server_default="uploaded")
    raw_text: Mapped[str | None]
    # sha256 of raw_text, normalized (routers/resumes.py's `text_hash`). NULL
    # with no text, and on every upload from before KAN-267: not backfilled.
    text_hash: Mapped[str | None]
    # The parser's reading goes into the experience bank, not here (ADR 0003).
    # resumes.embedding still exists in the database but is no longer mapped:
    # the embedding moved to experience_banks (KAN-212). Its drop is the
    # contract half, applied after this code is deployed (models/CLAUDE.md).
