"""Sent resumes under /applicants/{applicant_id}/sent-resumes (KAN-208).
Every route checks the token's account owns `applicant_id` first; another
applicant's sent resume answers 404. The rules (the repeat-hash merge, which
file stays) live in `app/services/sent_resumes.py`. Storage goes through this
module's `get_supabase()`, so tests patch it here.

POST   /applicants/{id}/sent-resumes            SentResumeCreate {built_resume_id}
       -> 201 SentResumeDownload: a PDF download, kept as a sent resume.
       -> 200 SentResumeDownload: the same content was sent before from this
          built resume; the last sent resume comes back, with no new file.
       SentResumeDownload is the sent resume plus `url` (a 5-minute link that
       downloads the file) and `missing_characters` (the font lacks them; a
       repeat answers []). 404 for a built resume that is not the student's,
       503 when the PDF cannot be made, 502 when Storage refuses the file.
GET    /applicants/{id}/sent-resumes            -> [SentResumeResponse], newest first
GET    /applicants/{id}/sent-resumes/{sid}/file -> {"url"}: a 5-minute download link
DELETE /applicants/{id}/sent-resumes/{sid}      -> 204. Its file goes too, unless
       another sent resume or an uploaded resume uses it. Sent resumes are
       never edited.
"""

import asyncio
import logging
import uuid

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_session, get_supabase
from app.deps import assert_applicant_owns, get_current_account
from app.models.sent_resume import Sent_Resume
from app.schemas.auth import AuthenticatedAccount
from app.schemas.sent_resume import (
    SentResumeCreate,
    SentResumeDownload,
    SentResumeResponse,
)
from app.services import sent_resumes as service
from app.services.bank import NotFound
from app.services.resume_render import TectonicUnavailable

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/applicants/{applicant_id}/sent-resumes", tags=["sent-resumes"])

FILE_URL_TTL_SECONDS = 5 * 60


async def owned_applicant(
    applicant_id: uuid.UUID,
    account: AuthenticatedAccount = Depends(get_current_account),
) -> uuid.UUID:
    assert_applicant_owns(account, applicant_id)
    return applicant_id


def _response(row: Sent_Resume) -> SentResumeResponse:
    return SentResumeResponse(
        id=row.id, name=row.name, built_resume_id=row.built_resume_id,
        uploaded_resume_id=row.uploaded_resume_id, job_posting_id=row.job_posting_id,
        created_at=row.created_at,
    )


async def _signed_url(row: Sent_Resume) -> str:
    try:
        signed = await asyncio.to_thread(
            get_supabase().storage.from_(service.BUCKET).create_signed_url,
            row.storage_path,
            FILE_URL_TTL_SECONDS,
            {"download": service.download_name(row)},
        )
    except Exception:
        logger.exception("Failed to sign sent resume URL", extra={"storage_path": row.storage_path})
        raise HTTPException(502, "Could not open the resume")
    return signed.get("signedUrl")


async def _remove_file(path: str) -> None:
    # After the commit: a failure here orphans a file but loses no record.
    try:
        await asyncio.to_thread(get_supabase().storage.from_(service.BUCKET).remove, [path])
    except Exception:
        logger.exception("Failed to remove sent resume file", extra={"storage_path": path})


@router.post("", status_code=201, response_model=SentResumeDownload)
async def send(
    body: SentResumeCreate,
    response: Response,
    applicant_id: uuid.UUID = Depends(owned_applicant),
    session: AsyncSession = Depends(get_session),
) -> SentResumeDownload:
    try:
        sent = await service.send_built(session, get_supabase().storage, applicant_id, body.built_resume_id)
    except NotFound:
        raise HTTPException(404, "Resume not found")
    except TectonicUnavailable as exc:
        logger.error("resume render failed: %s", exc)
        raise HTTPException(503, "The PDF could not be made. Try again, or download the Word file.") from exc
    except SQLAlchemyError:
        raise
    except Exception:
        logger.exception("Storage upload of a sent resume failed")
        raise HTTPException(502, "The PDF could not be saved. Try again.")

    if sent.created:
        try:
            await session.commit()
        except SQLAlchemyError:
            await session.rollback()
            logger.exception("Failed to save the sent resume")
            await _remove_file(sent.row.storage_path)
            raise HTTPException(500, "Failed to save the sent resume")
    else:
        response.status_code = 200

    return SentResumeDownload(
        **_response(sent.row).model_dump(),
        url=await _signed_url(sent.row),
        missing_characters=list(sent.missing_characters),
    )


@router.get("", response_model=list[SentResumeResponse])
async def list_sent(
    applicant_id: uuid.UUID = Depends(owned_applicant),
    session: AsyncSession = Depends(get_session),
) -> list[SentResumeResponse]:
    return [_response(r) for r in await service.list_sent(session, applicant_id)]


@router.get("/{sent_id}/file")
async def file_url(
    sent_id: uuid.UUID,
    applicant_id: uuid.UUID = Depends(owned_applicant),
    session: AsyncSession = Depends(get_session),
) -> dict[str, str]:
    try:
        row = await service.get_sent(session, applicant_id, sent_id)
    except NotFound:
        raise HTTPException(404, "Sent resume not found")
    return {"url": await _signed_url(row)}


@router.delete("/{sent_id}", status_code=204)
async def delete_sent(
    sent_id: uuid.UUID,
    applicant_id: uuid.UUID = Depends(owned_applicant),
    session: AsyncSession = Depends(get_session),
) -> Response:
    try:
        orphan = await service.delete_sent(session, applicant_id, sent_id)
    except NotFound:
        raise HTTPException(404, "Sent resume not found")
    try:
        await session.commit()
    except SQLAlchemyError:
        await session.rollback()
        logger.exception("Failed to delete the sent resume")
        raise HTTPException(500, "Failed to delete the sent resume")
    if orphan:
        await _remove_file(orphan)
    return Response(status_code=204)
