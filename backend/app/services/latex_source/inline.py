'''
A field's LaTeX as plain text an applicant can edit, and back.

Plain text keeps the little formatting a resume line uses: **bold** for
\\textbf, *italic* for \\textit and \\emph. Escapes become the character they
print (\\& is &), and the few bits of math resumes use for symbols become the
symbol ($|$ is |, $\\sim$ is ∼). Anything else, a link or a command this
doesn't know, makes the field read-only (`to_plain` is None): it is edited in
the Source tab, where nothing is guessed.

Only an edited field is converted back, so a field nobody touched keeps its
exact bytes, and `to_latex(to_plain(x))` need only print the same as x.
'''
import re

from app.services.latex_source.tokens import tokenize
from app.services.resume_render.to_latex import escape

FORMATS = {"textbf": "**", "textit": "*", "emph": "*"}
# Symbol escapes and spacing commands, as the character they print
SYMBOLS = {"&": "&", "%": "%", "$": "$", "#": "#", "_": "_", "{": "{", "}": "}", " ": " ", ",": " ", "-": ""}
# Commands that print one character, written with or without a trailing {}
CHARACTERS = {"textasciitilde": "~", "textbackslash": "\\", "textbar": "|", "ldots": "…", "dots": "…", "textbullet": "•"}
# Inline math a resume uses for a symbol, spaces removed
MATH = {
    "$|$": "|", r"$\sim$": "∼", r"$\cdot$": "·", r"$\times$": "×", r"$\rightarrow$": "→",
    r"$\to$": "→", r"$\bullet$": "•", r"$\pm$": "±", r"$\geq$": "≥", r"$\leq$": "≤",
    r"$\approx$": "≈", r"$\ge$": "≥", r"$\le$": "≤",
}
# Back again: each symbol as the math it came from, and dashes as TeX types them
_BACK = {"|": "$|$", "∼": r"$\sim$", "·": r"$\cdot$", "×": r"$\times$", "→": r"$\rightarrow$",
         "•": r"$\bullet$", "±": r"$\pm$", "≥": r"$\geq$", "≤": r"$\leq$", "≈": r"$\approx$",
         "—": "---", "–": "--", "…": r"\ldots{}"}
_BACK_RE = re.compile("|".join(re.escape(c) for c in _BACK))
_MARKS = re.compile(r"\*\*(.+?)\*\*|\*([^*\s][^*]*?)\*")


def math_symbol(value: str) -> str | None:
    return MATH.get(re.sub(r"\s+", "", value))


def _text(value: str) -> str:
    return value.replace("---", "—").replace("--", "–").replace("~", " ")


def to_plain(latex: str, *, formats: bool = True) -> str | None:
    '''The field as plain text, or None when it holds something plain text
    can't say.'''
    tokens = tokenize(latex)
    out: list[str] = []
    i = 0
    while i < len(tokens):
        t = tokens[i]
        if t.kind == "text":
            if "&" in t.value:
                return None
            out.append(_text(t.value))
        elif t.kind == "symbol":
            if t.value not in SYMBOLS:
                return None
            out.append(SYMBOLS[t.value])
        elif t.kind == "math":
            symbol = math_symbol(t.value)
            if symbol is None:
                return None
            out.append(symbol)
        elif t.kind == "word" and t.value in CHARACTERS:
            out.append(CHARACTERS[t.value])
            if i + 2 < len(tokens) and tokens[i + 1].kind == "open" and tokens[i + 2].kind == "close":
                i += 2
        elif t.kind == "word" and t.value in FORMATS and formats:
            # \textbf{...}: its group must close, and hold plain text only
            if i + 1 >= len(tokens) or tokens[i + 1].kind != "open":
                return None
            depth, j = 0, i + 1
            while j < len(tokens):
                depth += tokens[j].kind == "open"
                depth -= tokens[j].kind == "close"
                if depth == 0:
                    break
                j += 1
            if j >= len(tokens):
                return None
            inner = to_plain(latex[tokens[i + 1].end:tokens[j].start], formats=False)
            if inner is None or not inner.strip():
                return None
            mark = FORMATS[t.value]
            # Spaces stay outside the marks, where "**x**" reads them
            lead, core, trail = re.match(r"(\s*)(.*?)(\s*)$", inner, re.DOTALL).groups()
            out.append(f"{lead}{mark}{core}{mark}{trail}")
            i = j
        else:
            return None
        i += 1
    return "".join(out)


def _escaped(text: str) -> str:
    return _BACK_RE.sub(lambda m: _BACK[m.group()], escape(text))


def to_latex(plain: str, *, italic: str = "textit") -> str:
    '''Plain text as LaTeX that prints it. `italic` is the command *x*
    becomes: the one the field used before, so an edit keeps \\emph an \\emph.'''
    plain = " ".join(plain.split())  # one line: a newline inside a field means nothing
    out: list[str] = []
    pos = 0
    for match in _MARKS.finditer(plain):
        out.append(_escaped(plain[pos:match.start()]))
        if match.group(1) is not None:
            out.append(rf"\textbf{{{_escaped(match.group(1))}}}")
        else:
            out.append(rf"\{italic}{{{_escaped(match.group(2))}}}")
        pos = match.end()
    out.append(_escaped(plain[pos:]))
    return "".join(out)


def italic_of(latex: str) -> str:
    return "emph" if r"\emph" in latex else "textit"


def unmarked(plain: str) -> str:
    '''The words alone, for ranking and for the model.'''
    return _MARKS.sub(lambda m: m.group(1) or m.group(2), plain)


def remarked(original: str, rewrite: str) -> str:
    '''A rewrite with the original's bold and italic put back wherever the
    marked words survive verbatim. A model never sees the marks (`unmarked`),
    so without this a tailored bullet would lose them.'''
    out = rewrite
    for match in _MARKS.finditer(original):
        words, mark = (match.group(1), "**") if match.group(1) is not None else (match.group(2), "*")
        found = re.search(rf"(?<![\w*]){re.escape(words)}(?![\w*])", out)
        if found:
            out = f"{out[:found.start()]}{mark}{words}{mark}{out[found.end():]}"
    return out
