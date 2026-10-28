"""
A line typed in the resume editor, read into the change it saves (KAN-391).
The editor sends the clicked box's `item_id` and `kind` with the text as the
student typed it, and this decides what it means; the browser holds no copy
of these rules. Pure: the route saves the change and renders.

    parse(kind, text) -> Line   raises LineError, a 422 with its message

- **Where it goes:** a bullet becomes the resume's own wording (`BULLET`);
  an entry field changes the bank entry (`ENTRY_KINDS`), and so every
  resume that shows it; a header field changes the profile
  (`HEADER_KINDS`). Every other kind (dates, the degree line, the email,
  a skill) is not typed in the editor.
- **What is typed is what prints**, except where a field is stored as
  data that application forms read: the GPA is a number (an optional
  scale after "/"), coursework a list split at commas, and a link a URL
  ("https://" is added when missing). The GPA, coursework and honors lines
  print with a label ("GPA: "); typing the label back, or a damaged one
  ("Relevant Coursewok:"), is dropped rather than saved into the value.
- **Empty clears the field**, except a bullet, the entry's title and the
  name, which every resume needs: those answer LineError.
"""

import re
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation

BULLET = "bullet"
ENTRY_KINDS = ("title", "organization", "location", "honors", "coursework", "gpa")
LINK_KINDS = ("linkedin_url", "github_url", "portfolio_url", "other_url")
HEADER_KINDS = ("full_name", "phone_number", *LINK_KINDS)
# The label each detail line prints before its value (fields.details)
LABELS = {"gpa": "GPA", "coursework": "Relevant Coursework", "honors": "Honors"}
REQUIRED = {
    BULLET: "A bullet cannot be empty. Hide it instead.",
    "title": "The title cannot be empty.",
    "full_name": "Your name cannot be empty.",
}

_GPA = re.compile(r"(\d+(?:\.\d+)?)\s*(?:/\s*(\d+(?:\.\d+)?))?")
_SCHEME = re.compile(r"^https?://", re.IGNORECASE)


class LineError(ValueError):
    """The text cannot be saved; the message is for the student."""


@dataclass(frozen=True)
class Line:
    """Where a typed line goes (`bullet`, `entry` or `header`) and what it
    changes: the bullet's wording, or the entry's or profile's fields."""

    target: str
    changes: dict[str, object]


def _unlabelled(kind: str, text: str) -> str:
    # The label as printed, or one damaged while typing: text before the
    # first colon that starts with the label's first word
    first = LABELS[kind].split()[0]
    return re.sub(rf"^{first}[^:]{{0,30}}:\s*", "", text, flags=re.IGNORECASE).strip()


def _gpa(text: str) -> dict[str, object]:
    if not text:
        return {"gpa": None, "gpa_scale": None}
    match = _GPA.fullmatch(text)
    if match is None:
        raise LineError("Type the GPA as a number, like 3.8 or 3.8/4.0.")
    try:
        score, scale = (Decimal(g) if g else None for g in match.groups())
    except InvalidOperation as exc:
        raise LineError("Type the GPA as a number, like 3.8 or 3.8/4.0.") from exc
    return {"gpa": score, "gpa_scale": scale}


def parse(kind: str, text: str) -> Line:
    text = text.strip()
    if kind in REQUIRED and not text:
        raise LineError(REQUIRED[kind])
    if kind == BULLET:
        return Line("bullet", {"text": text})
    if kind in LABELS:
        text = _unlabelled(kind, text)
    if kind == "gpa":
        return Line("entry", _gpa(text))
    if kind == "coursework":
        return Line("entry", {"coursework": [c.strip() for c in text.split(",") if c.strip()]})
    if kind in ENTRY_KINDS:
        return Line("entry", {kind: text or None})
    if kind in LINK_KINDS:
        url = text and (text if _SCHEME.match(text) else f"https://{text}")
        return Line("header", {kind: url or None})
    if kind in HEADER_KINDS:
        return Line("header", {kind: text or None})
    raise LineError("This line is not typed here.")
