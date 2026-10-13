"""Request/response shapes for sent resumes (KAN-208)."""

import datetime
from uuid import UUID

from pydantic import BaseModel, model_validator


class SentResumeCreate(BaseModel):
    """POST body: exactly one source, a built resume (a PDF download, or
    Apply) or an uploaded resume (Apply only), and for Apply the job posting
    the sent resume is linked to (KAN-220)."""

    built_resume_id: UUID | None = None
    uploaded_resume_id: UUID | None = None
    job_posting_id: UUID | None = None

    @model_validator(mode="after")
    def _one_source(self) -> "SentResumeCreate":
        if (self.built_resume_id is None) == (self.uploaded_resume_id is None):
            raise ValueError("Give exactly one of built_resume_id and uploaded_resume_id")
        return self


class SentResumeResponse(BaseModel):
    id: UUID
    name: str
    built_resume_id: UUID | None
    uploaded_resume_id: UUID | None
    job_posting_id: UUID | None
    created_at: datetime.datetime


class SentResumeDownload(SentResumeResponse):
    """A kept sent resume and a short-lived link that downloads its file,
    with the characters a fresh render's font could not draw."""

    url: str
    missing_characters: list[str]
