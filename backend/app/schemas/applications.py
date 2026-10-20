import datetime
import uuid
from typing import Literal

from pydantic import BaseModel, Field

from app.models.dto import application_stage
from app.schemas.jobs import Highlight, JobListing


class JobApplied(BaseModel):
    """GET and POST /jobs/{job_id}/applied: when the signed-in applicant marked
    this job as applied, or null when they haven't."""

    applied_at: datetime.datetime | None


class JobSaved(BaseModel):
    """POST /jobs/{job_id}/saved: the job's stage after the save. saved, or
    the stage it already had (queued, applied...), which saving keeps."""

    stage: application_stage


# --- Auto apply (routers/auto_apply.py) ---


class Application(BaseModel):
    """One job in the applicant's auto apply list: the job posting as the Jobs
    page's card has it, and where its application stands."""

    job: JobListing
    stage: application_stage
    # When it was queued (or marked applied): the queue's order.
    added_at: datetime.datetime
    applied_at: datetime.datetime | None
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
