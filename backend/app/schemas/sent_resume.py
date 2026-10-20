"""Request/response shapes for sent resumes (KAN-208)."""

import datetime
from uuid import UUID

from pydantic import BaseModel, model_validator


class SentResumeCreate(BaseModel):
    """POST body: exactly one source, a built resume or an uploaded resume,
    and the job posting it went to (Apply, KAN-220). Only a send keeps a sent
    resume: a download keeps nothing (KAN-267), so the posting is required.
    A built resume goes as a PDF; an uploaded resume is its own file."""

    built_resume_id: UUID | None = None
    uploaded_resume_id: UUID | None = None
    job_posting_id: UUID

    @model_validator(mode="after")
    def _one_source(self) -> "SentResumeCreate":
        if (self.built_resume_id is None) == (self.uploaded_resume_id is None):
            raise ValueError("Give exactly one of built_resume_id and uploaded_resume_id")
        return self


class SentResumeResponse(BaseModel):
    """One sent resume as every route answers it."""

    id: UUID
    name: str
    built_resume_id: UUID | None
    uploaded_resume_id: UUID | None
    job_posting_id: UUID | None
    created_at: datetime.datetime
    # The kept file's kind, read from its path: "pdf", or "docx" for a Word
    # download kept before KAN-267.
    format: str

    @classmethod
    def from_row(cls, row) -> "SentResumeResponse":
        """From a Sent_Resume row; `format` from its file's extension."""
        return cls(
            id=row.id, name=row.name, built_resume_id=row.built_resume_id,
            uploaded_resume_id=row.uploaded_resume_id, job_posting_id=row.job_posting_id,
            created_at=row.created_at, format=row.storage_path.rsplit(".", 1)[-1].lower(),
        )


class SentResumeDownload(SentResumeResponse):
    """A kept sent resume and a short-lived link that downloads its file,
    with the characters a fresh render's font could not draw."""

    url: str
    missing_characters: list[str]
