"""Request/response shapes for sent resumes (KAN-208)."""

import datetime
from uuid import UUID

from pydantic import BaseModel


class SentResumeCreate(BaseModel):
    """POST body: the built resume to download."""

    built_resume_id: UUID


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
