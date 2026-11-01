"""A posting's text: HTML to lines and plain text, the `Page` built from it, and
the work model and places its fields name."""

from __future__ import annotations

import html
import re
from collections.abc import Iterable
from html.parser import HTMLParser

from workit_scraper import details
from workit_scraper.providers.model import PAGE_VERSION, Page
from workit_scraper.sections import kept

#: Longest description kept, about 2,000 tokens. Measured on the 2026-10-05
#: feed: at 3,000 a fifth of roles lost their requirements behind a long company
#: intro, which is the part Scout reads for. Past this is benefits and
#: boilerplate. Changing it does not re-cut stored Greenhouse descriptions --
#: see scraper/CLAUDE.md.
DESCRIPTION_CHARS = 8000


class _TextOnly(HTMLParser):
    """An HTML fragment's text, with a line break wherever a block ended, and the
    tags open around each piece of it."""

    BLOCKS = {"p", "div", "li", "br", "h1", "h2", "h3", "h4", "h5", "h6", "ul", "ol", "tr"}
    #: Tags that never close, so are never open around text.
    VOID = {"br", "img", "hr", "input", "meta", "link", "wbr", "col", "area", "base", "source"}

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.parts: list[tuple[str, tuple[str, ...]]] = []
        self.open: list[str] = []

    def handle_starttag(self, tag: str, attrs: object) -> None:
        if tag in self.BLOCKS:
            self.parts.append(("\n", ()))
        if tag not in self.VOID:
            self.open.append(tag)

    def handle_startendtag(self, tag: str, attrs: object) -> None:
        # "<br/>": a start and an end, two breaks, as before tags were tracked.
        if tag in self.BLOCKS:
            self.parts.extend((("\n", ()), ("\n", ())))

    def handle_endtag(self, tag: str) -> None:
        if tag in self.BLOCKS:
            self.parts.append(("\n", ()))
        for index in range(len(self.open) - 1, -1, -1):
            if self.open[index] == tag:
                del self.open[index:]
                break

    def handle_data(self, data: str) -> None:
        self.parts.append((data, tuple(self.open)))


def plain_lines(markup: str | None) -> list[tuple[str, str]]:
    """A description's plain-text lines, each with its role in the HTML: "h" inside a
    heading tag, "li" inside a list item, "b" when all of it is bold, "p" otherwise.

    The text is `plain_text`'s, line for line. The roles are what the HTML says and
    the text alone cannot: the section parser used to guess them from a line's
    shape, and took Workday's list item "Good interpersonal skills" for a heading
    (`sections._walk`). Plain text in, every line is "p".

    Unescaped once before parsing because Greenhouse entity-escapes its HTML
    ("&lt;p&gt;"), which the parser would otherwise keep as literal text.
    """
    if not markup:
        return []
    parser = _parsed(markup)
    text = "".join(piece for piece, _ in parser.parts)
    # The tags open around each character, to read each line's role from.
    around = [tags for piece, tags in parser.parts for _ in piece]
    lines, start = [], 0
    for raw in text.splitlines(keepends=True):
        body = raw.rstrip("\r\n\x0b\x0c\x1c\x1d\x1e\x85\u2028\u2029")
        line = _squeezed(body)
        if line:
            tags = [around[start + k] for k, char in enumerate(body) if not char.isspace()]
            lines.append((line, _line_role(tags)))
        start += len(raw)
    return lines


def _line_role(tags: list[tuple[str, ...]]) -> str:
    """One line's role from the tags open around each of its characters."""
    if any(re.fullmatch(r"h[1-6]", tag) for open_tags in tags for tag in open_tags):
        return "h"
    if any("li" in open_tags for open_tags in tags):
        return "li"
    if tags and all("strong" in open_tags or "b" in open_tags for open_tags in tags):
        return "b"
    return "p"


def _parsed(markup: str) -> _TextOnly:
    parser = _TextOnly()
    parser.feed(html.unescape(markup))
    parser.close()
    return parser


def _squeezed(line: str) -> str:
    return re.sub(r"[ \t\xa0]+", " ", line).strip()


def plain_text(markup: str | None) -> str | None:
    """Plain text from a description that may be HTML, whole: a line wherever a
    block ended. `plain_lines`'s lines without their roles, which cost about five
    times the rest of the parse."""
    if not markup:
        return None
    text = "".join(piece for piece, _ in _parsed(markup).parts)
    return "\n".join(line for raw in text.splitlines() if (line := _squeezed(raw))) or None


def _described(markup: str | None) -> tuple[str | None, tuple[str, ...]]:
    """A description's plain text and its lines' roles (`plain_lines`), for `_page`."""
    lines = plain_lines(markup)
    return "\n".join(line for line, _ in lines) or None, tuple(role for _, role in lines)


def cap(plain: str | None) -> str | None:
    """At most DESCRIPTION_CHARS, cut at a word: what is stored for Scout."""
    if plain is None or len(plain) <= DESCRIPTION_CHARS:
        return plain
    return plain[:DESCRIPTION_CHARS].rsplit(maxsplit=1)[0] + " …"


def _page(
    title: str,
    full: str | None,
    *,
    roles: tuple[str, ...] | None = None,
    stated_type: str | None = None,
    stated_style: str | None = None,
    stated_pay: details.Pay | None = None,
    offices: tuple[str, ...] = (),
    requisition: str | None = None,
) -> Page:
    """A Page from a posting's whole text: facts read from all of it first, then the
    description is its kept sections (`sections.kept`), cut after. `roles` is each
    line's role in the HTML (`plain_lines`), when the provider sent HTML."""
    facts = details.read(
        title, full, stated_type=stated_type, stated_style=stated_style, stated_pay=stated_pay
    )
    return Page(
        version=PAGE_VERSION,
        description=cap(kept(full, roles)),
        facts=facts,
        offices=offices,
        requisition=requisition,
    )


def _work_style(value: object, location: str | None) -> str | None:
    """Remote / Hybrid / On site, or None when the provider does not say.

    Ashby sends `Remote|Hybrid|OnSite`, Lever sends the same words lowercased,
    Workable `remote|hybrid|on_site`, and Greenhouse sends nothing at all -- so on
    a Greenhouse board only a location that says remote fills it in.
    Blank is the honest answer; guessing "On site" because a field is missing would
    put a fact on the page that no employer stated. A location that says remote is
    the one safe inference.
    """
    text = str(value or "").strip().lower()
    if text.startswith("remote"):
        return "Remote"
    if text.startswith("hybrid"):
        return "Hybrid"
    if re.sub(r"[-_ ]", "", text) in {"onsite", "inoffice"}:
        return "On site"
    if location and "remote" in location.lower():
        return "Remote"
    return None


def _place(*parts: object) -> str:
    """ "Munich, Bavaria, Germany" from a provider's split fields, each part once:
    Workable writes Ely as "Ely, Ely, United Kingdom"."""
    named = (str(part).strip() for part in parts if part)
    return ", ".join(dict.fromkeys(part for part in named if part))


def _places(places: Iterable[str | None]) -> str | None:
    """Several places as one location, as Greenhouse boards write them
    ("Stamford, CT; New York, NY"); the backend's resolver splits on ";"."""
    return "; ".join(dict.fromkeys(place for place in places if place)) or None
