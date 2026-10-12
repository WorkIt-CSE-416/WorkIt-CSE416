'''
Where the words are in an applicant's own LaTeX: every run of text in the
document body, as a Field with its exact span in the source. The Words view
shows these, splice.py replaces them, and tailoring rewords the bullets
among them. Everything outside a field (the preamble, commands, lengths,
links' targets, environments) is structure, and nothing here changes it.

A field is one of:
- **heading**: a \\section's title.
- **bullet**: the argument of a one-argument macro whose definition makes an
  \\item (Jake's \\resumeItem and its many relatives, found from the
  preamble, so no template is named here), or the text after a plain \\item.
  A list in a skills section, or a line that is a comma list, is "text"
  instead: tailoring rewords prose, never a skill list.
- **text**: any other run of words, such as a name, a company or a date.

A field `plain` can't express (a link inside a bullet, a command this
doesn't know) is still listed, with `editable` False and its raw LaTeX as
`text`, so the Words view shows it in place and points at the Source tab.

Field ids are positional ("f0", "f1", …): the same source always gives the
same ids, and every edit names the source it was made against.
'''
import re
from dataclasses import dataclass, field
from typing import Literal

from app.services.latex_source.inline import (
    CHARACTERS,
    FORMATS,
    SYMBOLS,
    math_symbol,
    to_plain,
)
from app.services.latex_source.tokens import Token, body_span, line_of, tokenize

FieldKind = Literal["heading", "bullet", "text"]

# Commands whose first N braced arguments are never words: lengths, colours,
# link targets, labels, layout. What follows them is read as usual, so
# \href{url}{text}'s text is still a field.
LOCKED_ARGS = {
    "usepackage": 1, "documentclass": 1, "vspace": 1, "hspace": 1, "setlength": 2,
    "addtolength": 2, "color": 1, "pagecolor": 1, "textcolor": 1, "colorbox": 1,
    "href": 1, "url": 1, "nolinkurl": 1, "label": 1, "ref": 1, "pageref": 1,
    "hyperlink": 1, "hypertarget": 1, "extracolsep": 1, "rule": 2, "raisebox": 1,
    "fontsize": 2, "pagestyle": 1, "thispagestyle": 1, "fancyhf": 1, "fontfamily": 1,
    "multicolumn": 2, "cline": 1, "linespread": 1, "geometry": 1, "hypersetup": 1,
    "faIcon": 1, "setlist": 1, "titleformat": 5, "titlespacing": 5, "newcommand": 1,
    "renewcommand": 1, "providecommand": 1, "setcounter": 2, "addtocounter": 2,
    "definecolor": 3, "columnratio": 1, "switchcolumn": 0, "kern": 0, "hfill": 0,
}
# A heading's argument: its runs are "heading" fields and name the section
HEADINGS = frozenset({"section", "subsection", "chapter"})
# Sections whose lists are skills or the like: never reworded
LISTY_SECTION = re.compile(r"skill|technolog|tool|languages|interests|coursework|certific", re.IGNORECASE)
_WORDY = re.compile(r"[^\W_]")
# What a run may start or end with that belongs to neither side: spaces and
# the separators a header line puts between items
_EDGE = r"(?:\s|[,:;|]|\$\s*\|\s*\$|\\textbar\{\}|\\quad|\\qquad)+"
_LEAD = re.compile(rf"^{_EDGE}")
_TRAIL = re.compile(rf"{_EDGE}$")


@dataclass(frozen=True)
class Field:
    id: str
    start: int
    end: int
    kind: FieldKind
    # The words as plain text, or the raw LaTeX when not `editable`
    text: str
    editable: bool
    # 0-based index of the \section it falls under; -1 before the first
    section: int
    line: int
    # A bullet's whole construct (\resumeItem{...}, or \item and its text),
    # which adding or removing a bullet copies or cuts
    unit_start: int
    unit_end: int


@dataclass
class Macros:
    '''What the preamble's \\newcommand and \\def lines say about each macro.'''
    args: dict[str, int] = field(default_factory=dict)
    bullet: set[str] = field(default_factory=set)


_NEWCOMMAND = re.compile(
    r"\\(?:re)?newcommand\*?\s*\{?\s*\\([A-Za-z@]+)\s*\}?\s*(?:\[(\d)\])?\s*(?:\[[^\]]*\])?\s*\{")
_DEF = re.compile(r"\\def\s*\\([A-Za-z@]+)((?:#\d)*)\s*\{")


def _group_end(source: str, open_at: int) -> int:
    '''Index just after the brace group that opens at `open_at`.'''
    depth = 0
    for t in tokenize(source, open_at):
        depth += t.kind == "open"
        depth -= t.kind == "close"
        if depth == 0:
            return t.end
    return len(source)


