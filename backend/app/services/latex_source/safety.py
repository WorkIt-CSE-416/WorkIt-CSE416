'''
The gate every applicant's own LaTeX passes before Tectonic sees it
(`prepare`). There is no other way in.

Tectonic's --untrusted turns off shell escape, but it still reads any file
the process can: `\\input{/etc/hosts}` compiles, and `\\openin`/`\\read` print
a file's lines into the PDF (tried 2026-10-12, Tectonic 0.17). On a server,
/proc/<pid>/environ holds the database URL and the service-role key. So
anything that opens a file by name is refused here, along with what could
build such a command out of harmless-looking text (\\csname, \\catcode,
\\scantokens, ^^ escapes), and packages and classes come from an allowlist,
the same list (packages.txt) scripts/fetch_tectonic.py warms the offline
cache with.

A refusal names the line and says what to change, in words an applicant can
act on. Comments are skipped: Jake's template carries commented-out
\\usepackage lines, and a comment never runs.
'''
import re
from dataclasses import dataclass
from pathlib import Path

from app.services.latex_source.tokens import line_of, tokenize

MAX_SOURCE_CHARS = 100_000

# What a pasted resume may load: packages.txt, which scripts/fetch_tectonic.py
# also reads to warm the offline cache with every one of them
_LISTED = [line.split() for line in (Path(__file__).parent / "packages.txt").read_text().splitlines()
           if line.strip() and not line.startswith("#")]
PACKAGES = frozenset(words[0] for words in _LISTED if len(words) == 1)
CLASSES = frozenset(words[1] for words in _LISTED if words[0] == "class")

# Commands that open a file by name, write one, or run code from text. Any
# command whose name contains "input" is refused as well (\@@input,
# \InputIfFileExists, \lstinputlisting, \verbatiminput, \pdfximage's kin);
# XeTeX's own primitives read image and PDF files.
BANNED = frozenset({
    "include", "includeonly", "IfFileExists", "openin", "read", "readline",
    "openout", "write", "immediate", "catcode", "csname", "scantokens",
    "directlua", "latelua", "special", "includegraphics", "includepdf", "font",
    "bibliography", "addbibresource", "LoadClass", "LoadClassWithOptions",
    "filedump", "pdffiledump", "filesize", "pdffilesize", "mdfivesum",
    "pdfmdfivesum", "filemoddate", "pdffilemoddate", "pdfximage", "pdfobj",
    "usetikzlibrary",
})
# Jake's own template, as Overleaf publishes it, loads this one file
ALLOWED_INPUTS = frozenset({"glyphtounicode", "glyphtounicode.tex"})
# Environments that write a file
BANNED_ENVIRONMENTS = frozenset({"filecontents", "filecontents*"})


@dataclass(frozen=True)
class Refused(Exception):
    message: str
    line: int | None = None

    def __str__(self) -> str:
        return f"Line {self.line}: {self.message}" if self.line else self.message


def _argument(tokens, i: int, source: str) -> tuple[str | None, int]:
    '''The {...} argument after token i, skipping spaces and one [...]
    option, and the index after it. None when there is no braced argument.'''
    j = i + 1
    while j < len(tokens) and tokens[j].kind == "text" and not tokens[j].value.strip():
        j += 1
    # An option is text that starts with "[", possibly with groups inside
    if j < len(tokens) and tokens[j].kind == "text" and tokens[j].value.lstrip().startswith("["):
        depth = 0
        while j < len(tokens):
            t = tokens[j]
            depth += t.kind == "open"
            depth -= t.kind == "close"
            j += 1
            if depth == 0 and t.kind == "text" and "]" in t.value:
                break
    while j < len(tokens) and tokens[j].kind == "text" and not tokens[j].value.strip():
        j += 1
    if j >= len(tokens) or tokens[j].kind != "open":
        return None, j
    depth, k = 0, j
    while k < len(tokens):
        depth += tokens[k].kind == "open"
        depth -= tokens[k].kind == "close"
        if depth == 0:
            break
        k += 1
    end = tokens[k].start if k < len(tokens) else len(source)
    return source[tokens[j].end:end], k + 1


def check(source: str) -> None:
    '''Refused when the source could read, write or run anything beyond
    typesetting itself; otherwise nothing.'''
    if len(source) > MAX_SOURCE_CHARS:
        raise Refused(f"This file is longer than {MAX_SOURCE_CHARS // 1000} KB, more than any resume needs.")
    every = tokenize(source)
    # ^^5c is a backslash before TeX reads any command, so it is looked for in
    # the raw text (comments blanked, offsets kept), never token by token
    uncommented = list(source)
    for t in every:
        if t.kind == "comment":
            uncommented[t.start:t.end] = " " * (t.end - t.start)
    caret = "".join(uncommented).find("^^")
    if caret != -1:
        raise Refused("“^^” character codes can't be compiled here. Type the character itself.",
                      line_of(source, caret))
    tokens = [t for t in every if t.kind != "comment"]
    for i, token in enumerate(tokens):
        line = line_of(source, token.start)
        if token.kind != "word":
            continue
        name = token.value.rstrip("*")
        if name in ("usepackage", "RequirePackage", "documentclass"):
            argument, _ = _argument(tokens, i, source)
            allowed = CLASSES if name == "documentclass" else PACKAGES
            for item in (argument or "").split(","):
                item = item.strip()
                if item and item not in allowed:
                    kind = "document class" if name == "documentclass" else "package"
                    raise Refused(
                        f"WorkIt can't compile the {kind} “{item}” yet. "
                        f"Remove it, or use one of: {', '.join(sorted(allowed))}.", line)
        elif "input" in name.lower():
            argument, _ = _argument(tokens, i, source)
            if not (name == "input" and argument is not None and argument.strip() in ALLOWED_INPUTS):
                raise Refused(f"\\{name} reads another file, which WorkIt can't compile. Paste that file's contents in its place.", line)
        elif name in BANNED or name.startswith("XeTeX"):
            raise Refused(f"\\{name} isn't allowed in a resume WorkIt compiles. Remove it.", line)
        elif name == "begin":
            argument, _ = _argument(tokens, i, source)
            if argument and argument.strip() in BANNED_ENVIRONMENTS:
                raise Refused(f"The {argument.strip()} environment writes a file, which WorkIt can't compile.", line)


# Jake's template as Overleaf publishes it runs these two pdfTeX-only lines.
# Tectonic is XeTeX, which has neither (and maps glyphs to Unicode by itself),
# so they are guarded, as in resume_render/jakes.tex. One line each, so the
# line numbers in an error still match what the applicant pasted.
_PDFTEX_ONLY = [
    (re.compile(r"(?<!\\ifdefined\\pdfgentounicode)\\input\s*\{glyphtounicode(?:\.tex)?\}"),
     r"\\ifdefined\\pdfgentounicode\\input{glyphtounicode}\\fi"),
    (re.compile(r"(?<!\\ifdefined\\pdfgentounicode)\\pdfgentounicode\s*=\s*1"),
     r"\\ifdefined\\pdfgentounicode\\pdfgentounicode=1\\fi"),
]


def prepare(source: str) -> str:
    '''The source as Tectonic should compile it, or Refused.'''
    check(source)
    for pattern, guarded in _PDFTEX_ONLY:
        source = pattern.sub(guarded, source)
    return source
