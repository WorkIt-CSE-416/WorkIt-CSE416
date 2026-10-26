import datetime
import uuid
from typing import Literal

from pydantic import BaseModel, Field, model_validator

from app.models.dto import application_stage
from app.schemas.jobs import Highlight, JobListing
from app.schemas.sent_resume import SentResumeResponse


class JobApplied(BaseModel):
    """GET and POST /jobs/{job_id}/applied: when the signed-in applicant marked
    this job as applied, or null when they haven't, and the sent resume the
    application names (KAN-267), or null."""

    applied_at: datetime.datetime | None
    sent_resume_id: uuid.UUID | None = None


class MarkApplied(BaseModel):
    """POST /jobs/{job_id}/applied's optional body: the sent resume the
    application went out with, or null for none. Leaving the key out keeps
    the one it names (the route reads `model_fields_set`)."""

    sent_resume_id: uuid.UUID | None = None


class JobSaved(BaseModel):
    """POST /jobs/{job_id}/saved: the job's stage after the save. saved, or
    the stage it already had (queued, applied...), which saving keeps."""

    stage: application_stage


# --- Auto apply (routers/auto_apply.py) ---


class ChooseResume(BaseModel):
    """PUT .../applications/{job_id}/resume: the resume one queued application
    goes out with (KAN-359), exactly one of a built or an uploaded resume."""

    built_resume_id: uuid.UUID | None = None
    uploaded_resume_id: uuid.UUID | None = None

    @model_validator(mode="after")
    def _exactly_one(self) -> "ChooseResume":
        if (self.built_resume_id is None) == (self.uploaded_resume_id is None):
            raise ValueError("Name exactly one of built_resume_id or uploaded_resume_id.")
        return self


class Application(BaseModel):
    """One job in the applicant's auto apply list: the job posting as the Jobs
    page's card has it, and where its application stands."""

    job: JobListing
    stage: application_stage
    # When it was queued (or marked applied): the queue's order.
    added_at: datetime.datetime
    applied_at: datetime.datetime | None
    # The sent resume it went out with (KAN-267): job_applications'
    # `sent_resume_id`, null when none was sent or it was since deleted.
    sent_resume: SentResumeResponse | None = None
    # False once the job posting has closed: the extension skips it.
    open: bool
    # The Jobs page's match score (0-100) for this job posting, on ?scored=true
    # only (KAN-256). Null otherwise, for a closed job posting, and while the
    # experience bank is empty.
    match: int | None = None
    # Up to 3 reasons behind `match`, as the Jobs page card lists them; empty
    # whenever `match` is null.
    highlights: list[Highlight] = []


class BatchRequest(BaseModel):
    """POST .../auto-apply/batches: how many matches to queue."""

    size: int = Field(10, ge=1, le=50)


class BatchQueued(BaseModel):
    """The job ids the batch queued, best match first. Fewer than asked when
    fewer matches are left."""

    queued: list[str]


class QueueRequest(BaseModel):
    """POST .../applications: one job posting to queue."""

    job_id: uuid.UUID


class FinishRequest(BaseModel):
    """POST .../applications/{job_id}/finish: how the fill ended. submitted:
    the student clicked Submitted. skipped: Skip, or the tab was closed.
    failed: the form could not be filled (no form, sign-in needed)."""

    outcome: Literal["submitted", "skipped", "failed"]


class ApplicationStage(BaseModel):
    """Where one job's application stands after a write."""

    job_id: uuid.UUID
    stage: application_stage
