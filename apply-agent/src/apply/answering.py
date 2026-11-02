"""The essay writer's guidance: the rules for every answer (answering/README.md)
and one file per Question type (answering/types/<type>.md).

Each type file opens with YAML front matter that code reads: company_link,
stock, high_stakes, length (default words when the form states none), match
(lowercase regexes that pick the type out of a question's text) and slots (the
parts a great answer of that type holds, each of which the Essay plan backs with
quoted lines; see Slot). The body
below it is guidance for the writing model, put into the essay prompt as is.
"""

import re
from collections.abc import Iterable
from dataclasses import dataclass
from functools import cache

import yaml

from apply.home import CODE

# A form's note that bans AI-written text says nothing about the question's type.
NO_AI = re.compile(r"\(?\s*(please,? )?(do not|don't|no) (use )?ai( text)?[.!)]*|in your own words,?")

ROOT = CODE / "answering"  # generic: in the checkout, not the data folder

# classify tries types in this order, so the more specific win: a letter or an
# "anything else" box before everything, a pick before an idea, both before why-company,
# and why-company late, since most questions mention the company.
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


@dataclass(frozen=True)
class Slot:
    """One part of a great answer. `required` is True (no backing holds the
    question), False (no backing leaves it out) or "asked" (required only when
    the question asks for this part)."""

    name: str
    required: bool | str
    holds: str


@dataclass(frozen=True)
class TypeGuide:
    type: str
    company_link: str  # "same-kind" or "never"
    stock: bool
    high_stakes: bool
    length: tuple[int, int]
    match: tuple[str, ...]
    slots: tuple[Slot, ...]
    body: str


def _split(text: str) -> tuple[dict, str]:
    """Front matter and body of a guidance file."""
    _, front, body = text.split("---\n", 2)
    return yaml.safe_load(front) or {}, body.strip()


@cache
def load() -> dict[str, TypeGuide]:
    """Every type's guide, by type name."""
    guides = {}
    for path in sorted((ROOT / "types").glob("*.md")):
        front, body = _split(path.read_text())
        guides[front["type"]] = TypeGuide(
            type=front["type"], company_link=front["company_link"], stock=bool(front["stock"]),
            high_stakes=bool(front["high_stakes"]), length=tuple(front["length"]),
            match=tuple(front.get("match") or ()),
            slots=tuple(Slot(s["name"], s["required"], s["holds"]) for s in front.get("slots") or ()), body=body)
    return guides


@cache
def rules() -> str:
    """The rules for every answer."""
    return (ROOT / "README.md").read_text().strip()


@cache
def _patterns() -> tuple[tuple[str, tuple[re.Pattern, ...]], ...]:
    guides = load()
    return tuple((t, tuple(re.compile(p) for p in guides[t].match)) for t in PRIORITY)


def classify(question_text: str) -> str:
    """The Question type of `question_text`: the first type in PRIORITY with a
    match pattern found in it, else "general"."""
    text = NO_AI.sub(" ", " ".join(question_text.lower().replace("’", "'").split())).strip()
    for name, patterns in _patterns():
        if any(p.search(text) for p in patterns):
            return name
    return "general"


def guide_text(types: Iterable[str]) -> str:
    """The guidance bodies of `types`, each once, headed by its name, for the prompt."""
    guides = load()
    return "\n\n".join(f"# Question type: {t}\n\n{guides[t].body}" for t in dict.fromkeys(types))


def checklist(kind: str) -> tuple[str, ...]:
    """The yes/no questions of the numbered rules under "## Rules" in `kind`'s guide
    (each rule opens with its question in bold), for a per-type judge calibrated on Lisul's picks."""
    section = re.search(r"^## Rules\n(.*?)(?=^## |\Z)", load()[kind].body, re.MULTILINE | re.DOTALL)
    return tuple(re.findall(r"^\d+\. \*\*(.+?)\*\*", section.group(1), re.MULTILINE)) if section else ()
