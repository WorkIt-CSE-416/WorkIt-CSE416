'''
Built resumes as Jake's Resume, compiled by Tectonic (ADR 0002, KAN-204).

    escape(text)        the one way applicant text enters the LaTeX
    jakes_document(b)   Jake's preamble, byte for byte, around body b
    compile_pdf(tex)    a whole document -> PDF bytes, offline and untrusted

Stdlib only: scripts/fetch_tectonic.py imports this before Vercel's build has
installed anything. The rules are in CLAUDE.md beside this file.
'''

import os
import shutil
import subprocess
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
TEMPLATE = HERE / "jakes.tex"
BODY_MARKER = "\n%%BODY%%\n"
# Built by scripts/fetch_tectonic.py: the pinned binary (Linux) and the warm
# package cache. Gitignored
VENDOR = HERE.parents[2] / "vendor" / "tectonic"
COMPILE_TIMEOUT_SECONDS = 60

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
        command = [str(binary), "-X", "compile", "--untrusted", "--outdir", work, str(source)]
        if offline:
            command.insert(3, "--only-cached")
        try:
            result = subprocess.run(
                command, env=_env(cache, work), capture_output=True, text=True,
                timeout=COMPILE_TIMEOUT_SECONDS, check=False,
            )
        except subprocess.TimeoutExpired as exc:
            raise TectonicUnavailable("tectonic timed out") from exc
        pdf = Path(work) / "resume.pdf"
        if result.returncode != 0 or not pdf.exists():
            raise TectonicUnavailable(f"tectonic failed: {result.stderr[-2000:]}")
        return pdf.read_bytes()


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
