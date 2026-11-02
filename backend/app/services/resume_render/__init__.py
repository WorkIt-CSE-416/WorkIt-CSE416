'''
Built resumes as Jake's Resume, compiled by Tectonic (ADR 0002, KAN-204).

    render(view, identity, template, page)  a built resume view -> Rendered
                        (PDF bytes, page count, characters the font lacks,
                        a box for each marked line)
    latex(view, identity, template, page)   the same resume as a .tex source, unmarked
    PageSettings        how the page is set: type, spacing, margins, style (KAN-435)
    escape(text)        the one way applicant text enters the LaTeX
    pdf_title(text)     the PDF's Title, as hex digits only
    jakes_document(b, page)  Jake's preamble around body b, byte for byte
                        at the default page settings
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
from dataclasses import dataclass, replace
from pathlib import Path

HERE = Path(__file__).resolve().parent
TEMPLATE = HERE / "jakes.tex"
BODY_MARKER = "\n%%BODY%%\n"
BEGIN_DOCUMENT = "\n\\begin{document}\n"
# Built by scripts/fetch_tectonic.py: the pinned binary (Linux) and the warm
# package cache. Gitignored
VENDOR = HERE.parents[2] / "vendor" / "tectonic"
COMPILE_TIMEOUT_SECONDS = 60
# Warming downloads every package (~40 MB) from Tectonic's bundle server, which
# ran past 60 s on a cold CI cache; a render stays offline and short
WARM_TIMEOUT_SECONDS = 600
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
# The distance between a wrapped line's baselines in Jake's bullets, in
# points; `PageSettings.wrapped_line` on any other page
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


# What a student can pick (KAN-435): fixed lists, so a value never needs
# escape() and the warm-up can cache every font a page can reach
FONT_SIZES = (10, 11, 12)
LINE_SPACINGS = (1.0, 1.15, 1.3)
MARGINS = (0.5, 0.75, 1.0)
ALIGNMENTS = ("left", "justified")
# Points added over each section heading and after each entry's bullets
SECTION_SPACINGS = (0, 4, 8, 12)
ENTRY_SPACINGS = (0, 2, 4, 6)
# Name and section headings, as RGB from 0 to 1 (the `color` package Jake's
# preamble loads has no HTML model). Dark, so each prints as text and stays
# legible to a recruiter's scan
ACCENTS = {
    "#000000": "0,0,0",
    "#1E3A5F": "0.118,0.227,0.373",
    "#14532D": "0.078,0.325,0.176",
    "#7F1D1D": "0.498,0.114,0.114",
    "#4C1D95": "0.298,0.114,0.584",
}
BULLETS = ("dot", "dash")
HEADER_ALIGNMENTS = ("left", "center", "right")
# Every section, as the page prints them unless the student drags them; the
# bank's sections (resume_view.SECTIONS), then the skills
SECTION_ORDER = ("education", "experience", "projects", "leadership", "awards", "certifications", "skills")
# \\small's \\baselineskip in each of article's sizes, in TeX points: a
# bullet's lines
_SMALL_LEADING = {10: 11.0, 11: WRAPPED_LINE, 12: 13.6}


@dataclass(frozen=True)
class PageSettings:
    '''How a built resume's page is set (KAN-435). The defaults are Jake's
    own page: 11 pt, single spacing, half-inch margins, ragged right, black
    headings over a rule, dot bullets, a centred header. Margins are in
    inches: `side_margin` left and right, `top_margin` top and bottom. A
    value off the lists raises ValueError: this is the one guard before these
    reach the LaTeX.'''

    font_size: int = 11
    line_spacing: float = 1.0
    side_margin: float = 0.5
    top_margin: float = 0.5
    alignment: str = "left"
    section_spacing: int = 0
    entry_spacing: int = 0
    accent: str = "#000000"
    bullet: str = "dot"
    show_divider: bool = True
    header_alignment: str = "center"
    section_order: tuple[str, ...] = SECTION_ORDER

    def __post_init__(self) -> None:
        # Stored as a JSON list, and frozen here
        object.__setattr__(self, "section_order", tuple(self.section_order))
        if sorted(self.section_order) != sorted(SECTION_ORDER):
            raise ValueError(f"unknown page settings {self!r}")
        allowed = (
            (self.font_size, FONT_SIZES), (self.line_spacing, LINE_SPACINGS), (self.side_margin, MARGINS),
            (self.top_margin, MARGINS), (self.alignment, ALIGNMENTS), (self.section_spacing, SECTION_SPACINGS),
            (self.entry_spacing, ENTRY_SPACINGS), (self.accent, ACCENTS), (self.bullet, BULLETS),
            (self.show_divider, (True, False)), (self.header_alignment, HEADER_ALIGNMENTS),
        )
        if any(value not in choices for value, choices in allowed):
            raise ValueError(f"unknown page settings {self!r}")

    @property
    def wrapped_line(self) -> float:
        '''The distance between a wrapped bullet's baselines, in points.'''
        return _SMALL_LEADING[self.font_size] * self.line_spacing


