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
    failed: the form could not be filled (no form, sign-in needed). `note`
    is Desktop's one line on why (KAN-323); it is logged, not kept."""

    outcome: Literal["submitted", "skipped", "failed"]
    note: str | None = Field(None, max_length=500)


class ApplicationStage(BaseModel):
    """Where one job's application stands after a write."""

    job_id: uuid.UUID
    stage: application_stage


# --- WorkIt Desktop (KAN-323, auto-apply/desktop.md) ---
# Stored as sent (application_reviews, desktop_heartbeats), so every string
# and list is capped (routers/CLAUDE.md, "Validate at the boundary").


class ClaimRequest(BaseModel):
    """POST .../applications/claim: how many queued applications a Desktop
    takes at once, one per free Worker."""

    n: int = Field(1, ge=1, le=10)


class ReviewAnswer(BaseModel):
    """One question on the form and what Desktop filled in. `source`: the
    profile, the answer bank, written for this job (`essay`), or missing (no
    fact to answer it with). `facts` are the bank facts an essay's claims
    came from."""

    question: str = Field(max_length=2_000)
    answer: str = Field(max_length=20_000)
    source: Literal["profile", "answer_bank", "written", "missing"]
    essay: bool = False
    facts: list[str] = Field([], max_length=50)


class ReviewResume(BaseModel):
    """The resume an application attached: its name, and its sent resume
    (KAN-267) when it was kept as one."""

    name: str = Field(max_length=500)
    sent_resume_id: uuid.UUID | None = None


class Review(BaseModel):
    """PUT and GET .../applications/{job_id}/review: what Desktop filled
    before it stopped short of Submit. `answers` holds every question on the
    form, in form order; once the student approves, GET answers the approved
    ones. `flags` say why it needs a look (an unsupported claim, a missing
    fact, a read-back mismatch); `note` is Desktop's one-line summary."""

    answers: list[ReviewAnswer] = Field(max_length=300)
    resume: ReviewResume | None = None
    cover_letter: str | None = Field(None, max_length=20_000)
    flags: list[str] = Field([], max_length=50)
    note: str | None = Field(None, max_length=500)
    filled_at: datetime.datetime


class ApproveRequest(BaseModel):
    """POST .../applications/{job_id}/approve: the answers the student
    approved, edited or not. Empty keeps the review's own."""

    answers: list[ReviewAnswer] = Field([], max_length=300)


class DesktopUsage(BaseModel):
    """The student's Claude usage, as Desktop reads it: the share of the
    5-hour and the weekly limit used."""

    five_hour: float = Field(ge=0)
    weekly: float = Field(ge=0)


class DesktopBeat(BaseModel):
    """PUT .../desktop, every 15 s: how many Workers Desktop runs and how
    many are filling, its usage (null when it can't read it) and its
    version."""

    workers: int = Field(ge=0, le=10)
    busy: int = Field(ge=0, le=10)
    usage: DesktopUsage | None = None
    version: str = Field(max_length=50)

    @model_validator(mode="after")
    def _busy_within_workers(self) -> "DesktopBeat":
        # The table's CHECK refuses it too; a 422 here says why.
        if self.busy > self.workers:
            raise ValueError("busy can't exceed workers")
        return self


class DesktopStatus(BaseModel):
    """GET and PUT .../desktop: whether the applicant's Desktop is running.
    `online` is a beat in the last 45 s; `last_seen` null and the counts 0
    when it never beat."""

    online: bool
    last_seen: datetime.datetime | None
    workers: int
    busy: int
    usage: DesktopUsage | None
