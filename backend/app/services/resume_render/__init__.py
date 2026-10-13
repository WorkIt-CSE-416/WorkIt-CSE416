'''
Built resumes as Jake's Resume, compiled by Tectonic (ADR 0002, KAN-204).

    render(view, identity, template)  a built resume view -> Rendered
                        (PDF bytes, page count, characters the font lacks)
    escape(text)        the one way applicant text enters the LaTeX
    jakes_document(b)   Jake's preamble, byte for byte, around body b
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


class TectonicUnavailable(RuntimeError):
    '''No binary, no warm cache, or a compile that failed or timed out.'''


@dataclass(frozen=True)
class Identity:
    '''The profile's identity fields a resume's header shows. Links are
    full URLs, printed without their scheme.'''

    name: str
    email: str | None = None
    phone: str | None = None
    links: tuple[str, ...] = ()


@dataclass(frozen=True)
class Rendered:
    pdf: bytes
    page_count: int
    # Each character the template's font cannot draw, once, in the order the
    # compile met them. The PDF shows nothing in their place.
    missing_characters: tuple[str, ...] = ()


def render(view, identity: Identity, template: str) -> Rendered:
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
        return Rendered(pdf.read_bytes(), int(pages[1]), tuple(missing))


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
