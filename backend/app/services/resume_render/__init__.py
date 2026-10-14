'''
Built resumes as Jake's Resume, compiled by Tectonic (ADR 0002, KAN-204).

    render(view, identity, template)  a built resume view -> Rendered
                        (PDF bytes, page count, characters the font lacks,
                        a box for each marked line)
    escape(text)        the one way applicant text enters the LaTeX
    jakes_document(b)   Jake's preamble, byte for byte, around body b
    MARKS, mark(id, kind, latex)  position markers a template's body uses
    line_count(boxes)   the distinct lines of text some boxes sit on
    compile_document(tex)  a whole document -> Rendered, offline and untrusted
    compile_pdf(tex)    the same, PDF bytes only

Stdlib only: scripts/fetch_tectonic.py imports this before Vercel's build has
installed anything. The rules are in CLAUDE.md beside this file.
'''

import os
import re
import shutil
import subprocess
import tempfile
from dataclasses import dataclass
from pathlib import Path

HERE = Path(__file__).resolve().parent
TEMPLATE = HERE / "jakes.tex"
BODY_MARKER = "\n%%BODY%%\n"
# Built by scripts/fetch_tectonic.py: the pinned binary (Linux) and the warm
# package cache. Gitignored
VENDOR = HERE.parents[2] / "vendor" / "tectonic"
COMPILE_TIMEOUT_SECONDS = 60
# XeTeX's warning for a glyph the font lacks, e.g. "Missing character: There
# is no Ж (U+0416) in font [lmroman10-regular]...". Tectonic prints it on
# stderr; the character itself can be garbled there, the code point is not.
_MISSING_RE = re.compile(r"Missing character: There is no .*? \(U\+([0-9A-F]{4,6})\)")
# The last line XeTeX writes to the log: "Output written on resume.xdv (2 pages, ...)"
_PAGES_RE = re.compile(r"Output written on \S+ \((\d+) pages?")

_SPECIAL = {
    "\\": r"\textbackslash{}",
    "&": r"\&",
    "%": r"\%",
    "$": r"\$",
    "#": r"\#",
    "_": r"\_",
    "{": r"\{",
    "}": r"\}",
    "~": r"\textasciitilde{}",
    "^": r"\textasciicircum{}",
    # The template's font has other glyphs in these slots (< prints as ¡)
    "<": r"\textless{}",
    ">": r"\textgreater{}",
    "|": r"\textbar{}",
}
_TABLE = str.maketrans({**_SPECIAL, "\n": " ", "\r": " "})

# Position markers (KAN-209, research/KAN-181-pdf-click-targets). A body
# starts with MARKS, defined after \begin{document} so Jake's preamble stays
# byte for byte, and wraps each line the editor can select with mark().
# \pdfsavepos records where a marker lands when its page ships out, and the
# \write puts "id s|e x y page" (scaled points, from the page's bottom left)
# in resume.pos. \leavevmode makes a first marker record the text's start,
# not the margin. The \/ before each end marker puts back the italic
# correction the marker would otherwise take from an italic field (dates
# moved 0.4 to 0.8 pt without it). The first line records the text's right
# edge, where a wrapped line ends. tests/test_resume_render.py checks the page
# is the same with and without markers.
_MARK_LINES = (
    r"\newwrite\wipos\immediate\openout\wipos=\jobname.pos",
    r"\immediate\write\wipos{right \the\dimexpr1in+\hoffset+\oddsidemargin+\textwidth\relax}",
    (
        r"\def\wimark#1#2{\leavevmode\pdfsavepos"
        r"\write\wipos{#1 #2 \the\pdflastxpos\space\the\pdflastypos\space\thepage}}"
    ),
    r"\def\wiend#1{\/\wimark{#1}{e}}",
)
MARKS = "\n".join(_MARK_LINES)
# Letter only (the spec), in PDF points; a box's y counts down from the top
PAGE_HEIGHT = 792.0
# A box reaches this far above and below a line's baseline: about the
# ascent and descent of Jake's 10 to 11 pt text, less than the 11.9 pt
# between two bullet lines, so neighbouring boxes do not overlap
ASCENT, DESCENT = 8.0, 3.0
# The name prints \Huge, so its box reaches further each way
NAME_ASCENT, NAME_DESCENT = 21.0, 5.0
# The item id of the header's boxes, whose kinds are the profile columns
# they show: full_name, phone_number, email, linkedin_url, github_url,
# portfolio_url, other_url
HEADER = "header"
# The distance between a wrapped line's baselines in Jake's bullets, in points
WRAPPED_LINE = 12.0
_SP_PER_POINT = 65536 * 72.27 / 72  # scaled points in one PDF point


