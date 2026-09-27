"""API endpoint that accepts resume file uploads from frontend"""

import asyncio
import uuid

from fastapi import APIRouter, Depends, HTTPException, UploadFile
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.db import get_session, get_supabase
from app.models.resume import Resume
from app.deps import get_current_account
from app.schemas.auth import AuthenticatedAccount

router = APIRouter()

ALLOWED_TYPES = {
    "application/pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
}
MAX_SIZE = 5 * 1024 * 1024
BUCKET = "Resume"



# Depends grabs get_session before function runs and passes the session into function.
# FastAPI handles the lifecycle
@router.post("/applicants/{applicant_id}/resumes")
async def upload_resume(
    applicant_id: uuid.UUID,
    file: UploadFile,
    account: AuthenticatedAccount = Depends(get_current_account),
    session: AsyncSession = Depends(get_session)
):
    if account.id != applicant_id:
        raise HTTPException(403, "Cannot upload to another applicant's profile")

    if file.content_type not in ALLOWED_TYPES:
        raise HTTPException(400, "Only PDF and DOCX files are accepted")

    # check size metadata
    if file.size is not None and file.size > MAX_SIZE:
        raise HTTPException(413, "File must be under 5 MB")

    contents = await file.read(MAX_SIZE + 1)

    if len(contents) > MAX_SIZE:
        raise HTTPException(413, "File must be under 5 MB")

    # storage path
    ext = ".pdf" if file.content_type == "application/pdf" else ".docx"

    resume_id = uuid.uuid4()
    storage_path = f"{applicant_id}/{resume_id}{ext}"


    # Upload to Storage
    client = get_supabase()
    try:
        await asyncio.to_thread(
            client.storage.from_(BUCKET).upload,
            storage_path,
            contents,
            {"content-type": file.content_type},
        )
    except Exception:
        raise HTTPException(502, "File upload failed")


    # Resume ORM object
    resume = Resume(
        id=resume_id,
        applicant_id=applicant_id,
        original_filename=file.filename,
        storage_path=storage_path,
        status="uploaded",
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
        "storage_path": resume.storage_path,
        "status": resume.status,
    }


@router.get("/applicants/{applicant_id}/resumes")
async def list_resumes(
    applicant_id: uuid.UUID,
    account: AuthenticatedAccount = Depends(get_current_account),
    session: AsyncSession = Depends(get_session),
):
    if account.id != applicant_id:
        raise HTTPException(403, "Cannot access another applicant's resumes")

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
    if account.id != applicant_id:
        raise HTTPException(403, "Cannot delete another applicant's resume")

    resume = (
        await session.execute(
            select(Resume).where(Resume.id == resume_id, Resume.applicant_id == applicant_id)
        )
    ).scalar_one_or_none()

    if not resume:
        raise HTTPException(404, "Resume not found")

    # Delete from Storage first
    client = get_supabase()
    try:
        await asyncio.to_thread(
            client.storage.from_(BUCKET).remove,
            [resume.storage_path],
        )
    except Exception:
        raise HTTPException(502, "Failed to delete file from storage")

    # Then delete the DB row
    try:
        await session.delete(resume)
        await session.commit()
    except Exception:
        await session.rollback()
        raise HTTPException(500, "Failed to delete resume record")

    return {"detail": "Resume deleted"}