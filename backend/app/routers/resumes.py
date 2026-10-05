"""API endpoint that accepts resume file uploads from frontend"""
import asyncio
import logging
import re
import statistics
import uuid
import zipfile
from datetime import UTC, datetime
from io import BytesIO

from fastapi import APIRouter, Depends, Form, HTTPException, UploadFile
from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_session, get_supabase
from app.deps import get_current_account
from app.models.dto import ParsedResume, ResumeStatus
from app.models.resume import Resume
from app.schemas.auth import AccountType, AuthenticatedAccount
from app.utils.resume_parser import count_sections, parse_resume

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
PDF_MAGIC = b"%PDF"
DOCX_MAGIC = b"PK\x03\x04"


def _assert_applicant_owns(account: AuthenticatedAccount, applicant_id: uuid.UUID) -> None:
    """Shared ownership guard for all resume endpoints."""
    if account.account_type != AccountType.APPLICANT or account.id != applicant_id:
        raise HTTPException(403, "Forbidden")


async def _read_upload(file: UploadFile) -> tuple[bytes, str, str]:
    """Size and type checks shared by parse and upload. Returns the bytes,
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


def _safe_parse(raw_text: str | None) -> ParsedResume | None:
    if not raw_text:
        return None
    try:
        return parse_resume(raw_text)
    except Exception:
        logger.exception("Resume parsing failed")
        return None


@router.post("/applicants/{applicant_id}/resumes/parse")
async def parse_resume_preview(
    applicant_id: uuid.UUID,
    file: UploadFile,
    account: AuthenticatedAccount = Depends(get_current_account),
):
    """Parse without saving, so the applicant can review and edit the result
    before it is stored. Touches neither Storage nor the database."""
    _assert_applicant_owns(account, applicant_id)
    contents, ext, _ = await _read_upload(file)
    parsed = _safe_parse(await _extract(contents, ext))
    return {"parsed_json": parsed.model_dump(mode="json") if parsed else None}


# Depends grabs get_session before function runs and passes the session into function.
# FastAPI handles the lifecycle

# TODO: Reinforce the 5 resume limit rule in the backend
@router.post("/applicants/{applicant_id}/resumes")
async def upload_resume(
    applicant_id: uuid.UUID,
    file: UploadFile,
    # The applicant's reviewed copy of the /parse result. When present it is
    # stored instead of re-parsing; onboarding omits it and gets the parser's.
    parsed_json: str | None = Form(None),
    account: AuthenticatedAccount = Depends(get_current_account),
    session: AsyncSession = Depends(get_session)
):
    _assert_applicant_owns(account, applicant_id)

    reviewed = None
    if parsed_json is not None:
        try:
            reviewed = ParsedResume.model_validate_json(parsed_json)
        except ValidationError as exc:
            raise HTTPException(422, "Invalid resume details") from exc

    contents, ext, mime = await _read_upload(file)

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
    parsed = reviewed if reviewed is not None else _safe_parse(raw_text)

    # Resume ORM object
    resume = Resume(
        id=resume_id,
        applicant_id=applicant_id,
        original_filename=file.filename,
        raw_text=raw_text,
        parsed_json=parsed.model_dump(mode="json") if parsed else None,
        storage_path=storage_path,
        status=ResumeStatus.parsed if parsed else ResumeStatus.parse_failed,
        created_at=datetime.now(UTC),
    )

    # track for insertion
    session.add(resume)
    # send SQL to Postgres and commit transaction
    try:
        await session.commit()
    except Exception:
        await session.rollback()
        # DB failed - remove the file from Storage
        try:
            await asyncio.to_thread(
                client.storage.from_(BUCKET).remove,
                [storage_path],
            )
        except Exception:
            logger.exception("Failed to remove orphaned file from Storage",
                             extra={"storage_path": storage_path})
        raise HTTPException(500, "Failed to save resume record")

    return {
        "id": str(resume.id),
        "applicant_id": str(resume.applicant_id),
        "original_filename": resume.original_filename,
        "raw_text": resume.raw_text,
        "parsed_json": resume.parsed_json,
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
            "applicant_id": str(r.applicant_id),
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
        # The database row was already deleted; retain best-effort cleanup behavior,
        # but record the failure instead of silently ignoring it.
        logger.exception(
            "Failed to remove resume file from Storage",
            extra={"storage_path": storage_path},
        )

    return {"detail": "Resume deleted"}