def mark(item_id, kind: str, latex: str) -> str:
    '''`latex` (already escaped) between position markers for the bank item
    `item_id` (an entry, bullet or skill id, never applicant text) and its
    `kind`. Empty text gets no markers: it would make a box of no width.'''
    if not latex:
        return latex
    name = f"{item_id}.{kind}"
    return rf"\wimark{{{name}}}{{s}}{latex}\wiend{{{name}}}"


class TectonicUnavailable(RuntimeError):
    '''No binary, no warm cache, or a compile that failed or timed out.'''


@dataclass(frozen=True)
class HeaderIdentity:
    '''The profile's identity fields a resume's header prints. Links are
    (profile column, full URL) pairs, printed without their scheme. Not `workit_scout.identity`'s
    `Identity`, which holds the same fields for removal before a model.'''

    name: str
    email: str | None = None
    phone: str | None = None
    links: tuple[tuple[str, str], ...] = ()


@dataclass(frozen=True)
class Box:
    '''Where one line sits on the page: the bank item it shows (an entry,
    bullet or skill id), which part of it (`kind`: bullet, skill, or an entry
    field such as title or dates), its page (from 1), and its rectangle in
    PDF points from the page's top left, y growing down. A wrapped line runs
    from its start to the text's right edge; a line split across pages gives
    one box on each.'''

    item_id: str
    kind: str
    page: int
    x0: float
    y0: float
    x1: float
    y1: float


def box_lines(box: Box) -> int:
    '''How many lines of text a box covers: 1, or more for a wrapped line.'''
    return 1 + max(0, round((box.y1 - box.y0 - ASCENT - DESCENT) / WRAPPED_LINE))


def line_count(boxes) -> int:
    '''The distinct lines of text these boxes sit on: a heading's title and
    dates share one, a wrapped box counts each of its lines.'''
    baselines = set()
    for box in boxes:
        top = box.y0 + ASCENT
        baselines.update((box.page, round(top + i * WRAPPED_LINE)) for i in range(box_lines(box)))
    return len(baselines)


@dataclass(frozen=True)
class Rendered:
    pdf: bytes
    page_count: int
    # Each character the template's font cannot draw, once, in the order the
    # compile met them. The PDF shows nothing in their place.
    missing_characters: tuple[str, ...] = ()
    # One box per marked line, in page order; empty for an unmarked body
    boxes: tuple[Box, ...] = ()

    @property
    def lines_over(self) -> int:
        '''How many lines of text sit past page 1, for the editor's
        page-count chip ("3 lines over 1 page", KAN-218): the distinct
        baselines of the boxes on later pages, a wrapped box counting each of
        its lines. Section headings have no box and blocks move whole across the
        page break, so it can run several lines short; Fit to One Page
        re-renders rather than trust it.'''
        return line_count(box for box in self.boxes if box.page >= 2)


def render(view, identity: HeaderIdentity, template: str) -> Rendered:
    '''
    A built resume view (services/resume_view.py) as a PDF in `template`.
    Raises ValueError for a template id it does not know, and
    TectonicUnavailable when the compile cannot run or fails.
    '''
    # Imported here: the template modules import escape() from this one
    from app.services.resume_render import jakes

    templates = {"jakes": lambda v, i: jakes_document(jakes.body(v, i))}
    if template not in templates:
        raise ValueError(f"unknown template {template!r}")
    return compile_document(templates[template](view, identity))


def escape(text: str) -> str:
    '''
    Applicant text as LaTeX that prints it, character for character. Every
    newline becomes a space: a blank line is a paragraph break, which ends a
    command's argument early and fails the compile.
    '''
    return text.replace("\r\n", " ").translate(_TABLE)


# In a link target hyperref turns \textasciitilde{} into "~{}", which breaks
# the link; \string~ is the plain character. The other escapes ("\_", "\%",
# "\#") already reach the PDF as the bare character.
_URL_TABLE = str.maketrans({**_SPECIAL, "~": r"\string~", "^": r"\string^", "\n": "", "\r": ""})


def escape_url(url: str) -> str:
    '''A URL as an \\href target that links to exactly that URL. Never
    the printed text: that goes through escape().'''
    return url.translate(_URL_TABLE)


def jakes_document(body: str) -> str:
    '''Jake's template with `body` (already LaTeX) after \\begin{document}.'''
    template = TEMPLATE.read_text(encoding="utf-8")
    return template.replace(BODY_MARKER, f"\n{body}\n", 1)


def compile_pdf(tex: str, *, cache: Path | None = None, offline: bool = True) -> bytes:
    '''compile_document's PDF bytes alone.'''
    return compile_document(tex, cache=cache, offline=offline).pdf


