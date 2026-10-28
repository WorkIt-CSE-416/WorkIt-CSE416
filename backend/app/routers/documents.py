"""Student documents under /applicants/{applicant_id}/documents (KAN-369).

Files a form asks for besides the resume, one per kind for each student.
The only kind is `transcript`: an unofficial transcript, which some forms
require. Kept as an uploaded resume is (`resumes.py`), in the same `Resume`
bucket under the student's folder, so Delete Account removes it; nothing
reads its text.

`GET .../documents` lists the student's documents (`kind`,
`original_filename`, `created_at`). `PUT .../documents/{kind}` (a file: PDF
or DOCX, under 5 MB, the resume upload's checks) uploads it or replaces the
one there; the old file is removed. `GET .../documents/{kind}/bytes` returns
the file from this API's own origin, for the Chrome autofiller to attach
(as `resumes.py`'s `.../bytes`). `DELETE .../documents/{kind}` removes the
row and its file (204). A row whose `storage_path` is `local:<name>`
(services/local_files.py, development only) is served from
LOCAL_FILES_DIR and never sent to or removed from Storage
(services/stored_files.py).
"""
import asyncio
import logging
import uuid
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Response, UploadFile
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_session, get_supabase
from app.deps import assert_applicant_owns, get_current_account
from app.models.documents import Student_Document
from app.schemas.auth import AuthenticatedAccount
from app.services import stored_files
from app.services.stored_files import BUCKET
from app.services.text_extraction import UploadRejected
from app.services.text_extraction import read_upload as _read_upload

router = APIRouter()
logger = logging.getLogger(__name__)

Kind = Literal["transcript"]


def _item(doc: Student_Document) -> dict:
    return {
        "kind": doc.kind,
        "original_filename": doc.original_filename,
        "created_at": doc.created_at.isoformat() if doc.created_at else None,
    }


async def _get(session: AsyncSession, applicant_id: uuid.UUID, kind: str) -> Student_Document | None:
    return await session.get(Student_Document, (applicant_id, kind))


async def _remove_file(storage_path: str) -> None:
    await stored_files.remove(get_supabase, storage_path, "Failed to remove a document file from Storage")


@router.get("/applicants/{applicant_id}/documents")
async def list_documents(
    applicant_id: uuid.UUID,
    account: AuthenticatedAccount = Depends(get_current_account),
    session: AsyncSession = Depends(get_session),
):
    assert_applicant_owns(account, applicant_id)
    docs = await session.scalars(
        select(Student_Document).where(Student_Document.applicant_id == applicant_id).order_by(Student_Document.kind))
    return [_item(d) for d in docs]


@router.put("/applicants/{applicant_id}/documents/{kind}")
async def put_document(
    applicant_id: uuid.UUID,
    kind: Kind,
    file: UploadFile,
    account: AuthenticatedAccount = Depends(get_current_account),
    session: AsyncSession = Depends(get_session),
):
    assert_applicant_owns(account, applicant_id)
    try:
        contents, ext, mime = await _read_upload(file)
    except UploadRejected as exc:
        raise HTTPException(exc.status, str(exc)) from exc

    storage_path = f"{applicant_id}/documents/{uuid.uuid4()}{ext}"
    try:
        await asyncio.to_thread(
            get_supabase().storage.from_(BUCKET).upload, storage_path, contents, {"content-type": mime})
    except Exception:
        logger.exception("Storage upload failed", extra={"storage_path": storage_path})
        raise HTTPException(502, "File upload failed")

    doc = await _get(session, applicant_id, kind)
    old_path = doc.storage_path if doc else None
    if doc is None:
        doc = Student_Document(applicant_id=applicant_id, kind=kind)
        session.add(doc)
    doc.original_filename = file.filename or f"{kind}{ext}"
    doc.storage_path = storage_path
    try:
        await session.commit()
    except Exception:
        await session.rollback()
        await _remove_file(storage_path)
        logger.exception("Failed to save a document", extra={"kind": kind})
        raise HTTPException(500, "Failed to save the document")
    await session.refresh(doc)
    if old_path:
        await _remove_file(old_path)
    return _item(doc)


@router.get("/applicants/{applicant_id}/documents/{kind}/bytes")
async def get_document_bytes(
    applicant_id: uuid.UUID,
    kind: Kind,
    account: AuthenticatedAccount = Depends(get_current_account),
    session: AsyncSession = Depends(get_session),
) -> Response:
    assert_applicant_owns(account, applicant_id)
    doc = await _get(session, applicant_id, kind)
    if doc is None:
        raise HTTPException(404, "Document not found")
    try:
        data = await stored_files.read(get_supabase, doc.storage_path)
    except Exception:
        logger.exception("Failed to download a document", extra={"storage_path": doc.storage_path})
        raise HTTPException(502, "Could not open the document")
    if data is None:
        raise HTTPException(404, "Document not found")
    return Response(
        data,
        media_type=stored_files.media_type(doc.storage_path),
        headers={"Content-Disposition": stored_files.attachment(doc.original_filename)},
    )


@router.delete("/applicants/{applicant_id}/documents/{kind}", status_code=204)
async def delete_document(
    applicant_id: uuid.UUID,
    kind: Kind,
    account: AuthenticatedAccount = Depends(get_current_account),
    session: AsyncSession = Depends(get_session),
) -> Response:
    assert_applicant_owns(account, applicant_id)
    doc = await _get(session, applicant_id, kind)
    if doc is None:
        raise HTTPException(404, "Document not found")
    storage_path = doc.storage_path
    try:
        await session.delete(doc)
        await session.commit()
    except Exception:
        await session.rollback()
        raise HTTPException(500, "Failed to delete the document")
    await _remove_file(storage_path)
    return Response(status_code=204)
