"""API endpoint that accepts resume file uploads from frontend"""

import asyncio
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, UploadFile
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.db import get_session, get_supabase
from app.models.resume import Resume
from app.models.dto import ResumeStatus
from app.deps import get_current_account
from app.schemas.auth import AccountType, AuthenticatedAccount

router = APIRouter()

MAX_SIZE = 5 * 1024 * 1024
BUCKET = "Resume"
PDF_MAGIC = b"%PDF"
DOCX_MAGIC = b"PK\x03\x04"


def _assert_applicant_owns(account: AuthenticatedAccount, applicant_id: uuid.UUID) -> None:
    """Shared ownership guard for all resume endpoints."""
    if account.account_type != AccountType.APPLICANT or account.id != applicant_id:
        raise HTTPException(403, "Forbidden")


# Depends grabs get_session before function runs and passes the session into function.
# FastAPI handles the lifecycle
@router.post("/applicants/{applicant_id}/resumes")
async def upload_resume(
    applicant_id: uuid.UUID,
    file: UploadFile,
    account: AuthenticatedAccount = Depends(get_current_account),
    session: AsyncSession = Depends(get_session)
):
    _assert_applicant_owns(account, applicant_id)

    # check size metadata
    if file.size is not None and file.size > MAX_SIZE:
        raise HTTPException(413, "File must be under 5 MB")

    contents = await file.read(MAX_SIZE + 1)

    if len(contents) > MAX_SIZE:
        raise HTTPException(413, "File must be under 5 MB")

    # validate magic bytes — content_type is client-supplied and untrustworthy
    if contents.startswith(PDF_MAGIC):
        ext = ".pdf"
        mime = "application/pdf"
    elif contents.startswith(DOCX_MAGIC):
        ext = ".docx"
        mime = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    else:
        raise HTTPException(400, "Only PDF and DOCX files are accepted")

    resume_id = uuid.uuid4()
    storage_path = f"{applicant_id}/{resume_id}{ext}"


    # Upload to Storage
    client = get_supabase()
    try:
        await asyncio.to_thread(
            client.storage.from_(BUCKET).upload,
            storage_path,
            contents,
            {"content-type": mime},
        )
    except Exception:
        raise HTTPException(502, "File upload failed")


    # Resume ORM object
    resume = Resume(
        id=resume_id,
        applicant_id=applicant_id,
        original_filename=file.filename,
        storage_path=storage_path,
        status=ResumeStatus.uploaded,
        created_at=datetime.now(timezone.utc),
    )

    # track for insertion
    session.add(resume)
    # send SQL to Postgres and commit transaction
    try:
        await session.commit()
    except Exception:
        await session.rollback()
        # DB failed - remove the file from Storage
        await asyncio.to_thread(
            client.storage.from_(BUCKET).remove,
            [storage_path],
        )
        raise HTTPException(500, "Failed to save resume record")

    return {
        "id": str(resume.id),
        "applicant_id": str(resume.applicant_id),
        "original_filename": resume.original_filename,
        "storage_path": resume.storage_path,
        "status": resume.status,
        "created_at": resume.created_at.isoformat() if resume.created_at else None,
    }


@router.get("/applicants/{applicant_id}/resumes")
async def list_resumes(
    applicant_id: uuid.UUID,
    account: AuthenticatedAccount = Depends(get_current_account),
    session: AsyncSession = Depends(get_session),
):
    _assert_applicant_owns(account, applicant_id)

    result = await session.execute(
        select(Resume)
        .where(Resume.applicant_id == applicant_id)
        .order_by(Resume.created_at.desc())
    )

    resumes = result.scalars().all()

    return [
        {
            "id": str(r.id),
            "original_filename": r.original_filename,
            "storage_path": r.storage_path,
            "status": r.status,
            "created_at": r.created_at.isoformat() if r.created_at else None,
        }
        for r in resumes
    ]

@router.delete("/applicants/{applicant_id}/resumes/{resume_id}")
async def delete_resume(
    applicant_id: uuid.UUID,
    resume_id: uuid.UUID,
    account: AuthenticatedAccount = Depends(get_current_account),
    session: AsyncSession = Depends(get_session),
):
    _assert_applicant_owns(account, applicant_id)

    resume = (
        await session.execute(
            select(Resume).where(Resume.id == resume_id, Resume.applicant_id == applicant_id)
        )
    ).scalar_one_or_none()

    if not resume:
        raise HTTPException(404, "Resume not found")

    # Delete DB row first (reversible via rollback), then Storage
    storage_path = resume.storage_path
    try:
        await session.delete(resume)
        await session.commit()
    except Exception:
        await session.rollback()
        raise HTTPException(500, "Failed to delete resume record")

    # DB succeeded — now remove the file from Storage
    # If this fails the file is orphaned, but no data is lost
    client = get_supabase()
    try:
        await asyncio.to_thread(
            client.storage.from_(BUCKET).remove,
            [storage_path],
        )
    except Exception:
        pass  # ponytail: orphaned file in Storage; add cleanup job if this becomes a problem

    return {"detail": "Resume deleted"}