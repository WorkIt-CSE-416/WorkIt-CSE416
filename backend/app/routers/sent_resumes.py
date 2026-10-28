"""Sent resumes under /applicants/{applicant_id}/sent-resumes (KAN-208).
Every route checks the token's account owns `applicant_id` first; another
applicant's sent resume answers 404. The rules (the repeat-hash merge, which
file stays) live in `app/services/sent_resumes.py`. Storage goes through this
module's `get_supabase()`, so tests patch it here.

POST   /applicants/{id}/sent-resumes            SentResumeCreate
       {built_resume_id | uploaded_resume_id, job_posting_id}
       -> 201 SentResumeDownload: Apply (KAN-220), the resume kept as a
          sent resume linked to that posting. A built resume is rendered to
          a PDF; an uploaded resume makes no new file, the sent resume
          points at the uploaded resume's file. Only a send comes through
          here: the editor's Download takes GET .../built-resumes/{rid}/render
          or /docx and keeps nothing (KAN-267), so `job_posting_id` is
          required (422 without it).
       -> 200 SentResumeDownload: the same content was sent to this posting
          before from this built resume; the last sent resume comes back,
          with no new file.
       SentResumeDownload is the sent resume plus its file, as GET .../file
       answers it, and `missing_characters` (the font lacks them; a repeat
       answers []). A built resume keeps no PDF: the sent resume is a
       snapshot (KAN-267), so its file comes back as `data`. 422 unless
       exactly one source is given. 404 for a
       resume that is not the student's or a posting the Jobs page does not
       list (unknown, draft, paused, closed), 503 when the PDF cannot be made.
GET    /applicants/{id}/sent-resumes            -> [SentResumeResponse], newest first;
       `rebuilt` marks one rebuilt from an uploaded file's text (below)
GET    /applicants/{id}/sent-resumes/{sid}/file -> SentResumeFile: a stored file
       as `url`, a 5-minute link that downloads it (`?download=false`: opens
       it in the browser); a snapshot as `data`, the PDF rendered again
       (about 0.3 s), with `rebuilt` and the file's `original_text` when it
       was rebuilt from an uploaded resume replaced or deleted since
       (routers/resumes.py). 503 when the PDF cannot be made, 502 when
       Storage cannot sign the link.
DELETE /applicants/{id}/sent-resumes/{sid}      -> 204. Its file or snapshot goes
       too, unless another sent resume (or, for a file, an uploaded resume)
       uses it. The API never edits a sent resume; replacing or deleting
       its uploaded resume moves it to a snapshot (routers/resumes.py).
"""

import logging
import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_session, get_supabase
from app.deps import owned_applicant
from app.models.sent_resume import Sent_Resume
from app.schemas.sent_resume import (
    SentResumeCreate,
    SentResumeDownload,
    SentResumeFile,
    SentResumeResponse,
)
from app.services import sent_resumes as service
from app.services import stored_files
from app.services.bank import NotFound
from app.services.resume_render import TectonicUnavailable

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/applicants/{applicant_id}/sent-resumes", tags=["sent-resumes"])

_response = SentResumeResponse.from_row
RENDER_FAILED = "The PDF could not be made. Try again."


async def _file(session: AsyncSession, row: Sent_Resume, *, download: bool = True, pdf: bytes | None = None):
    """The row's file, or the HTTP error that says why not."""
    try:
        return await service.open_file(session, get_supabase().storage, row, download=download, pdf=pdf)
    except TectonicUnavailable as exc:
        logger.error("resume render failed: %s", exc)
        raise HTTPException(503, RENDER_FAILED) from exc
    except Exception:
        logger.exception("Failed to sign sent resume URL", extra={"storage_path": row.storage_path})
        raise HTTPException(502, "Could not open the resume")


async def _remove_file(path: str) -> None:
    # After the commit: a failure here orphans a file but loses no record.
    await stored_files.remove(get_supabase, path, "Failed to remove sent resume file")


@router.post("", status_code=201, response_model=SentResumeDownload)
async def send(
    body: SentResumeCreate,
    response: Response,
    applicant_id: uuid.UUID = Depends(owned_applicant),
    session: AsyncSession = Depends(get_session),
) -> SentResumeDownload:
    try:
        if body.uploaded_resume_id is not None:
            sent = await service.send_uploaded(
                session, applicant_id, body.uploaded_resume_id, job_posting_id=body.job_posting_id)
        else:
            sent = await service.send_built(
                session, applicant_id, body.built_resume_id, job_posting_id=body.job_posting_id)
    except NotFound:
        raise HTTPException(404, "Resume not found")
    except TectonicUnavailable as exc:
        logger.error("resume render failed: %s", exc)
        raise HTTPException(503, RENDER_FAILED) from exc

    if sent.created:
        # Nothing to clean up on a failed commit: a send stores no file (a
        # built resume's is a snapshot row, an uploaded resume's is its own).
        try:
            await session.commit()
        except SQLAlchemyError:
            await session.rollback()
            logger.exception("Failed to save the sent resume")
            raise HTTPException(500, "Failed to save the sent resume")
    else:
        response.status_code = 200

    return SentResumeDownload.of(sent.row, await _file(session, sent.row, pdf=sent.pdf), sent.missing_characters)


@router.get("", response_model=list[SentResumeResponse])
async def list_sent(
    applicant_id: uuid.UUID = Depends(owned_applicant),
    session: AsyncSession = Depends(get_session),
) -> list[SentResumeResponse]:
    return [_response(r) for r in await service.list_sent(session, applicant_id)]


@router.get("/{sent_id}/file", response_model=SentResumeFile)
async def open_file(
    sent_id: uuid.UUID,
    download: bool = Query(True),
    applicant_id: uuid.UUID = Depends(owned_applicant),
    session: AsyncSession = Depends(get_session),
) -> SentResumeFile:
    try:
        row = await service.get_sent(session, applicant_id, sent_id)
    except NotFound:
        raise HTTPException(404, "Sent resume not found")
    return SentResumeFile.of(await _file(session, row, download=download))


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