DEFAULT_PAGE = PageSettings()


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
    # Prints "U.S. Citizen" after the links (My Profile's check box)
    us_citizen: bool = False


@dataclass(frozen=True)
class Box:
    '''Where one line sits on the page: the bank item it shows (an entry,
    bullet or skill id), which part of it (`kind`: bullet, skill, or an entry
    field such as title or dates), its page (from 1), and its rectangle in
    PDF points from the page's top left, y growing down. A wrapped line runs
    from its start to the text's right edge; a line split across pages gives
    one box on each. `text` is the line's words as printed, labels included
    ("GPA: 3.8/4.0"), so the editor can show them without the rules that
    format them (KAN-391); empty from a bare compile.'''

    item_id: str
    kind: str
    page: int
    x0: float
    y0: float
    x1: float
    y1: float
    text: str = ""


def box_lines(box: Box, wrapped_line: float = WRAPPED_LINE) -> int:
    '''How many lines of text a box covers: 1, or more for a wrapped line.'''
    return 1 + max(0, round((box.y1 - box.y0 - ASCENT - DESCENT) / wrapped_line))


def line_count(boxes, wrapped_line: float = WRAPPED_LINE) -> int:
    '''The distinct lines of text these boxes sit on: a heading's title and
    dates share one, a wrapped box counts each of its lines.'''
    baselines = set()
    for box in boxes:
        top = box.y0 + ASCENT
        baselines.update(
            (box.page, round(top + i * wrapped_line)) for i in range(box_lines(box, wrapped_line)))
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
    # The page's `PageSettings.wrapped_line`, which reads the boxes
    wrapped_line: float = WRAPPED_LINE

    @property
    def lines_over(self) -> int:
        '''How many lines of text sit past page 1, for the editor's
        page-count chip ("3 lines over 1 page", KAN-218): the distinct
        baselines of the boxes on later pages, a wrapped box counting each of
        its lines. Section headings have no box and blocks move whole across the
        page break, so it can run several lines short; Fit to One Page
        re-renders rather than trust it.'''
        return line_count((box for box in self.boxes if box.page >= 2), self.wrapped_line)


def render(view, identity: HeaderIdentity, template: str, page: PageSettings = DEFAULT_PAGE) -> Rendered:
    '''
    A built resume view (services/resume_view.py) as a PDF in `template`, set
    by `page`. Raises ValueError for a template id it does not know, and
    TectonicUnavailable when the compile cannot run or fails.
    '''
    printed: dict[str, str] = {}
    rendered = compile_document(_document(view, identity, template, page, marks=True, printed=printed))
    boxes = tuple(replace(b, text=printed.get(f"{b.item_id}.{b.kind}", "")) for b in rendered.boxes)
    return replace(rendered, boxes=boxes, wrapped_line=page.wrapped_line)


def latex(view, identity: HeaderIdentity, template: str, page: PageSettings = DEFAULT_PAGE) -> str:
    '''
    The LaTeX source `render` compiles, without the position markers, so the
    student can take it to Overleaf. Raises ValueError like `render`.
    '''
    return _document(view, identity, template, page, marks=False)


def _document(
    view, identity: HeaderIdentity, template: str, page: PageSettings, *, marks: bool,
    printed: dict[str, str] | None = None,
) -> str:
    # Imported here: the template modules import escape() from this one
    from app.services.resume_render import jakes

    # The Title goes in a compiled PDF only: the Overleaf source leaves it
    # out, since pdfLaTeX (Overleaf's default) ignores an xdvipdfmx special
    # and warns about it.
    title = _titled(identity) if marks else ""
    templates = {
        "jakes": lambda v, i: jakes_document(title + jakes.body(v, i, marks=marks, printed=printed, page=page), page)
    }
    if template not in templates:
        raise ValueError(f"unknown template {template!r}")
    return templates[template](view, identity)


def _titled(identity: HeaderIdentity) -> str:
    '''The Title line every template's body starts with: "Jane Doe Resume".
    The person's name, not the resume's: it is in every render's identity
    with no new argument, and it is what an employer should read in the
    file the student sends. With no Title a viewer shows the file's URL,
    a random id for the in-app dialog's blob: link (KAN-317).'''
    name = identity.name.strip()
    return pdf_title(f"{name} Resume" if name else "Resume") + "\n"


def pdf_title(text: str) -> str:
    '''
    The PDF's Title (its Info dictionary), as XeTeX's driver writes it.
    The text goes in as UTF-16 hex digits, so it never meets the TeX parser
    or PDF string syntax and needs no escape(): nothing in it can close the
    special or start a command. A \\special is a whatsit, which neither moves
    the page nor reaches its content stream.
    '''
    hex_text = "FEFF" + text.replace("\r", " ").replace("\n", " ").encode("utf-16-be").hex().upper()
    return rf"\special{{pdf:docinfo<</Title<{hex_text}>>>}}"


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


