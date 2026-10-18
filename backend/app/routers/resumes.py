"""Resumes under /applicants/{applicant_id}/resumes: upload, list, delete.

Upload (POST) extracts text from a PDF or DOCX into `raw_text`, always from
the file (the client never sends parsed content), reads it with the
heuristic parser and writes what it read into the experience bank with
`services/bank.py`'s `merge_import`, in the same transaction as the row
(ADR 0003). The response's `bank` says what it wrote (`ImportResult`); the
parser's reading is not kept anywhere else. The model never reads an upload
by itself: the student asks for that through Import Again
(`POST /applicants/{id}/bank/import`). `GET .../{resume_id}` returns one
resume as the list does.
`PUT .../{resume_id}` (a file, as upload takes it) is Import Updated Resume:
it replaces the row's file with a newer version and reads it into the bank
the same way. The row keeps its id, so the primary star stays; the file
goes to a new Storage path, because a sent resume may still point at the
old one, which is removed only when nothing uses it. It merges, so an entry
the new version dropped stays in the bank. It answers what upload answers.
`PUT .../{resume_id}/default` makes it the default resume
(`applicant_profiles.default_resume_id`; the list reports it as `is_default`),
clearing a base resume that was the default. A student's only resume is
the default without a click: upload and delete set it
(`built_resumes.default_if_only`). Upload answers 409 when the
student already has 5 resumes, uploaded and base resumes together
(`app/services/built_resumes.py`).
`GET .../{resume_id}/file` returns a 5-minute signed URL: inline for a PDF, a
download under the original filename for a DOCX.
`DELETE .../{resume_id}` removes the row, and its stored file unless a sent
resume still uses it (`app/services/sent_resumes.py`, KAN-208).
"""
import asyncio
import logging
import re
import statistics
import uuid
import zipfile
from datetime import UTC, datetime
from io import BytesIO

from fastapi import APIRouter, Depends, HTTPException, UploadFile
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_session, get_supabase
from app.deps import assert_applicant_owns, get_current_account
from app.models.dto import ResumeStatus
from app.models.profiles import Applicant_Profile
from app.models.resume import Resume
from app.schemas.auth import AuthenticatedAccount
from app.schemas.bank import ImportResult
from app.services import bank, bank_import, built_resumes, sent_resumes
from app.services.usage import Feature, uses_left
from app.utils.resume_parser import count_sections

router = APIRouter()
logger = logging.getLogger(__name__)


# Extract resume text
def _extract_pdf_text(data: bytes) -> str | None:
    '''Extract text from PDF, picking between pypdf's two extraction modes.

    Layout mode rebuilds lines from glyph positions, so PDFs that place each
    word as its own text object (e.g. Google Docs exports) don't come out one
    word per line. But it reads straight across the page, so a two-column
    resume gets both columns merged into each line and its section headers
    buried mid-line. Plain mode follows content-stream order, which for those
    is column by column. Take plain when it exposes more section headers and
    isn't fragmented — one word per line puts body words like "experience"
    on lines of their own, where they count as headers.
    '''
    from pypdf import PdfReader
    try:
        pages = PdfReader(BytesIO(data)).pages
        layout = _join_pages(pages, "layout")
        plain = _join_pages(pages, "plain")
    except Exception:
        logger.warning("PDF text extraction failed", exc_info=True)
        return None
    use_plain = (_median_words_per_line(plain) >= MIN_MEDIAN_WORDS_PER_LINE
                 and count_sections(plain) > count_sections(layout))
    return (plain if use_plain else layout) or None


# Fragmented extraction sits at ~1 word per line; real resume text at 5+
MIN_MEDIAN_WORDS_PER_LINE = 3


def _median_words_per_line(text: str) -> float:
    counts = [len(line.split()) for line in text.splitlines() if line.strip()]
    return statistics.median(counts) if counts else 0


def _join_pages(pages, mode: str) -> str:
    return _tidy_lines("\n".join(p.extract_text(extraction_mode=mode) or "" for p in pages))


def _tidy_lines(text: str) -> str:
    text = text.replace("\x00", "")  # Postgres text/jsonb rejects NUL bytes
    # PDF layout mode pads columns with runs of spaces, and Word separates
    # them with tabs. Turn each gap into two spaces rather than one, because
    # the parser uses that gap to tell a right-aligned location apart from
    # the title before it.
    lines = (re.sub(r"[ \t]{2,}|\t", "  ", line).strip() for line in text.splitlines())
    return "\n".join(lines).strip()


def _extract_docx_text(data: bytes) -> str | None:
    from docx import Document
    try:
        lines = list(_docx_lines(Document(BytesIO(data))))
    except Exception:
        logger.warning("DOCX text extraction failed", exc_info=True)
        return None
    return _tidy_lines("\n".join(lines)) or None


