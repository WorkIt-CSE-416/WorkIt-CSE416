"""
The jobs an applicant has marked as applied (KAN-232), one job_applications
row each. The job posting's page reads and sets it with its Applied button;
GET /jobs, /jobs/count and /jobs/recommended leave those jobs out for that
applicant (routers/jobs.py, JobFilters.applied_by).

GET  /jobs/{job_id}/applied  {"applied_at": null} until the applicant marks it.
POST /jobs/{job_id}/applied  marks it, and answers when. Marking it again
                             keeps the first date: the day they applied
                             doesn't move.

Applicant accounts only (403 for a company's); the applicant is the token's,
never a path or body field. A job that isn't open (closed, a company's own,
no such job) is a 404 to mark, as GET /jobs/{job_id} is to read.

Its own router, beside jobs.py's, for the same /jobs prefix: the two paths
here have one more segment than GET /jobs/{job_id}, so neither shadows the
other whatever the order they're registered in.
"""

import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_session
from app.deps import get_current_account
from app.models.applications import Job_Application
from app.models.dto import job_post_status
from app.models.jobs import Job_Post
from app.schemas.applications import JobApplied
from app.schemas.auth import AccountType, AuthenticatedAccount

router = APIRouter(prefix="/jobs", tags=["applications"])


def _applicant_only(account: AuthenticatedAccount) -> uuid.UUID:
    if account.account_type is not AccountType.APPLICANT:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only applicants can track applications.")
    return account.id


async def _applied_at(db: AsyncSession, applicant_id: uuid.UUID, job_id: uuid.UUID):
    return await db.scalar(
        select(Job_Application.applied_at).where(
            Job_Application.applicant_id == applicant_id,
            Job_Application.job_id == job_id,
        )
    )


@router.get("/{job_id}/applied", response_model=JobApplied)
async def get_applied(
    job_id: uuid.UUID,
    account: AuthenticatedAccount = Depends(get_current_account),
    db: AsyncSession = Depends(get_session),
) -> JobApplied:
    """When the signed-in applicant marked this job as applied, if they have."""
    applicant_id = _applicant_only(account)
    return JobApplied(applied_at=await _applied_at(db, applicant_id, job_id))


@router.post("/{job_id}/applied", response_model=JobApplied)
async def mark_applied(
    job_id: uuid.UUID,
    account: AuthenticatedAccount = Depends(get_current_account),
    db: AsyncSession = Depends(get_session),
) -> JobApplied:
    """Marks this job as applied for the signed-in applicant."""
    applicant_id = _applicant_only(account)
    # The same jobs GET /jobs/{job_id} shows: a seeker can't apply to the rest.
    listed = await db.scalar(
        select(Job_Post.id).where(
            Job_Post.id == job_id,
            Job_Post.company_id.is_(None),
            Job_Post.status == job_post_status.published,
        )
    )
    if listed is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "That job isn't open any more.")

    # DO NOTHING on a second click (or two tabs at once), so the first date stays.
    await db.execute(
        insert(Job_Application)
        .values(applicant_id=applicant_id, job_id=job_id)
        .on_conflict_do_nothing(index_elements=["applicant_id", "job_id"])
    )
    await db.commit()
    return JobApplied(applied_at=await _applied_at(db, applicant_id, job_id))
