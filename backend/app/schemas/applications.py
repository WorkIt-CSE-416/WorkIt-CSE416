import datetime

from pydantic import BaseModel


class JobApplied(BaseModel):
    """GET and POST /jobs/{job_id}/applied: when the signed-in applicant marked
    this job as applied, or null when they haven't."""

    applied_at: datetime.datetime | None
