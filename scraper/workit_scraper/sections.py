"""A job description split into its sections (KAN-229).

A posting's description is one block of text, but nearly every posting is written
under the same headings: what the company is, what the role is, what you will do,
what you need, what is nice to have, the pay, the benefits and the legal notices.
`split` finds those headings and returns the text under each, so a reader can keep
the parts a student and job matching need and leave the boilerplate.

A heading is a short line, written like a title, whose words name a section
(`SECTIONS`). Anything else is content, including a short line naming no section:
a bullet such as "Python" or "Onsite gym" must never open one. Text before the
first heading is the intro, which is usually the company's pitch and sometimes the
role's summary.

Every heading in tests/test_sections.py was seen in a scraped description, and the
patterns were measured on the whole feed (scraper/docs/sections.md). Measure again
before changing one: a loose pattern turns bullets into headings, a tight one leaves
a section inside the one before it, and both still return sections.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

#: Text before the first heading.
INTRO = "intro"

#: (section, the words that name it in a heading). First match wins, so the order is
#: the decision: legal before pay, so "Pay Transparency" is a notice; benefits before
#: pay, so "Compensation & Benefits" is a benefits list; preferred before
#: requirements, so "Preferred Qualifications" is not a requirement.
SECTIONS: tuple[tuple[str, str], ...] = (
    (
        "legal",
        r"eeo|equal (employment )?opportunit\w*|e-verify|export control|accommodations?|"
        r"fraud|scams?|privacy|disclaimer|background check|affirmative action|"
        r"pay transparency|legal|compliance|diversity|inclusion|belonging|"
        r"verify communications|terms of service|vevraa|li-(remote|hybrid|onsite)",
    ),
    (
        "apply",
        r"how to apply|to apply|application (process|journey|timeline)|"
        r"interview process|next steps|hiring process|what is next",
    ),
    (
        "benefits",
        r"benefits?|perks|what we offer|we offer|total rewards|why you.ll love|why join|"
        r"life at|what you.ll (get|gain)|what makes working|in it for you",
    ),
    (
        "pay",
        r"salary|compensation|pay range|base pay|pay rate|hourly (rate|range|pay)|\w+ pay|"
        r"wage|estimated (starting )?(salary|pay)",
    ),
    (
        "preferred",
        r"preferred|nice[ -]to[ -]haves?|bonus( points)?|desired|good to have|extra credit|"
        r"stand out|we prefer",
    ),
    (
        "requirements",
        r"requirements?|qualifications?|minimum|basic|required|what you.ll bring|"
        r"what you bring|what (we.re|we are) looking for|what we look for|who you are|"
        r"you have|must[ -]haves?|what we (require|need|value)|eligibility|"
        r"skills( and experience)?|about you|what you.ll need|what you need|"
        r"to be successful|^experience$|qualities that make|looking for someone",
    ),
    (
        "responsibilities",
        r"responsibilit\w*|what you.ll (do|be doing|work on)|what you will (do|be doing)|"
        r"duties|essential functions|your impact|make an impact|day[ -]to[ -]day|"
        r"in this role|you will|example projects|what you.ll learn|what you will learn",
    ),
    (
        "logistics",
        r"location|work arrangement|(work )?schedule|dates|timeline|duration|start date|"
        r"program details|internship details|logistics|additional information|"
        r"what to expect|offer deadline|visa sponsorship",
    ),
    (
        "company",
        r"about (us|the company)|company (overview|description)|who we are|"
        r"our (mission|story|company|values|principles|culture)|shared values|how we work|"
        r"world-changing company|what we do",
    ),
    (
        "role",
        r"about (the|this) (role|position|job|team|opportunity|internship|program)|"
        r"the role|role|job (summary|description|overview)|overview|"
        r"position (summary|overview)|summary|the team|team description|the opportunity|"
        r"the internship|internship (overview|program)|your role|project details|"
        r"tech(nology|nical)? stack|technologies we use",
    ),
    # "About Stripe": a company's own name. Last, so "About the role" is the role.
    ("company", r"^about [\w&.'’ -]{2,30}$"),
)

_PATTERNS = tuple((key, re.compile(rf"\b({words})\b", re.I)) for key, words in SECTIONS)

#: Longest heading, in characters and words. Measured on the feed: real headings run
#: to "What to expect during the internship" (36); past this is a sentence.
_MAX_CHARS = 60
_MAX_WORDS = 9


@dataclass(frozen=True, slots=True)
class Section:
    key: str
    #: The heading line as written, without its colon or bullet; None for the intro.
    heading: str | None
    text: str


def heading(line: str) -> str | None:
    """The section a line opens, or None when it is content.

    A heading is short, starts with a capital, and does not end like a sentence. A
    comma means a list item ("Medical, dental, and vision insurance") unless the line
    ends with a colon, as "To apply, please submit the following:" does.
    """
    stripped = line.strip()
    name = stripped.strip("*#•·-–— ").rstrip(":").strip()
    if not name or len(name) > _MAX_CHARS or len(name.split()) > _MAX_WORDS:
        return None
    if not name[0].isupper() and not name[0].isdigit():
        return None
    if name.endswith((".", ";")) or ("," in name and not stripped.endswith(":")):
        return None
    for key, pattern in _PATTERNS:
        if pattern.search(name):
            return key
    return None


def split(text: str | None) -> tuple[Section, ...]:
    """The description's sections in the order written.

    Two rules keep a list's items in their list, where a pattern alone would cut it:

    - A heading of the section already open is content: under Benefits, "Commuter
      benefits" is an item, not a new section.
    - A heading needs a line of content before another can open. A heading-like line
      straight after one is its first item: "What we offer" then "Market competitive
      compensation structure" is a benefits list that starts with pay, not an empty
      benefits section and a pay one. Measured on the 2026-10-16 feed, 147 headings
      sat straight after another; nearly all were that list's first item.

    A heading with nothing under it at all, at the very end, is left out.
    """
    if not text:
        return ()
    sections: list[Section] = []
    key, head, lines = INTRO, None, []

    def close() -> None:
        body = "\n".join(lines).strip()
        if body:
            sections.append(Section(key, head, body))

    for line in text.split("\n"):
        opens = heading(line)
        just_opened = head is not None and not any(part.strip() for part in lines)
        if opens is None or opens == key or just_opened:
            lines.append(line)
            continue
        close()
        key, head, lines = opens, line.strip().strip("*#•·-–— ").rstrip(":").strip(), []
    close()
    return tuple(sections)
