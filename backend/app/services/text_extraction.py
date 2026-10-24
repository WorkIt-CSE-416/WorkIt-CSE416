"""Resume text extraction: PDF and DOCX to plain text.

Pure business logic with no HTTP or database. Moved from routers/resumes.py
so the router stays the HTTP layer.
"""

import asyncio
import logging
import re
import statistics
import zipfile
from io import BytesIO

from app.utils.resume_parser import count_sections

logger = logging.getLogger(__name__)

# Fragmented extraction sits at ~1 word per line; real resume text at 5+
MIN_MEDIAN_WORDS_PER_LINE = 3

PDF_MAGIC = b"%PDF"
DOCX_MAGIC = b"PK\x03\x04"
MAX_SIZE = 5 * 1024 * 1024


def extract_pdf_text(data: bytes) -> str | None:
    """Extract text from PDF, picking between pypdf's two extraction modes.

    Layout mode rebuilds lines from glyph positions, so PDFs that place each
    word as its own text object don't come out one word per line. But it reads
    straight across the page, so a two-column resume gets both columns merged.
    Plain mode follows content-stream order, which for those is column by
    column. Take plain when it exposes more section headers and isn't
    fragmented.
    """
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


def _median_words_per_line(text: str) -> float:
    counts = [len(line.split()) for line in text.splitlines() if line.strip()]
    return statistics.median(counts) if counts else 0


def _join_pages(pages, mode: str) -> str:
    return _tidy_lines("\n".join(p.extract_text(extraction_mode=mode) or "" for p in pages))


def _tidy_lines(text: str) -> str:
    text = text.replace("\x00", "")  # Postgres text/jsonb rejects NUL bytes
    lines = (re.sub(r"[ \t]{2,}|\t", "  ", line).strip() for line in text.splitlines())
    return "\n".join(lines).strip()


def extract_docx_text(data: bytes) -> str | None:
    from docx import Document
    try:
        lines = list(_docx_lines(Document(BytesIO(data))))
    except Exception:
        logger.warning("DOCX text extraction failed", exc_info=True)
        return None
    return _tidy_lines("\n".join(lines)) or None


def _docx_lines(container):
    """Paragraph and table text in document order."""
    from docx.table import Table
    for block in container.iter_inner_content():
        if not isinstance(block, Table):
            yield _docx_paragraph_text(block)
            continue
        for row in block.rows:
            cells = list({id(c._tc): c for c in row.cells}.values())
            texts = [c.text.strip() for c in cells]
            if all("\n" not in t for t in texts):
                yield "  ".join(t for t in texts if t)
            else:
                for cell in cells:
                    yield from _docx_lines(cell)


def _docx_paragraph_text(paragraph) -> str:
    ppr = paragraph._p.pPr
    is_list = (ppr is not None and ppr.numPr is not None) or (
        paragraph.style is not None and paragraph.style.name.startswith("List"))
    return f"• {paragraph.text}" if is_list and paragraph.text.strip() else paragraph.text


def is_docx(data: bytes) -> bool:
    """DOCX is a ZIP containing [Content_Types].xml with a Word content type."""
    try:
        with zipfile.ZipFile(BytesIO(data)) as z:
            if "[Content_Types].xml" not in z.namelist():
                return False
            ct = z.read("[Content_Types].xml").decode("utf-8", errors="ignore")
            return "wordprocessingml" in ct
    except zipfile.BadZipFile:
        return False


class UploadRejected(Exception):
    """The upload failed size or type validation."""

    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.status = status


async def read_upload(file) -> tuple[bytes, str, str]:
    """Size and type checks for an upload. Returns the bytes,
    extension and MIME type. Raises UploadRejected on failure."""
    if file.size is not None and file.size > MAX_SIZE:
        raise UploadRejected("File must be under 5 MB", 413)

    contents = await file.read(MAX_SIZE + 1)

    if len(contents) > MAX_SIZE:
        raise UploadRejected("File must be under 5 MB", 413)

    if contents.startswith(PDF_MAGIC):
        return contents, ".pdf", "application/pdf"
    if contents.startswith(DOCX_MAGIC) and is_docx(contents):
        return contents, ".docx", (
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document")
    raise UploadRejected("Only PDF and DOCX files are accepted")


async def extract(contents: bytes, ext: str) -> str | None:
    """Dispatch to the right extractor in a thread."""
    fn = extract_pdf_text if ext == ".pdf" else extract_docx_text
    return await asyncio.to_thread(fn, contents)