def macros(source: str) -> Macros:
    found = Macros()
    bodies: dict[str, str] = {}
    for pattern in (_NEWCOMMAND, _DEF):
        for m in pattern.finditer(source):
            name = m.group(1)
            n = int(m.group(2)) if pattern is _NEWCOMMAND and m.group(2) else (
                m.group(2).count("#") if pattern is _DEF else 0)
            found.args[name] = n
            bodies[name] = source[m.end():_group_end(source, m.end() - 1) - 1]
    # A macro makes an \item if its body does, or calls one that does
    makes_item = {name for name, body in bodies.items() if re.search(r"\\item(?![A-Za-z@])", body)}
    changed = True
    while changed:
        changed = False
        for name, body in bodies.items():
            if name not in makes_item and any(
                    re.search(rf"\\{re.escape(other)}(?![A-Za-z@])", body) for other in makes_item):
                makes_item.add(name)
                changed = True
    found.bullet = {name for name in makes_item if found.args.get(name) == 1}
    return found


class _Reader:
    def __init__(self, source: str, tokens: list[Token], known: Macros):
        self.source = source
        self.tokens = tokens
        self.known = known
        self.fields: list[Field] = []
        self.section = -1
        self.section_title = ""

    # --- small helpers -------------------------------------------------------

    def skip_space(self, i: int) -> int:
        while i < len(self.tokens) and self.tokens[i].kind == "text" and not self.tokens[i].value.strip():
            i += 1
        return i

    def skip_option(self, i: int) -> int:
        '''Past a [...] option at token i (spaces first), if there is one.'''
        j = self.skip_space(i)
        if j >= len(self.tokens) or self.tokens[j].value != "[" or self.tokens[j].kind != "text":
            return i
        depth = 0
        while j < len(self.tokens):
            t = self.tokens[j]
            depth += t.kind == "open"
            depth -= t.kind == "close"
            j += 1
            if depth == 0 and t.kind == "text" and t.value == "]":
                break
        return j

    def group_close(self, i: int) -> int:
        '''Index of the token closing the group opened at token i.'''
        depth = 0
        for j in range(i, len(self.tokens)):
            depth += self.tokens[j].kind == "open"
            depth -= self.tokens[j].kind == "close"
            if depth == 0:
                return j
        return len(self.tokens) - 1

    def skip_groups(self, i: int, count: int) -> int:
        '''Past `count` braced arguments (and any options between them).'''
        for _ in range(count):
            i = self.skip_option(i)
            j = self.skip_space(i)
            if j >= len(self.tokens) or self.tokens[j].kind != "open":
                return i
            i = self.group_close(j) + 1
        return i

    # --- fields --------------------------------------------------------------

    def add(self, start: int, end: int, kind: FieldKind, unit: tuple[int, int] | None = None,
            *, trim_edges: bool = True) -> None:
        raw = self.source[start:end]
        lead = (_LEAD if trim_edges else re.compile(r"^\s+")).match(raw)
        start += lead.end() if lead else 0
        raw = self.source[start:end]
        trail = (_TRAIL if trim_edges else re.compile(r"\s+$")).search(raw)
        end -= len(raw) - trail.start() if trail else 0
        raw = self.source[start:end]
        if not _WORDY.search(raw):
            return
        plain = to_plain(raw)
        if kind == "bullet" and (LISTY_SECTION.search(self.section_title) or _is_list(plain or raw)):
            kind = "text"
        self.fields.append(Field(
            id=f"f{len(self.fields)}", start=start, end=end, kind=kind,
            text=plain if plain is not None else raw, editable=plain is not None,
            section=self.section, line=line_of(self.source, start),
            unit_start=unit[0] if unit else start, unit_end=unit[1] if unit else end,
        ))

    def inline(self, i: int) -> int | None:
        '''Index after the token at i when it belongs inside a run of words
        (text, an escape, a symbol, \\textbf{words}); None when it ends one.'''
        t = self.tokens[i]
        if t.kind == "text":
            return None if "&" in t.value else i + 1
        if t.kind == "symbol":
            return i + 1 if t.value in SYMBOLS else None
        if t.kind == "math":
            return i + 1 if math_symbol(t.value) is not None else None
        if t.kind == "word" and t.value in CHARACTERS:
            j = i + 1
            if j + 1 < len(self.tokens) and self.tokens[j].kind == "open" and self.tokens[j + 1].kind == "close":
                j += 2
            return j
        if t.kind == "word" and t.value in FORMATS:
            j = self.skip_space(i + 1)
            if j < len(self.tokens) and self.tokens[j].kind == "open":
                close = self.group_close(j)
                if to_plain(self.source[self.tokens[j].end:self.tokens[close].start], formats=False) is not None:
                    return close + 1
        return None

    def read(self, i: int, stop: int, kind: FieldKind = "text") -> None:
        '''Fields in tokens[i:stop], one context: a group, or the body.'''
        run_start: int | None = None
        run_end = 0

        def flush() -> None:
            nonlocal run_start
            if run_start is not None:
                self.add(run_start, run_end, kind)
                run_start = None

        while i < stop:
            t = self.tokens[i]
            nxt = self.inline(i)
            if nxt is not None and nxt <= stop:
                if run_start is None:
                    run_start = t.start
                run_end = self.tokens[nxt - 1].end
                i = nxt
                continue
            # Text holding "&" splits at each one: a table's columns
            if t.kind == "text" and "&" in t.value:
                offset = t.start
                for piece in t.value.split("&"):
                    if piece.strip():
                        if run_start is None:
                            run_start = offset
                        run_end = offset + len(piece)
                        flush()
                    else:
                        flush()
                    offset += len(piece) + 1
                i += 1
                continue
            flush()
            i = self.command(i, stop, kind)
        flush()

    def command(self, i: int, stop: int, kind: FieldKind) -> int:
        '''Reads the token at i, which ends a run, and returns where to go on.'''
        t = self.tokens[i]
        if t.kind == "open":
            close = min(self.group_close(i), stop)
            self.read(i + 1, close, kind)
            return close + 1
        if t.kind != "word":
            # \\ and its optional [2pt], a comment, math, a stray brace
            return self.skip_option(i + 1) if t.kind == "symbol" and t.value == "\\" else i + 1
        name = t.value.rstrip("*")
        if name in ("begin", "end"):
            i = self.skip_groups(i + 1, 1)
            # An environment's own arguments are its layout (tabular column
            # specs, minipage widths, itemize options): the options and
            # groups straight after its name, with nothing between
            while name == "begin" and i < len(self.tokens):
                nxt = self.tokens[i]
                if nxt.kind == "open":
                    i = self.group_close(i) + 1
                elif nxt.kind == "text" and nxt.value == "[":
                    i = self.skip_option(i)
                else:
                    break
            return i
        if name in HEADINGS:
            j = self.skip_option(i + 1)
            j = self.skip_space(j)
            if j < len(self.tokens) and self.tokens[j].kind == "open":
                close = self.group_close(j)
                self.section += 1
                self.section_title = self.source[self.tokens[j].end:self.tokens[close].start]
                self.read(j + 1, close, "heading")
                return close + 1
            return j
        if name == "item":
            return self.item(i, stop)
        if name in self.known.bullet:
            j = self.skip_space(i + 1)
            if j < len(self.tokens) and self.tokens[j].kind == "open":
                close = self.group_close(j)
                self.add(self.tokens[j].end, self.tokens[close].start, "bullet",
                         (t.start, self.tokens[close].end), trim_edges=False)
                return close + 1
            return j
        locked = LOCKED_ARGS.get(name)
        if locked is not None:
            return self.skip_groups(i + 1, locked)
        if name in ("def", "let"):
            return i + 2
        return i + 1

    def item(self, i: int, stop: int) -> int:
        '''\\item: a bullet runs from here to the next \\item, \\end or line
        break. \\item{...} straight after is a wrapper (Jake's skills list),
        read as text.'''
        j = self.skip_option(i + 1)
        k = self.skip_space(j)
        if k < stop and self.tokens[k].kind == "open":
            return k
        end = k
        while end < stop:
            t = self.tokens[end]
            if t.kind == "word" and t.value.rstrip("*") in ("item", "begin", "end"):
                break
            if t.kind == "symbol" and t.value == "\\":
                break
            if t.kind == "open":  # \textbf{...} and the like belong to the bullet
                end = min(self.group_close(end), stop - 1) + 1
                continue
            if t.kind == "close":  # the group the list is in closes
                break
            if t.kind == "text" and "\n\n" in t.value:
                break
            end += 1
        if end > k:
            last = self.tokens[end - 1]
            self.add(self.tokens[k].start, last.end, "bullet", (self.tokens[i].start, last.end),
                     trim_edges=False)
            # Unit ends at the bullet's last character, not the spaces after it
            if self.fields and self.fields[-1].unit_start == self.tokens[i].start:
                f = self.fields[-1]
                self.fields[-1] = Field(**{**f.__dict__, "unit_end": f.end})
        return end


def _is_list(text: str) -> bool:
    '''A comma list of short items ("Python, Java, SQL") rather than prose.'''
    parts = [p.strip() for p in re.split(r"[,;]", text) if p.strip()]
    return len(parts) >= 3 and sum(len(p.split()) for p in parts) / len(parts) <= 3


def fields(source: str) -> list[Field]:
    '''The body's fields in document order.'''
    start, end = body_span(source)
    reader = _Reader(source, tokenize(source, start, end), macros(source[:start]))
    reader.read(0, len(reader.tokens))
    return reader.fields
