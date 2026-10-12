'''
A TeX source as tokens, each with its byte span in the source, so whatever
reads them can point back at exactly the characters it means.

Deliberately small: TeX's real tokenizer depends on catcodes the document can
change, and this one doesn't follow them. It reads the standard catcodes,
with one exception: `@` counts as a letter, as it does after \\makeatletter,
so the safety check (safety.py) sees `\\@@input` as the one command it is.
Square brackets are text tokens of their own, so an [option] ends where its
"]" is even when words follow on the same line.
'''
import re
from dataclasses import dataclass
from typing import Literal

Kind = Literal["word", "symbol", "open", "close", "math", "comment", "text"]


@dataclass(frozen=True)
class Token:
    kind: Kind
    start: int
    end: int
    # A control word's or symbol's name without the backslash ("textbf",
    # "&"); otherwise the source text
    value: str


# Math before symbols, so \( and \[ open math rather than reading as \( alone;
# display math before inline, so "$$" isn't read as an empty "$...$"
_TOKEN = re.compile(
    r"""
    (?P<math>\$\$(?:\\.|[^$\\])*\$\$|\$(?:\\.|[^$\\])*\$|\\\((?:.|\n)*?\\\)|\\\[(?:.|\n)*?\\\])
  | (?P<word>\\[A-Za-z@]+\*?)
  | (?P<symbol>\\[^A-Za-z@])
  | (?P<open>\{)
  | (?P<close>\})
  | (?P<comment>%[^\n]*)
  | (?P<text>[^\\{}$%\[\]]+|[\[\]]|\$)
    """,
    re.VERBOSE,
)


def tokenize(source: str, start: int = 0, end: int | None = None) -> list[Token]:
    out: list[Token] = []
    stop = len(source) if end is None else end
    pos = start
    while pos < stop:
        match = _TOKEN.match(source, pos, stop)
        if match is None:  # a lone trailing backslash
            out.append(Token("text", pos, stop, source[pos:stop]))
            break
        kind = match.lastgroup
        text = match.group()
        value = text[1:] if kind in ("word", "symbol") else text
        out.append(Token(kind, match.start(), match.end(), value))  # type: ignore[arg-type]
        pos = match.end()
    return out


def line_of(source: str, offset: int) -> int:
    '''1-based line number of a byte offset, as an editor counts.'''
    return source.count("\n", 0, offset) + 1


def body_span(source: str) -> tuple[int, int]:
    '''Where the document's body is: after \\begin{document}, before
    \\end{document}. The whole source when it has neither, for a fragment.'''
    begin = re.search(r"\\begin\s*\{document\}", source)
    end = re.search(r"\\end\s*\{document\}", source)
    return (begin.end() if begin else 0, end.start() if end else len(source))
