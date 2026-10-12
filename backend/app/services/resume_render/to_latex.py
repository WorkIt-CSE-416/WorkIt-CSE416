'''
Blocks as Jake's own LaTeX, compiled to a PDF with Tectonic, so a resume is
the template exactly as Overleaf prints it: `jakes.tex` is the published
preamble and commands, and each block becomes the command the original uses
for it (\\resumeSubheading, \\resumeProjectHeading, \\resumeItem, …).

Everything the applicant typed is escaped (`escape`), so a resume can't run
TeX of its own. Tectonic runs with --untrusted, which turns off shell escape
but still reads any file the process can (\\input{/etc/hosts} compiles), so
escaping is what keeps Jake's path safe, and an applicant's own LaTeX goes
through latex_source/safety.py first. Every compile gets a scrubbed
environment (`_env`), never the API's. `compile_tex` compiles any whole
document; a warm cache takes about a second.

Tectonic is a single binary that fetches the TeX packages it needs into a
cache. `scripts/fetch_tectonic.py` puts the binary and a warm cache in
`backend/vendor/tectonic/` ahead of time; when that exists it is used offline
(--only-cached), the cache copied to /tmp first because a deployed function
can write nowhere else. Otherwise `TECTONIC_BIN` or `tectonic` on PATH, with
its own cache, online (a laptop). LatexUnavailable when there is no binary
or a compile fails; __init__.render then falls back to to_pdf.py.
'''
import os
import re
import shutil
import stat
import subprocess
import tempfile
from functools import lru_cache
from io import BytesIO
from pathlib import Path

from pypdf import PdfReader

from app.services.resume_render.blocks import (
    Block,
    Bullet,
    Contact,
    EntryHeader,
    Heading,
    Name,
    SkillLine,
)

TEMPLATE = Path(__file__).parent / "jakes.tex"
VENDOR = Path(__file__).resolve().parents[3] / "vendor" / "tectonic"
# A cold cache downloads ~40 MB of packages; a warm one compiles in about a second
TIMEOUT_SECONDS = 60

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
}
_SPECIAL_RE = re.compile("|".join(re.escape(c) for c in _SPECIAL))


class LatexUnavailable(Exception):
    pass


def escape(text: str) -> str:
    '''Text as LaTeX prints it, never as LaTeX runs it.'''
    return _SPECIAL_RE.sub(lambda m: _SPECIAL[m.group()], text)


def _url(url: str) -> str:
    # Inside \href only these break the argument; the rest is literal
    return re.sub(r"([%#\\{}])", r"\\\1", url)


def body(blocks: list[Block]) -> str:
    '''The document body: the original's own commands, in its own order.'''
    out: list[str] = []
    in_header = in_entries = in_items = in_skills = False

    def close_items() -> None:
        nonlocal in_items
        if in_items:
            out.append(r"      \resumeItemListEnd")
            in_items = False

    def close_section() -> None:
        nonlocal in_entries, in_skills, in_header
        close_items()
        if in_header:
            out.append(r"\end{center}")
            in_header = False
        if in_entries:
            out.append(r"  \resumeSubHeadingListEnd")
            in_entries = False
        if in_skills:
            out.append(r"    }}")
            out.append(r" \end{itemize}")
            in_skills = False

    skills: list[str] = []
    for block in blocks:
        match block:
            case Name(text):
                out.append(r"\begin{center}")
                out.append(rf"    \textbf{{\Huge \scshape {escape(text)}}} \\ \vspace{{1pt}}")
                in_header = True
            case Contact(items):
                parts = [
                    rf"\href{{{_url(link)}}}{{\underline{{{escape(text)}}}}}" if link else escape(text)
                    for text, link in items
                ]
                out.append(r"    \small " + " $|$ ".join(parts))
            case Heading(text):
                if skills:
                    out.append(" \\\\\n".join(skills))
                    skills = []
                close_section()
                out.append(rf"\section{{{escape(text)}}}")
            case EntryHeader(left, right, sub_left, sub_right, note):
                close_items()
                if not in_entries:
                    out.append(r"  \resumeSubHeadingListStart")
                    in_entries = True
                if sub_left or sub_right:
                    out.append(
                        r"    \resumeSubheading"
                        f"\n      {{{escape(left)}}}{{{escape(right)}}}"
                        f"\n      {{{escape(sub_left)}}}{{{escape(sub_right)}}}"
                    )
                else:
                    title = rf"\textbf{{{escape(left)}}}"
                    if note:
                        title += rf" $|$ \emph{{{escape(note)}}}"
                    out.append(rf"      \resumeProjectHeading" f"\n          {{{title}}}{{{escape(right)}}}")
            case Bullet(text):
                if not in_items:
                    out.append(r"      \resumeItemListStart")
                    in_items = True
                out.append(rf"        \resumeItem{{{escape(text)}}}")
            case SkillLine(label, text):
                if not in_skills:
                    out.append(r" \begin{itemize}[leftmargin=0.15in, label={}]")
                    out.append(r"    \small{\item{")
                    in_skills = True
                skills.append(rf"     \textbf{{{escape(label)}}}{{: {escape(text)}}}")
    if skills:
        out.append(" \\\\\n".join(skills))
    close_section()
    return "\n".join(out)


