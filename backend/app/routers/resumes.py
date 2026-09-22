"""API endpoint that accepts resume file uploads from frontend"""

import uuid
from fastapi import APIRouter, UploadFile, HTTPException, Depends

from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_session
from app.storage import get_supabase
from app.models.resume import Resume

router = APIRouter()

ALLOWED_TYPES = {
    "application/pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
}
MAX_SIZE = 5 * 1024 * 1024
BUCKET = "resumes"



# Depends grabs get_session before function runs and passes the session into function.
# FastAPI handles the lifecycle
@router.post("/applicants/{applicant_id}/resumes")
async def upload_resume(applicant_id: uuid.UUID, file: UploadFile, session: AsyncSession = Depends(get_session)):

    if file.content_type not in ALLOWED_TYPES:
        raise HTTPException(400, "Only PDF and DOCX files are accepted")

    contents = await file.read()

    if len(contents) > MAX_SIZE:
        raise HTTPException(413, "File must be under 5 MB")

    # storage path
    storage_path = f"{applicant_id}/{uuid.uuid4()}_{file.filename}"


    # Upload
    client = get_supabase()

    client.storage.from_(BUCKET).upload(
        storage_path,
        contents,
        {"content-type": file.content_type},
    )

    # Resume ORM object
    resume = Resume(
        applicant_id=applicant_id,
        original_filename=file.filename,
        storage_path=storage_path,
        status="uploaded",
    )

    # track for insertion
    session.add(resume)
    # send SQL to Postgres and commit transaction
    await session.commit()
    # pulls Postgres generated values
    await session.refresh(resume)


    return {
        "id": str(resume.id),
        "applicant_id": str(resume.applicant_id),
        "storage_path": resume.storage_path,
        "status": resume.status,
    }
