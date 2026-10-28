"""
The jobs an applicant has marked as applied (KAN-232) or saved (KAN-261), one
job_applications row each. The job posting's page reads and sets the first
with its Applied button, and every job surface the second with its Save
button. GET /jobs, /jobs/count and /jobs/recommended leave the applied jobs
out for that applicant (queries/jobs/filters.py, JobFilters.applied_by); a
saved job stays in, with its Save button filled.

GET  /jobs/{job_id}/applied  {"applied_at": null, "sent_resume_id": null}
                             until the applicant marks it.
POST /jobs/{job_id}/applied  marks it, and answers when and with which sent
                             resume. Body (optional, KAN-267):
                             {"sent_resume_id": "<id>"} names the resume it
                             went out with, which must be the applicant's
                             and sent to this job (404 otherwise); null says
                             none was sent; no body (or no key) leaves the
                             one named as it is. A job queued for auto apply
                             becomes applied. Marking it again keeps the
                             first date: the day they applied doesn't move,
                             while the resume can change. A saved job
                             becomes applied.
POST   /jobs/{job_id}/saved  the Save button: keeps the job as saved and
                             answers {"stage": "saved"}. A job that already
                             has an application keeps it and answers that
                             stage (queued, applied...): saving never moves
                             one back.
DELETE /jobs/{job_id}/saved  takes it back out of saved: 204, and also when
                             it was never saved. 409 when it is past saved
                             (queued, applied...): that is a record, not a
                             bookmark.
POST /jobs/saved-by-link     {"url": "<the page's link>"}: the extension's
                             Save to WorkIt on a site it can't fill
                             (KAN-401). Saves the feed's listed job whose
                             apply link is that page (the same link first,
                             else the same one without query, fragment and
                             trailing slash) as POST /jobs/{job_id}/saved
                             does, and answers {"job_id", "stage"}. 404
                             "WorkIt doesn't list this job yet." when no
                             listed job has that link.

The Applications board reads saved and applied jobs through auto apply's
list, GET /applicants/{id}/applications?stage=saved&stage=applied
(routers/auto_apply.py).

Applicant accounts only (403 for a company's); the applicant is the token's,
never a path or body field. A job that isn't open (closed, a company's own,
no such job) is a 404 to mark or save, as GET /jobs/{job_id} is to read.

Its own router, beside jobs.py's, for the same /jobs prefix. The
/jobs/{job_id}/... paths have one more segment than GET /jobs/{job_id}, and
POST /jobs/saved-by-link has the same two segments but a method jobs.py
never serves (its routes are all GETs), so neither router shadows the other
whatever the order they're registered in. A GET on a two-segment path here
would need registering before jobs.py's catch-all (routers/CLAUDE.md).
"""

import uuid

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_session
from app.deps import get_current_account
from app.queries.applications import (
    KEEP,
    application_stage_of,
    fetch_applied,
    listed_job_by_link,
    mark_applied,
    save_job,
    sent_to_job,
    unsave_job,
)
from app.schemas.applications import (
    JobApplied,
    JobByLink,
    JobSaved,
    JobSavedByLink,
    MarkApplied,
    SaveByLink,
)
from app.schemas.auth import AccountType, AuthenticatedAccount

router = APIRouter(prefix="/jobs", tags=["applications"])


def _applicant_only(account: AuthenticatedAccount) -> uuid.UUID:
    if account.account_type is not AccountType.APPLICANT:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only applicants can track applications.")
    return account.id


@router.get("/{job_id}/applied", response_model=JobApplied)
async def get_applied(
    job_id: uuid.UUID,
    account: AuthenticatedAccount = Depends(get_current_account),
    db: AsyncSession = Depends(get_session),
) -> JobApplied:
    """When the signed-in applicant marked this job as applied, if they have,
    and with which sent resume."""
    applicant_id = _applicant_only(account)
    return JobApplied(**(await fetch_applied(db, applicant_id, job_id))._asdict())


@router.post("/{job_id}/applied", response_model=JobApplied)
async def post_applied(
    job_id: uuid.UUID,
    body: MarkApplied | None = None,
    account: AuthenticatedAccount = Depends(get_current_account),
    db: AsyncSession = Depends(get_session),
) -> JobApplied:
    """Marks this job as applied for the signed-in applicant, with the sent
    resume the body names, if it names one."""
    applicant_id = _applicant_only(account)
    sent_resume_id = KEEP
    if body is not None and "sent_resume_id" in body.model_fields_set:
        sent_resume_id = body.sent_resume_id
        if sent_resume_id is not None and not await sent_to_job(db, applicant_id, job_id, sent_resume_id):
            raise HTTPException(status.HTTP_404_NOT_FOUND, "That resume wasn't sent to this job.")
    if await mark_applied(db, applicant_id, job_id, sent_resume_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "That job isn't open any more.")
    return JobApplied(**(await fetch_applied(db, applicant_id, job_id))._asdict())


@router.post("/saved-by-link", response_model=JobSavedByLink)
async def post_saved_by_link(
    body: SaveByLink,
    account: AuthenticatedAccount = Depends(get_current_account),
    db: AsyncSession = Depends(get_session),
) -> JobSavedByLink:
    """Saves the job whose apply link is the page the student is on: the
    extension's Save to WorkIt on a site it can't fill (KAN-401)."""
    applicant_id = _applicant_only(account)
    job_id = await listed_job_by_link(db, body.url)
    if job_id is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "WorkIt doesn't list this job yet.")
    stage = await save_job(db, applicant_id, job_id)
    if stage is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "WorkIt doesn't list this job yet.")
    return JobSavedByLink(job_id=job_id, stage=stage)


@router.post("/listed-by-link", response_model=JobByLink)
async def post_listed_by_link(
    body: SaveByLink,
    account: AuthenticatedAccount = Depends(get_current_account),
    db: AsyncSession = Depends(get_session),
) -> JobByLink:
    """The listed job whose apply link is the page the student is on, and
    their stage for it: the extension's Track on WorkIt asks before it
    offers to track (KAN-424). Writes nothing. A POST so the page's link
    travels in the body, never a URL's query."""
    applicant_id = _applicant_only(account)
    job_id = await listed_job_by_link(db, body.url)
    if job_id is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "WorkIt doesn't list this job yet.")
    return JobByLink(job_id=job_id, stage=await application_stage_of(db, applicant_id, job_id))


@router.post("/{job_id}/saved", response_model=JobSaved)
async def post_saved(
    job_id: uuid.UUID,
    account: AuthenticatedAccount = Depends(get_current_account),
    db: AsyncSession = Depends(get_session),
) -> JobSaved:
    """Saves this job for the signed-in applicant."""
    applicant_id = _applicant_only(account)
    stage = await save_job(db, applicant_id, job_id)
    if stage is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "That job isn't open any more.")
    return JobSaved(stage=stage)


@router.delete("/{job_id}/saved", status_code=status.HTTP_204_NO_CONTENT)
async def delete_saved(
    job_id: uuid.UUID,
    account: AuthenticatedAccount = Depends(get_current_account),
    db: AsyncSession = Depends(get_session),
) -> Response:
    """Takes this job out of the signed-in applicant's saved jobs."""
    applicant_id = _applicant_only(account)
    stage = await unsave_job(db, applicant_id, job_id)
    if stage is not None:
        raise HTTPException(
            status.HTTP_409_CONFLICT, f"That job is {stage}, so it stays in your applications."
        )
    return Response(status_code=status.HTTP_204_NO_CONTENT)