def _docx_lines(container):
    """Paragraph and table text in document order. Resume templates often lay
    out headers with tables, which `Document.paragraphs` skips entirely."""
    from docx.table import Table
    for block in container.iter_inner_content():
        if not isinstance(block, Table):
            yield _docx_paragraph_text(block)
            continue
        for row in block.rows:
            # Merged cells appear once per grid column they span
            cells = list({id(c._tc): c for c in row.cells}.values())
            texts = [c.text.strip() for c in cells]
            if all("\n" not in t for t in texts):
                # Single-line cells read as one row: "Company | Dates"
                yield "  ".join(t for t in texts if t)
            else:
                for cell in cells:
                    yield from _docx_lines(cell)


def _docx_paragraph_text(paragraph) -> str:
    # Word stores list bullets as numbering properties, not characters, so
    # `text` has none — restore one so the parser can tell bullets apart from
    # entry headers. Numbering comes from the paragraph or its style.
    ppr = paragraph._p.pPr
    is_list = (ppr is not None and ppr.numPr is not None) or (
        paragraph.style is not None and paragraph.style.name.startswith("List"))
    return f"• {paragraph.text}" if is_list and paragraph.text.strip() else paragraph.text


def _is_docx(data: bytes) -> bool:
    """DOCX is a ZIP containing [Content_Types].xml with a Word content type.
    Tightens the check around file type"""
    try:
        with zipfile.ZipFile(BytesIO(data)) as z:
            if "[Content_Types].xml" not in z.namelist():
                return False
            ct = z.read("[Content_Types].xml").decode("utf-8", errors="ignore")
            return "wordprocessingml" in ct
    except zipfile.BadZipFile:
        return False


MAX_SIZE = 5 * 1024 * 1024
BUCKET = "Resume"
# The preview link is opened the moment it is made; this only has to outlast
# the browser's PDF viewer loading a 5 MB file.
FILE_URL_TTL_SECONDS = 5 * 60
PDF_MAGIC = b"%PDF"
DOCX_MAGIC = b"PK\x03\x04"