def _page_lines(page: PageSettings) -> list[str]:
    '''What a page's settings add after Jake's preamble, before
    \\begin{document}: only what differs from his page.'''
    lines = []
    if page.side_margin != DEFAULT_PAGE.side_margin:
        more = page.side_margin - DEFAULT_PAGE.side_margin
        lines += [
            rf"\addtolength{{\oddsidemargin}}{{{more}in}}",
            rf"\addtolength{{\evensidemargin}}{{{more}in}}",
            rf"\addtolength{{\textwidth}}{{{-2 * more}in}}",
        ]
    if page.top_margin != DEFAULT_PAGE.top_margin:
        more = page.top_margin - DEFAULT_PAGE.top_margin
        lines += [
            rf"\addtolength{{\topmargin}}{{{more}in}}",
            rf"\addtolength{{\textheight}}{{{-2 * more}in}}",
        ]
    if page.line_spacing != DEFAULT_PAGE.line_spacing:
        lines.append(rf"\linespread{{{page.line_spacing}}}")
    if page.alignment == "justified":
        # Takes back the preamble's \raggedright. \sloppy keeps a line that
        # cannot stretch inside the margin, and no word is hyphenated: a split
        # word reads as two to a hiring system
        lines += [r"\makeatletter\@rightskip=\z@skip\rightskip=\@rightskip\makeatother",
                  r"\sloppy\hyphenpenalty=10000"]
    if page.accent != DEFAULT_PAGE.accent:
        lines.append(rf"\definecolor{{wiaccent}}{{rgb}}{{{ACCENTS[page.accent]}}}")
    if (page.accent != DEFAULT_PAGE.accent or not page.show_divider
            or page.section_spacing != DEFAULT_PAGE.section_spacing):
        lines.append(_section_format(page))
    if page.entry_spacing != DEFAULT_PAGE.entry_spacing:
        lines.append(rf"\renewcommand{{\resumeItemListEnd}}{{\end{{itemize}}\vspace{{{page.entry_spacing - 5}pt}}}}")
    if page.bullet == "dash":
        # Second level: Jake's bullets are a list inside the section's list
        lines.append(r"\renewcommand{\labelitemii}{--}")
    return lines


def _section_format(page: PageSettings) -> str:
    '''Jake's \\titleformat for sections, with the page's space over them, its
    accent, and the rule under them or none.'''
    accent = r"\color{wiaccent}" if page.accent != DEFAULT_PAGE.accent else ""
    rule_color = accent or r"\color{black}"
    rule = rf"{rule_color}\titlerule " if page.show_divider else ""
    space = page.section_spacing - 4
    return rf"\titleformat{{\section}}{{\vspace{{{space}pt}}\scshape\raggedright\large{accent}}}{{}}{{0em}}{{}}[{rule}\vspace{{-5pt}}]"


def jakes_document(body: str, page: PageSettings = DEFAULT_PAGE) -> str:
    '''Jake's template with `body` (already LaTeX) after \\begin{document},
    set by `page`: at the defaults, his template byte for byte.'''
    template = TEMPLATE.read_text(encoding="utf-8")
    if page != DEFAULT_PAGE:
        template = template.replace("letterpaper,11pt", f"letterpaper,{page.font_size}pt", 1)
        added = "\n".join(_page_lines(page))
        template = template.replace(BEGIN_DOCUMENT, f"\n{added}{BEGIN_DOCUMENT}", 1)
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
                timeout=COMPILE_TIMEOUT_SECONDS if offline else WARM_TIMEOUT_SECONDS, check=False,
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
        def copy(staged: Path) -> None:
            shutil.copy(vendored, staged)
            staged.chmod(0o755)

        return _copy_once("workit-tectonic", copy)
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
    return _copy_once("workit-tectonic-cache", lambda staged: shutil.copytree(cache, staged))


def _copy_once(name: str, copy) -> Path:
    '''/tmp/`name`, made by `copy(path)` the first time. Renders run on
    threads, and a Function serves several at once: `copy` fills a staging
    path and only a finished copy is renamed into place, so no render sees a
    half-made one, and a copy that fails leaves nothing behind.'''
    dest = Path(tempfile.gettempdir()) / name
    if dest.exists():
        return dest
    staging = Path(tempfile.mkdtemp(prefix=f"{name}-", dir=dest.parent))
    staged = staging / name
    try:
        copy(staged)
        try:
            staged.rename(dest)
        except OSError:
            # Another render renamed its copy first: use that one
            if not dest.exists():
                raise
        return dest
    except OSError as exc:
        raise TectonicUnavailable(f"could not copy {name} to {dest.parent}: {exc}") from exc
    finally:
        shutil.rmtree(staging, ignore_errors=True)
