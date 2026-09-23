"""API endpoint that accepts resume file uploads from frontend"""

import asyncio
import uuid

from fastapi import APIRouter, Depends, HTTPException, UploadFile
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_session, get_supabase
from app.models.resume import Resume

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
async def upload_resume(applicant_id: uuid.UUID, file: UploadFile, session: AsyncSession = Depends(get_session)):

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
    except SQLAlchemyError as exc:
        await session.rollback()
        # DB failed - remove the file from Storage
        await asyncio.to_thread(
            client.storage.from_(BUCKET).remove,
            [storage_path],
        )
        raise HTTPException(500, "Failed to save resume record") from exc

    return {
        "id": str(resume.id),
        "applicant_id": str(resume.applicant_id),
        "storage_path": resume.storage_path,
        "status": resume.status,
    }