async def _read_upload(file: UploadFile) -> tuple[bytes, str, str]:
    """Size and type checks for an upload. Returns the bytes,
    extension and MIME type."""
    # check size metadata
    if file.size is not None and file.size > MAX_SIZE:
        raise HTTPException(413, "File must be under 5 MB")

    contents = await file.read(MAX_SIZE + 1)

    if len(contents) > MAX_SIZE:
        raise HTTPException(413, "File must be under 5 MB")

    # validate magic bytes — content_type is client-supplied and untrustworthy
    if contents.startswith(PDF_MAGIC):
        return contents, ".pdf", "application/pdf"
    if contents.startswith(DOCX_MAGIC) and _is_docx(contents):
        return contents, ".docx", (
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document")
    raise HTTPException(400, "Only PDF and DOCX files are accepted")


async def _extract(contents: bytes, ext: str) -> str | None:
    extract = _extract_pdf_text if ext == ".pdf" else _extract_docx_text
    return await asyncio.to_thread(extract, contents)


# Depends grabs get_session before function runs and passes the session into function.
# FastAPI handles the lifecycle

@router.post("/applicants/{applicant_id}/resumes")
async def upload_resume(
    applicant_id: uuid.UUID,
    file: UploadFile,
    account: AuthenticatedAccount = Depends(get_current_account),
    session: AsyncSession = Depends(get_session)
):
    assert_applicant_owns(account, applicant_id)

    contents, ext, mime = await _read_upload(file)
    # Before the Storage upload, so a rejected sixth leaves no file behind
    try:
        await built_resumes.check_room(session, applicant_id)
    except built_resumes.ResumeLimitReached as exc:
        raise HTTPException(409, str(exc))

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
        logger.exception("Storage upload failed",
                         extra={"storage_path": storage_path})
        raise HTTPException(502, "File upload failed")


    # raw_text always comes from the file, never from the client
    raw_text = await _extract(contents, ext)
    entries, skills = bank_import.read(raw_text)

    # Resume ORM object
    resume = Resume(
        id=resume_id,
        applicant_id=applicant_id,
        original_filename=file.filename,
        raw_text=raw_text,
        storage_path=storage_path,
        status=ResumeStatus.parsed if entries or skills else ResumeStatus.parse_failed,
        created_at=datetime.now(UTC),
    )

    # The row and what it adds to the bank commit together (ADR 0003).
    try:
        session.add(resume)
        merged = await bank.merge_import(session, applicant_id, entries, skills)
        left = await uses_left(session, applicant_id, Feature.PARSING)
        await built_resumes.default_if_only(session, applicant_id)
        default_id = await _default_id(session, applicant_id)
        await session.commit()
    except Exception:
        await session.rollback()
        # DB failed - remove the file from Storage
        await _remove_file(client, storage_path, "Failed to remove orphaned file from Storage")
        raise HTTPException(500, "Failed to save resume record")

    return _imported(resume, resume.id == default_id, entries, skills, merged, left)


@router.put("/applicants/{applicant_id}/resumes/{resume_id}")
async def replace_resume(
    applicant_id: uuid.UUID,
    resume_id: uuid.UUID,
    file: UploadFile,
    account: AuthenticatedAccount = Depends(get_current_account),
    session: AsyncSession = Depends(get_session),
):
    """Import Updated Resume: a newer version of the file on this row, read
    into the bank as an upload is. No limit check, since the count stays."""
    assert_applicant_owns(account, applicant_id)
    resume = await _get_owned_resume(session, applicant_id, resume_id)
    contents, ext, mime = await _read_upload(file)

    # A new path, never the old one: a sent resume may point at the old
    # file, and a sent resume's file never changes (KAN-208).
    old_path = resume.storage_path
    storage_path = f"{applicant_id}/{uuid.uuid4()}{ext}"
    client = get_supabase()
    try:
        await asyncio.to_thread(
            client.storage.from_(BUCKET).upload,
            storage_path,
            contents,
            {"content-type": mime},
        )
    except Exception:
        logger.exception("Storage upload failed", extra={"storage_path": storage_path})
        raise HTTPException(502, "File upload failed")

    raw_text = await _extract(contents, ext)
    entries, skills = bank_import.read(raw_text)

    resume.original_filename = file.filename
    resume.raw_text = raw_text
    resume.storage_path = storage_path
    resume.status = ResumeStatus.parsed if entries or skills else ResumeStatus.parse_failed
    # The row says when its file was uploaded, and this one was uploaded now.
    resume.created_at = datetime.now(UTC)

    try:
        merged = await bank.merge_import(session, applicant_id, entries, skills)
        left = await uses_left(session, applicant_id, Feature.PARSING)
        default_id = await _default_id(session, applicant_id)
        await session.commit()
    except Exception:
        await session.rollback()
        await _remove_file(client, storage_path, "Failed to remove orphaned file from Storage")
        raise HTTPException(500, "Failed to save resume record")

    if old_path and not await sent_resumes.file_in_use(session, old_path):
        await _remove_file(client, old_path, "Failed to remove replaced resume file from Storage")

    return _imported(resume, resume.id == default_id, entries, skills, merged, left)


async def _remove_file(client, storage_path: str, message: str) -> None:
    # Best effort: a file left behind is orphaned, but no data is lost.
    try:
        await asyncio.to_thread(client.storage.from_(BUCKET).remove, [storage_path])
    except Exception:
        logger.exception(message, extra={"storage_path": storage_path})


def _imported(resume: Resume, is_default: bool, entries, skills, merged, left: int) -> dict:
    """An uploaded file's row and what its reading wrote into the bank."""
    return {
        "id": str(resume.id),
        "applicant_id": str(resume.applicant_id),
        "original_filename": resume.original_filename,
        "raw_text": resume.raw_text,
        "storage_path": resume.storage_path,
        "status": resume.status,
        "is_default": is_default,
        "created_at": resume.created_at.isoformat() if resume.created_at else None,
        "bank": ImportResult(
            found=len(entries) + len(skills),
            entries_added=merged.entries_added,
            entries_updated=merged.entries_updated,
            skills_added=merged.skills_added,
            uses_left=left,
        ).model_dump(),
    }


@router.get("/applicants/{applicant_id}/resumes")
async def list_resumes(
    applicant_id: uuid.UUID,
    account: AuthenticatedAccount = Depends(get_current_account),
    session: AsyncSession = Depends(get_session),
):
    assert_applicant_owns(account, applicant_id)

    result = await session.execute(
        select(Resume)
        .where(Resume.applicant_id == applicant_id)
        .order_by(Resume.created_at.desc())
    )

    resumes = result.scalars().all()
    default_id = await _default_id(session, applicant_id)
    return [_item(r, default_id) for r in resumes]


async def _default_id(session: AsyncSession, applicant_id: uuid.UUID) -> uuid.UUID | None:
    # The primary resume lives on the profile, not on the resume rows.
    return await session.scalar(
        select(Applicant_Profile.default_resume_id).where(Applicant_Profile.id == applicant_id)
    )


def _item(r: Resume, default_id: uuid.UUID | None) -> dict:
    return {
        "id": str(r.id),
        "applicant_id": str(r.applicant_id),
        "original_filename": r.original_filename,
        "storage_path": r.storage_path,
        "status": r.status,
        "is_default": r.id == default_id,
        "created_at": r.created_at.isoformat() if r.created_at else None,
    }


async def _get_owned_resume(
    session: AsyncSession, applicant_id: uuid.UUID, resume_id: uuid.UUID
) -> Resume:
    resume = (
        await session.execute(
            select(Resume).where(Resume.id == resume_id, Resume.applicant_id == applicant_id)
        )
    ).scalar_one_or_none()
    if not resume:
        raise HTTPException(404, "Resume not found")
    return resume


@router.get("/applicants/{applicant_id}/resumes/{resume_id}")
async def get_resume(
    applicant_id: uuid.UUID,
    resume_id: uuid.UUID,
    account: AuthenticatedAccount = Depends(get_current_account),
    session: AsyncSession = Depends(get_session),
):
    assert_applicant_owns(account, applicant_id)
    resume = await _get_owned_resume(session, applicant_id, resume_id)
    return _item(resume, await _default_id(session, applicant_id))


@router.put("/applicants/{applicant_id}/resumes/{resume_id}/default")
async def set_default_resume(
    applicant_id: uuid.UUID,
    resume_id: uuid.UUID,
    account: AuthenticatedAccount = Depends(get_current_account),
    session: AsyncSession = Depends(get_session),
):
    """Make this the applicant's default resume. It is a pointer on the profile
    (default_resume_id, ON DELETE SET NULL), so deleting the resume clears it;
    a base resume that was the default stops being it."""
    assert_applicant_owns(account, applicant_id)
    resume = await _get_owned_resume(session, applicant_id, resume_id)
    await built_resumes.set_default(session, applicant_id, uploaded_id=resume.id)
    try:
        await session.commit()
    except Exception:
        await session.rollback()
        logger.exception("Failed to set default resume", extra={"resume_id": str(resume_id)})
        raise HTTPException(500, "Failed to set the primary resume")
    return {"default_resume_id": str(resume.id)}


@router.get("/applicants/{applicant_id}/resumes/{resume_id}/file")
async def get_resume_file_url(
    applicant_id: uuid.UUID,
    resume_id: uuid.UUID,
    account: AuthenticatedAccount = Depends(get_current_account),
    session: AsyncSession = Depends(get_session),
):
    """A short-lived link to the uploaded file, for the profile's preview. A
    browser shows a PDF itself; it can't show a DOCX, so that link downloads
    the file under the name it was uploaded with."""
    assert_applicant_owns(account, applicant_id)
    resume = await _get_owned_resume(session, applicant_id, resume_id)
    if not resume.storage_path:
        raise HTTPException(404, "Resume file not found")
    options = (
        {} if resume.storage_path.endswith(".pdf")
        else {"download": resume.original_filename or True}
    )
    try:
        signed = await asyncio.to_thread(
            get_supabase().storage.from_(BUCKET).create_signed_url,
            resume.storage_path,
            FILE_URL_TTL_SECONDS,
            options,
        )
    except Exception:
        logger.exception("Failed to sign resume URL", extra={"storage_path": resume.storage_path})
        raise HTTPException(502, "Could not open the resume")
    return {"url": signed.get("signedUrl")}


@router.delete("/applicants/{applicant_id}/resumes/{resume_id}")
async def delete_resume(
    applicant_id: uuid.UUID,
    resume_id: uuid.UUID,
    account: AuthenticatedAccount = Depends(get_current_account),
    session: AsyncSession = Depends(get_session),
):
    assert_applicant_owns(account, applicant_id)

    resume = await _get_owned_resume(session, applicant_id, resume_id)

    # Delete DB row first (reversible via rollback), then Storage
    storage_path = resume.storage_path
    try:
        await session.delete(resume)
        await built_resumes.default_if_only(session, applicant_id)
        await session.commit()
    except Exception:
        await session.rollback()
        raise HTTPException(500, "Failed to delete resume record")

    # A sent resume that points at this file keeps it (KAN-208); deleting
    # that sent resume later removes the file once nothing uses it.
    if await sent_resumes.file_in_use(session, storage_path):
        return {"detail": "Resume deleted"}

    # DB succeeded — now remove the file from Storage
    # If this fails the file is orphaned, but no data is lost
    client = get_supabase()
    try:
        await asyncio.to_thread(
            client.storage.from_(BUCKET).remove,
            [storage_path],
        )
    except Exception:
        # The database row was already deleted; retain best-effort cleanup behavior,
        # but record the failure instead of silently ignoring it.
        logger.exception(
            "Failed to remove resume file from Storage",
            extra={"storage_path": storage_path},
        )

    return {"detail": "Resume deleted"}