def compile_document(tex: str, *, cache: Path | None = None, offline: bool = True) -> Rendered:
    '''
    Compile a whole document with Tectonic, `--untrusted` and (unless the
    build script is warming the cache) `--only-cached`, so a render never
    reaches the network. Raises TectonicUnavailable on any failure.
    '''
    binary = _binary()
    cache = cache or _cache()
    with tempfile.TemporaryDirectory() as work:
        source = Path(work) / "resume.tex"
        source.write_text(tex, encoding="utf-8")
        command = [str(binary), "-X", "compile", "--untrusted", "--keep-logs", "--outdir", work, str(source)]
        if offline:
            command.insert(3, "--only-cached")
        try:
            result = subprocess.run(
                command, env=_env(cache, work), capture_output=True, text=True, errors="replace",
                timeout=COMPILE_TIMEOUT_SECONDS, check=False,
            )
        except subprocess.TimeoutExpired as exc:
            raise TectonicUnavailable("tectonic timed out") from exc
        pdf = Path(work) / "resume.pdf"
        if result.returncode != 0 or not pdf.exists():
            raise TectonicUnavailable(f"tectonic failed: {result.stderr[-2000:]}")
        log = Path(work) / "resume.log"
        pages = _PAGES_RE.search(log.read_text(encoding="utf-8", errors="replace")) if log.exists() else None
        if pages is None:
            raise TectonicUnavailable("tectonic wrote no page count")
        # TeX can run twice (a changed .aux), warning twice: keep each once
        missing = dict.fromkeys(chr(int(code, 16)) for code in _MISSING_RE.findall(result.stderr))
        positions = Path(work) / "resume.pos"
        boxes = _boxes(positions.read_text(encoding="utf-8")) if positions.exists() else ()
        return Rendered(pdf.read_bytes(), int(pages[1]), tuple(missing), boxes)


def _boxes(positions: str) -> tuple[Box, ...]:
    '''resume.pos's start and end points as boxes (see MARKS).'''
    right = None
    starts: dict[str, tuple[float, float, int]] = {}
    boxes = []

    def box(name: str, page: int, x0: float, x1: float, top: float, bottom: float) -> Box:
        item_id, kind = name.rsplit(".", 1)
        ascent, descent = (NAME_ASCENT, NAME_DESCENT) if name == f"{HEADER}.full_name" else (ASCENT, DESCENT)
        y0, y1 = PAGE_HEIGHT - top - ascent, PAGE_HEIGHT - bottom + descent
        return Box(item_id, kind, page, round(x0, 2), round(y0, 2), round(x1, 2), round(y1, 2))

    for line in positions.splitlines():
        parts = line.split()
        if parts[:1] == ["right"]:
            # TeX points, "542.025pt"
            right = float(parts[1].removesuffix("pt")) * 72 / 72.27
            continue
        if len(parts) != 5:
            continue
        name, end, x, y, page = parts[0], parts[1] == "e", int(parts[2]) / _SP_PER_POINT, \
            int(parts[3]) / _SP_PER_POINT, int(parts[4])
        if not end:
            starts[name] = (x, y, page)
            continue
        if name not in starts:
            continue
        sx, sy, spage = starts.pop(name)
        edge = max(right or x, x, sx)
        if spage != page:
            boxes.append(box(name, spage, sx, edge, sy, sy))
            boxes.append(box(name, page, sx, x, y, y))
        elif abs(sy - y) < 1:
            boxes.append(box(name, page, sx, x, sy, y))
        else:
            boxes.append(box(name, page, sx, edge, sy, y))
    return tuple(boxes)


def _env(cache: Path, work: str) -> dict[str, str]:
    # Never the API's own environment: the compile must not see the database
    # URL or the service-role key
    return {"PATH": os.environ.get("PATH", ""), "HOME": work, "TECTONIC_CACHE_DIR": str(cache)}


def _binary() -> Path:
    vendored = VENDOR / "tectonic"
    if vendored.exists():
        if os.access(vendored, os.X_OK):
            return vendored
        # Vercel's bundle can drop the execute bit, and /var/task is
        # read-only, so run a copy from /tmp
        copy = Path(tempfile.gettempdir()) / "workit-tectonic"
        if not copy.exists():
            shutil.copy(vendored, copy)
            copy.chmod(0o755)
        return copy
    found = shutil.which("tectonic")
    if found is None:
        raise TectonicUnavailable("no tectonic binary: run python3 scripts/fetch_tectonic.py")
    return Path(found)


def _cache() -> Path:
    cache = VENDOR / "cache"
    if not cache.is_dir():
        raise TectonicUnavailable("no warm cache: run python3 scripts/fetch_tectonic.py")
    if os.access(cache, os.W_OK):
        return cache
    # Tectonic writes into its cache even offline, and a Vercel Function can
    # write only under /tmp: copy it there once per process
    copy = Path(tempfile.gettempdir()) / "workit-tectonic-cache"
    if not copy.exists():
        shutil.copytree(cache, copy)
    return copy
