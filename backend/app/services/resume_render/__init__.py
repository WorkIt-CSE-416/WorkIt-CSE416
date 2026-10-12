'''
Turns a resume into a file (KAN-176). A template lays a ParsedResume out as
blocks (blocks.py), which three writers draw: to_latex.py compiles them as
Jake's own LaTeX (the PDF), to_docx.py writes the Word file, and to_pdf.py is
the PDF when TeX can't run. To add a template, add a module with KEY, TITLE
and layout() and list it in TEMPLATES.
'''
import logging
from dataclasses import dataclass
from typing import Literal

from app.models.dto import ParsedResume
from app.services.resume_render import jakes
from app.services.resume_render.to_docx import write_docx
from app.services.resume_render.to_latex import LatexUnavailable, write_latex_pdf
from app.services.resume_render.to_pdf import write_pdf

logger = logging.getLogger(__name__)

TEMPLATES = {jakes.KEY: jakes}

Format = Literal["pdf", "docx"]
MIME = {
    "pdf": "application/pdf",
    "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
}


@dataclass(frozen=True)
class Rendered:
    data: bytes
    # Only a PDF knows its page count; a .docx is paginated by whatever opens it
    pages: int | None


def render(
    resume: ParsedResume,
    *,
    name: str,
    contacts: list[tuple[str, str | None]],
    template: str,
    fmt: Format,
) -> Rendered:
    '''`contacts` are (text, link) pairs for the line under the name. They come
    from the profile, never from the resume, and never reach a model.
    KeyError for a template that doesn't exist.'''
    blocks = TEMPLATES[template].layout(resume, name, contacts)
    if fmt == "pdf":
        try:
            data, pages = write_latex_pdf(blocks)
        except LatexUnavailable:
            # Still a resume, in the same layout, but drawn by fpdf2 rather
            # than LaTeX: loud in the log, since it is not the exact template
            logger.exception("LaTeX unavailable; drawing the PDF with fpdf2")
            data, pages = write_pdf(blocks)
        return Rendered(data, pages)
    return Rendered(write_docx(blocks), None)
