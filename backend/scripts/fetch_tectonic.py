"""
Fetch Tectonic and warm its package cache into backend/vendor/tectonic/, so
the API compiles Jake's Resume with no network (KAN-176,
app/services/resume_render/CLAUDE.md). Stdlib only, so a build step can run it
before anything is installed:

    python3 scripts/fetch_tectonic.py           fetch and warm (Vercel's build command,
                                                in vercel.json beside this folder)
    python3 scripts/fetch_tectonic.py --check   compile once from the cache, offline

The binary is pinned and checked against its published SHA-256. Warming
compiles the template once, which downloads every package it uses (~40 MB)
into vendor/tectonic/cache, then one small document per package and class an
applicant's own LaTeX may load (app/services/latex_source/packages.txt), so
those compile offline too. vendor/ is gitignored: it is built, not committed.
"""

import argparse
import hashlib
import io
import os
import subprocess
import sys
import tarfile
import tempfile
import urllib.request
from pathlib import Path

VERSION = "0.17.0"
ASSET = f"tectonic-{VERSION}-x86_64-unknown-linux-musl.tar.gz"
URL = f"https://github.com/tectonic-typesetting/tectonic/releases/download/tectonic%40{VERSION}/{ASSET}"
SHA256 = "8533d07f9ccbd7a65824b9e0459041bca34af1eb33daba48f59215593753a3b7"

BACKEND = Path(__file__).resolve().parents[1]
VENDOR = BACKEND / "vendor" / "tectonic"
TEMPLATE = BACKEND / "app" / "services" / "resume_render" / "jakes.tex"
PACKAGES = BACKEND / "app" / "services" / "latex_source" / "packages.txt"
# Written once the cache holds every package, so a re-run does nothing. Named
# for the list, so adding a package warms again
WARM = VENDOR / f".warm-{hashlib.sha256(PACKAGES.read_bytes()).hexdigest()[:12]}"
# Text in every size and shape a resume sets, so a font's files are fetched
# too: loading a package fetches no font until a glyph is drawn, and Latin
# Modern keeps each optical size (5 to 17pt) in a file of its own. A \LARGE
# name missed this once (2026-10-12) and failed offline
SIZES = ("tiny", "scriptsize", "footnotesize", "small", "normalsize", "large", "Large", "LARGE", "huge", "Huge")
SHAPES = r"Ré \textbf{B} \textit{I} \textsl{S} \textsc{Sc} \textbf{\textit{BI}} \textbf{\textsc{BSc}} \texttt{T} \textsf{F} \textsf{\textbf{FB}} $x^2_i \sim |$"
WARM_BODY = "\n".join(f"{{\\{size} {SHAPES}}}\\par" for size in SIZES)
# Point sizes each class is set in, which shift every size above
CLASS_OPTIONS = {"article": ("10pt", "11pt", "12pt"), "extarticle": ("8pt", "9pt", "10pt", "11pt", "12pt", "14pt")}
# The icons a contact line uses, for the two icon packages
ICONS = {"fontawesome5": r"\faGithub \faLinkedin \faEnvelope \faPhone", "fontawesome": r"\faGithub \faEnvelope"}
# Every command and package the template's body can use, so the cache holds
# all of them: a heading, both entry kinds, bullets, a link, skills
SAMPLE = r"""
\begin{center}
    \textbf{\Huge \scshape José Ryan} \\ \vspace{1pt}
    \small 1 $|$ \href{mailto:a@b.c}{\underline{a@b.c}}
\end{center}
\section{Experience}
  \resumeSubHeadingListStart
    \resumeSubheading{A}{B}{C}{D}
      \resumeItemListStart
        \resumeItem{E – F}
      \resumeItemListEnd
      \resumeProjectHeading{\textbf{G} $|$ \emph{H}}{I}
  \resumeSubHeadingListEnd
\section{Technical Skills}
 \begin{itemize}[leftmargin=0.15in, label={}]
    \small{\item{
     \textbf{J}{: K}
    }}
 \end{itemize}
"""


def compile_sample(binary: Path, cache: Path, *, offline: bool) -> None:
    compile_source(TEMPLATE.read_text().replace("\n%%BODY%%\n", f"\n{SAMPLE}\n"), binary, cache, offline=offline)


def warm_documents() -> list[str]:
    '''One document per listed package and class.'''
    listed = [line.split() for line in PACKAGES.read_text().splitlines() if line.strip() and not line.startswith("#")]
    docs = []
    for words in listed:
        if words[0] == "class":
            for option in CLASS_OPTIONS.get(words[1], ("",)):
                docs.append(f"\\documentclass[{option}]{{{words[1]}}}\n\\begin{{document}}\n{WARM_BODY}\n\\end{{document}}\n")
        else:
            package = words[0]
            body = f"{WARM_BODY}\n{ICONS.get(package, '')}"
            docs.append(f"\\documentclass{{article}}\n\\usepackage{{{package}}}\n\\begin{{document}}\n{body}\n\\end{{document}}\n")
    return docs


def compile_source(source: str, binary: Path, cache: Path, *, offline: bool) -> None:
    with tempfile.TemporaryDirectory() as work:
        tex = Path(work) / "sample.tex"
        tex.write_text(source)
        command = [str(binary), "-X", "compile", "--untrusted", "--outdir", work, str(tex)]
        if offline:
            command.insert(3, "--only-cached")
        env = {**os.environ, "TECTONIC_CACHE_DIR": str(cache)}
        subprocess.run(command, check=True, env=env)
        if not (Path(work) / "sample.pdf").exists():
            sys.exit("tectonic made no PDF")


def fetch() -> Path:
    VENDOR.mkdir(parents=True, exist_ok=True)
    binary = VENDOR / "tectonic"
    if not binary.exists():
        print(f"downloading {ASSET}")
        data = urllib.request.urlopen(URL, timeout=120).read()
        if hashlib.sha256(data).hexdigest() != SHA256:
            sys.exit("checksum mismatch: refusing to install")
        with tarfile.open(fileobj=io.BytesIO(data)) as archive:
            member = archive.getmember("tectonic")
            binary.write_bytes(archive.extractfile(member).read())
        binary.chmod(0o755)
    return binary


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--check", action="store_true", help="compile once from the cache, offline")
    args = parser.parse_args(argv)
    if args.check:
        compile_sample(VENDOR / "tectonic", VENDOR / "cache", offline=True)
        for doc in warm_documents():
            compile_source(doc, VENDOR / "tectonic", VENDOR / "cache", offline=True)
    elif WARM.exists():
        print("already fetched and warm; nothing to do")
    else:
        binary = fetch()
        compile_sample(binary, VENDOR / "cache", offline=False)
        for doc in warm_documents():
            compile_source(doc, binary, VENDOR / "cache", offline=False)
        WARM.touch()
    size = sum(f.stat().st_size for f in VENDOR.rglob("*") if f.is_file()) / 1e6
    print(f"{'offline compile ok' if args.check else 'tectonic and its cache ready'}: {VENDOR} ({size:.0f} MB)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
