"""
Request this job system (KAN-369): the extension's popup, on a job page
WorkIt can't fill, sends the page's host when the student presses it.

POST /job-system-requests  {"host"}
     Stores it and answers {"id"} (201). 422 for any other key, or a host
     that isn't a bare lower-case host name (app/schemas/job_system_requests.py),
     429 past the account's daily cap (JOB_SYSTEM_REQUEST_DAILY_CAP,
     app/services/daily_caps.py: the count names the account, the row doesn't).
     Any signed-in account may send one (sign-in keeps strangers from
     filling the table); the row names no account. The team reads the table
     (SELECT host, count(*) ... GROUP BY host) to rank the next job systems.
"""

from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_session
from app.deps import get_current_account
from app.models.job_system_requests import Job_System_Request
from app.schemas.auth import AuthenticatedAccount
from app.schemas.job_system_requests import JobSystemRequest, JobSystemRequestStored
from app.services.daily_caps import Capped, take_daily

router = APIRouter(tags=["job-system-requests"])


@router.post("/job-system-requests", response_model=JobSystemRequestStored, status_code=status.HTTP_201_CREATED)
async def request_job_system(
    body: JobSystemRequest,
    account: AuthenticatedAccount = Depends(get_current_account),
    db: AsyncSession = Depends(get_session),
) -> JobSystemRequestStored:
    """Stores one request for a job system, by host, with no account."""
    await take_daily(db, account.id, Capped.JOB_SYSTEM_REQUEST)
    row = Job_System_Request(host=body.host)
    db.add(row)
    await db.commit()
    return JobSystemRequestStored(id=str(row.id))