@lru_cache
def _vendored_cache() -> str:
    '''The vendored cache, copied once per process to where it can be written.'''
    target = Path(tempfile.gettempdir()) / "workit-tectonic-cache"
    if not target.exists():
        shutil.copytree(VENDOR / "cache", target)
    return str(target)


@lru_cache
def _runnable(binary: Path) -> str:
    '''The binary as something this process may execute. A deployment that
    drops its execute bit gets a copy in /tmp with it set back.'''
    # The mode, not os.access: root passes X_OK whatever the bits say
    if binary.stat().st_mode & stat.S_IXUSR:
        return str(binary)
    copy = Path(tempfile.gettempdir()) / "workit-tectonic"
    if not copy.exists():
        shutil.copy(binary, copy)
        copy.chmod(0o755)
    return str(copy)


# All a compile's environment holds. Never the API's own: a document that
# reads a file could print what it holds (latex_source/safety.py stops that,
# and this is the second wall), and the API's environment is its secrets.
_ENV_KEEP = ("PATH", "HOME", "TMPDIR", "LANG", "LC_ALL", "XDG_CACHE_HOME", "SSL_CERT_FILE", "SSL_CERT_DIR")


def _env(**extra: str) -> dict[str, str]:
    return {**{k: os.environ[k] for k in _ENV_KEEP if k in os.environ}, **extra}


def tectonic() -> tuple[str, dict[str, str], bool]:
    '''The binary, its environment, and whether to stay offline; or
    LatexUnavailable.'''
    vendored = VENDOR / "tectonic"
    if not os.environ.get("TECTONIC_BIN") and vendored.exists() and (VENDOR / "cache").exists():
        return _runnable(vendored), _env(TECTONIC_CACHE_DIR=_vendored_cache()), True
    found = os.environ.get("TECTONIC_BIN") or shutil.which("tectonic")
    if not found or not Path(found).exists():
        raise LatexUnavailable("tectonic not found")
    cache = os.environ.get("TECTONIC_CACHE_DIR")
    return found, _env(TECTONIC_CACHE_DIR=cache) if cache else _env(), False


class LatexError(LatexUnavailable):
    '''The document itself doesn't compile: TeX's first complaint, and the
    line of the source it was on when it said so.'''

    def __init__(self, message: str, line: int | None = None):
        super().__init__(message)
        self.message = message
        self.line = line


# Tectonic prints a TeX error as "error: resume.tex:12: Undefined control sequence"
_TEX_ERROR = re.compile(r"^error: [^:\n]*\.tex:(\d+): (.+)$", re.MULTILINE)


def compile_tex(source: str, *, timeout: int = TIMEOUT_SECONDS) -> tuple[bytes, int]:
    '''A whole LaTeX document as a PDF and its page count. LatexError when the
    document is at fault, LatexUnavailable when TeX can't run at all.'''
    binary, env, offline = tectonic()
    with tempfile.TemporaryDirectory() as work:
        tex = Path(work) / "resume.tex"
        tex.write_text(source)
        command = [binary, "-X", "compile", "--untrusted", "--outdir", work, str(tex)]
        if offline:
            command.insert(3, "--only-cached")
        try:
            done = subprocess.run(
                command, capture_output=True, text=True, timeout=timeout, check=False, env=env, cwd=work)
        except subprocess.TimeoutExpired as exc:
            raise LatexError("This took too long to compile. Look for a loop or a very long table.") from exc
        except OSError as exc:
            # Couldn't start at all (not executable, wrong platform): still
            # the fallback's case, never a 500
            raise LatexUnavailable(f"tectonic could not run: {exc}") from exc
        pdf = Path(work) / "resume.pdf"
        if done.returncode != 0 or not pdf.exists():
            found = _TEX_ERROR.search(done.stderr)
            if found:
                raise LatexError(found.group(2).strip(), int(found.group(1)))
            if "not found in bundle" in done.stderr or "not available in offline" in done.stderr:
                raise LatexError("This uses a package or font WorkIt can't load.")
            raise LatexUnavailable(f"tectonic failed: {done.stderr[-2000:]}")
        data = pdf.read_bytes()
    return data, len(PdfReader(BytesIO(data)).pages)


def write_latex_pdf(blocks: list[Block]) -> tuple[bytes, int]:
    '''The file and how many pages it ran to.'''
    return compile_tex(TEMPLATE.read_text().replace("\n%%BODY%%\n", f"\n{body(blocks)}\n"))
