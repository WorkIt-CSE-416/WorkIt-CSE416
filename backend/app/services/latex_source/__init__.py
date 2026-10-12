'''
An applicant's own LaTeX resume (KAN-176): pasted in, edited by its words,
tailored by rewording its bullets, and compiled exactly as written.

tokens.py   the source as tokens with byte spans
fields.py   where the words are: headings, bullets, other text
inline.py   a field's LaTeX as plain text (**bold**, *italic*) and back
splice.py   edits by field id: change words, add or remove a bullet
safety.py   the gate before Tectonic: no file reads or writes, allowed
            packages only. Nothing compiles without it

`compile_source` is the only way an applicant's LaTeX reaches Tectonic.
'''
from io import BytesIO

from app.models.dto import ParsedResume
from app.services.latex_source.safety import prepare
from app.services.resume_render.to_latex import compile_tex

# Shorter than Jake's: an applicant's document could loop, and every second
# here is a function busy
TIMEOUT_SECONDS = 30


def compile_source(source: str) -> tuple[bytes, int]:
    '''The PDF and its page count. Refused (safety.py) for a source that
    reaches beyond typesetting; LatexError for one TeX rejects;
    LatexUnavailable when there is no TeX to run.'''
    return compile_tex(prepare(source), timeout=TIMEOUT_SECONDS)


def read_back(pdf: bytes) -> tuple[str | None, ParsedResume | None]:
    '''The PDF's text and what the resume parser makes of it, so a pasted
    resume has parsed_json like any other and matching, Scout and the profile
    read it the same way. Plain mode: LaTeX places words rather than writing
    spaces (resume_render/CLAUDE.md).'''
    from pypdf import PdfReader

    from app.routers.resumes import _safe_parse, _tidy_lines

    try:
        text = _tidy_lines("\n".join(p.extract_text(extraction_mode="plain") or "" for p in PdfReader(BytesIO(pdf)).pages))
    except Exception:
        return None, None
    return text or None, _safe_parse(text)
