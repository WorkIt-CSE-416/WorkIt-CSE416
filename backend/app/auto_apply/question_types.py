"""
Question types (KAN-369, from Apply's essay writer): every question a form
asks in words gets exactly one of 15 types, or the general fallback, and
each type has a guide in type_guides/<type>.md. Pure: no session, no model.

Each guide opens with YAML front matter that code reads:

- `summary`: the type in one line, for a question the student's Claude
  moves to a type the form doesn't ask.
- `company_link`: `same-kind` (the answer may tie one company fact to the
  student's work, only when it is the same kind of problem) or `never`
  (the answer is about the student: no company sentence).
- `length`: the default words when the form states no length.
- `match`: lowercase regexes that pick the type out of a question's text.
- `slots`: the parts a great answer of the type holds. Each is `required`
  true (no quote backing it means the student is asked for the fact),
  false (no quote means it is left out) or "asked" (required only when
  the question asks for that part). The Essay plan backs each slot with
  quotes from the student's sources, which written.save_answers checks.

The body below it is guidance for the student's Claude: the connector hands
it out as data (get_next_application's `guides`), and the prompt
(connector/prompt.py) says to follow it. The guides name no student; their
examples are other people's judged answers, kept for their shape.
"""

import re
from dataclasses import dataclass
from functools import cache
from pathlib import Path

import yaml

GUIDES = Path(__file__).with_name("type_guides")

# The fallback for a question no type's patterns match.
GENERAL = "general"

# classify tries types in this order, so the more specific win: a letter or
# an "anything else" box before everything, a pick before an idea, both
# before why-company, and why-company late, since most questions mention
# the company.
PRIORITY = (
    "cover-letter",
    "anything-else",
    "ai-tools",
    "values",
    "not-on-resume",
    "about-me",
    "preference",
    "what-youd-build",
    "failure",
    "opinion",
    "why-field",
    "named-area",
    "best-project",
    "why-role",
    "why-company",
)

# A form's note that bans AI-written text says nothing about the question's type.
NO_AI = re.compile(r"\(?\s*(please,? )?(do not|don't|no) (use )?ai( text)?[.!)]*|in your own words,?")

# A length the form states in a question's words: then the type's default is not given.
STATED = re.compile(
    r"\b\d+\s*(?:(?:-|–|to)\s*\d+\s*)?(?:words?|sentences?|characters?|chars|paragraphs?|lines?)\b"
    r"|\b(?:a few|a couple of|one|two|three|four|five|a single) (?:short )?(?:sentences?|words?|paragraphs?|lines?)\b"
    r"|\b(?:word|character) (?:limit|count)\b",
    re.IGNORECASE,
)


@dataclass(frozen=True)
class Slot:
    name: str
    required: bool | str  # True, False or "asked"
    holds: str


@dataclass(frozen=True)
class Guide:
    type: str
    summary: str
    company_link: str  # "same-kind" or "never"
    length: tuple[int, int]
    match: tuple[str, ...]
    slots: tuple[Slot, ...]
    body: str

    def shown(self) -> dict:
        """The guide as the connector hands it to the student's Claude."""
        return {
            "company_link": self.company_link,
            "slots": [{"name": s.name, "required": s.required, "holds": s.holds} for s in self.slots],
            "guide": self.body,
        }


@cache
def load() -> dict[str, Guide]:
    """Every type's guide, by type name."""
    guides = {}
    for path in sorted(GUIDES.glob("*.md")):
        _, front, body = path.read_text(encoding="utf-8").split("---\n", 2)
        meta = yaml.safe_load(front) or {}
        guides[meta["type"]] = Guide(
            type=meta["type"], summary=meta["summary"], company_link=meta["company_link"],
            length=tuple(meta["length"]), match=tuple(meta.get("match") or ()),
            slots=tuple(Slot(s["name"], s["required"], s["holds"]) for s in meta.get("slots") or ()),
            body=body.strip(),
        )
    return guides


@cache
def _patterns() -> tuple[tuple[str, tuple[re.Pattern, ...]], ...]:
    guides = load()
    return tuple((t, tuple(re.compile(p) for p in guides[t].match)) for t in PRIORITY)


def classify(question: str) -> str:
    """The Question type of `question` (its label): the first type in
    PRIORITY with a pattern found in it, else GENERAL."""
    text = NO_AI.sub(" ", " ".join(question.lower().replace("’", "'").split())).strip()
    for name, patterns in _patterns():
        if any(p.search(text) for p in patterns):
            return name
    return GENERAL


def default_length(question: str, kind: str, max_length: int | None) -> str | None:
    """The type's default length, as "70-120 words", when the form states
    none: no limit of its own and no length in the question's words."""
    if max_length or STATED.search(question):
        return None
    low, high = load()[kind].length
    return f"{low}-{high} words"
