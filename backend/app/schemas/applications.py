import datetime
import uuid
from typing import Literal

from pydantic import BaseModel, Field

from app.models.dto import application_stage
from app.schemas.jobs import JobListing


class JobApplied(BaseModel):
    """GET and POST /jobs/{job_id}/applied: when the signed-in applicant marked
    this job as applied, or null when they haven't."""

    applied_at: datetime.datetime | None


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
