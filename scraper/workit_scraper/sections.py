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

from workit_scraper import details

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
        r"fraud|scams?|privacy|disclaimer|background checks?|affirmative action|"
        r"pay transparency|legal|compliance|diversity|inclusion|belonging|"
        r"verify communications|terms of service|vevraa|li-(remote|hybrid|onsite|dnp)|"
        r"a note on ai|use of artificial intelligence|other notices|\w+ applicants$",
    ),
    (
        "apply",
        r"how to apply|to apply|application (process|journey|timeline)|"
        r"interview process|next steps|hiring process|what is next|recruitment process|"
        r"referral instructions",
    ),
    (
        "benefits",
        r"benefits?|perks|what we offer|we offer|total rewards|why you.ll love|why join|"
        r"life at|what you.ll (get|gain)|what makes working|in it for you|"
        # Whole headings only: "insurance" or "retirement" anywhere in a line
        # would read "Knowledge of insurance claims" in a requirements list as
        # a benefits heading and drop the rest of the list.
        r"^health (&|and) wellness$|^(flexible pto|paid time off)$|can offer you|"
        r"we.ll bring to|taking care of our team",
    ),
    (
        "pay",
        r"salary|compensation|pay range|base pay|pay rate|hourly (rate|range|pay)|\w+ pay|"
        r"wage|estimated (starting )?(salary|pay)|^pay$",
    ),
    (
        "preferred",
        r"preferred|nice[ -]to[ -]haves?|bonus( points)?|desired|good to have|extra credit|"
        r"stand out|we prefer|desirable|sets you apart",
    ),
    (
        "requirements",
        r"requirements?|qualifications?|minimum|basic|required|what you.ll bring|"
        r"what you bring|what (we.re|we are) looking for|what we look for|who you are|"
        r"you have|must[ -]haves?|what we (require|need|value)|eligibility|"
        r"skills( and experience)?|about you|what you.ll need|what you need|"
        r"to be successful|^experience$|qualities that make|looking for someone|"
        r"^profile$|^(work )?authorization$|the student we.re looking for",
    ),
    (
        "responsibilities",
        r"responsibilit\w*|what you.ll (do|be doing|work on)|what you will (do|be doing)|"
        r"duties|essential functions|your impact|make an impact|day[ -]to[ -]day|"
        r"in this role|you will|example projects|what you.ll learn|what you will learn|"
        r"what you (might|may|could) (do|work on)|the work you.ll do|what you.ll achieve|"
        r"what you.ll actually do|^your mission$|major objectives",
    ),
    (
        "logistics",
        r"locations?|work arrangement|(work )?schedules?|dates?|timelines?|duration|"
        r"start dates?|available terms|internship information|"
        r"program details|internship details|logistics|additional information|"
        r"what to expect|offer deadline|visa sponsorship|^details$",
    ),
    (
        "company",
        r"about (us|the company)|company (overview|description)|who we are|"
        r"our (mission|story|company|values|principles|culture)|shared values|how we work|"
        r"world-changing company|what we do|core values|our commitments|"
        r"^why (?!this |join |work )[\w&.'’ -]{2,30}\??$",
    ),
    (
        "role",
        # The loose words ("role", "team", "overview", "summary") count only as the
        # whole heading or in a fixed phrase: "Document your methods and share
        # findings with the team" and "Experience or exposure in a test or
        # automation role" are bullets, and each once swallowed the real heading
        # after it.
        r"about (the|this) (role|position|job|team|opportunity|internship|program)|"
        r"^(the |your )?role$|^(the |our )?team$|^overview$|^summary$|"
        r"(role|position|team|internship|program) (summary|overview|description)|"
        r"job (summary|overview)|why this role|the role entails|role at a glance|"
        r"the team and culture|^(the |our )?internship$|internship program|"
        r"the opportunity|project details|subteam for this role|program highlights|"
        r"tech(nology|nical)? stack|technologies we use",
    ),
    # "About Stripe": a company's own name. Last, so "About the role" is the role.
    ("company", r"^about [\w&.'’ -]{2,30}$"),
)

_PATTERNS = tuple((key, re.compile(rf"\b({words})\b", re.I)) for key, words in SECTIONS)

#: The sections that speak to the reader about the job: their headings say "you"
#: ("What you'll do", "Who you are") or name the list ("Requirements").
_ABOUT_THE_READER = {"responsibilities", "requirements", "preferred"}
#: A heading in the company's voice. One cannot open those sections: Perpay's
#: "Products we've built to make an impact" matched "make an impact" and filed the
#: company's products, its office and its hiring event as Responsibilities.
_COMPANY_VOICE = re.compile(r"\b(we|we.ve|we.re|we.ll|our|ours|us)\b", re.I)
#: The headings in "we" that still speak about the reader.
_READER_WE = re.compile(
    r"look(ing)? for|excited about you|qualifications we|qualities we|"
    r"we (require|need|value|expect|prefer)|we.d (love|like)|like to see|with us",
    re.I,
)

#: A label and its text on one line: "Overview: This is the team that…" (KAN-229
#: fix 1). The label may follow a bullet and must start with a capital; the text
#: must follow a colon and a space, so "To apply, please submit the following:" and
#: a time like "9:00" are not one.
_INLINE = re.compile(r"^[\s*#•·\-–—]*([A-Z][^:\n]{1,58}):\s+(\S.*)$")

#: A heading over the whole posting, not a section: Workday opens most descriptions
#: with "Job Description", then "ABOUT BOSE". It is skipped, so it neither opens a
#: section nor swallows the heading after it as its first item.
_WRAPPER = re.compile(r"^((job|position) )?description$", re.I)

#: Longest heading, in characters and words. Measured on the feed: real headings run
#: to "What to expect during the internship" (36); past this is a sentence.
_MAX_CHARS = 60
_MAX_WORDS = 9


#: What WorkIt stores of a description, in this order, each under this heading
#: (decided 2026-10-17, scraper/docs/sections.md). The company's pitch, benefits,
#: legal notices and how to apply are left out.
#:
#: THE HEADINGS ARE PART OF THE FEED'S CONTRACT. The backend finds the parts job
#: matching reads by these exact lines (backend/app/services/matching/
#: embeddings.py, `job_text`), and the job posting page draws each one's icon
#: (frontend .../jobs/[jobId]/description.tsx, `SECTION_ICONS`), so a heading
#: renamed here alone makes every job embed its whole description again and
#: loses its icon. The intro has none: it comes first.
KEPT: tuple[tuple[str, str | None], ...] = (
    (INTRO, None),
    ("role", "Overview"),
    ("responsibilities", "Responsibilities"),
    ("requirements", "Requirements"),
    ("preferred", "Preferred Qualifications"),
    ("pay", "Pay"),
    ("logistics", "Details"),
)

_KEPT_HEADINGS = {head.casefold() for _, head in KEPT if head}


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
    ends with a colon, as "To apply, please submit the following:" does. A heading in
    the company's voice ("we", "our") opens no section about the reader
    (`_COMPANY_VOICE`) unless it asks for the reader ("What we're looking for").
    """
    stripped = line.strip()
    name = stripped.strip("*#•·-–— ").rstrip(":").strip()
    if not name or len(name) > _MAX_CHARS or len(name.split()) > _MAX_WORDS:
        return None
    if not name[0].isupper() and not name[0].isdigit():
        return None
    if name.endswith((".", ";")) or ("," in name and not stripped.endswith(":")):
        return None
    company_voice = _COMPANY_VOICE.search(name) and not _READER_WE.search(name)
    for key, pattern in _PATTERNS:
        if key in _ABOUT_THE_READER and company_voice:
            continue
        if pattern.search(name):
            return key
    return None


@dataclass(frozen=True, slots=True)
class _Line:
    """One input line as the walk read it (`_walk`)."""

    #: Its position in the text's lines.
    index: int
    #: The section it belongs to.
    key: str
    #: The heading of that section as written; None for the intro.
    head: str | None
    #: Its content: the line itself, an inline label's text alone, or "" for a
    #: heading line.
    text: str
    #: It opened its section: a heading line.
    opens: bool = False
    #: It is an inline label ("Overview: …"), a section of its own one line long.
    inline: bool = False


def _walk(text: str) -> list[_Line]:
    """Every line but a whole-posting wrapper, each with the section it belongs to,
    by the rules `split` describes. The one pass both `split` and `labels` read."""
    walked: list[_Line] = []
    key, head = INTRO, None
    # Whether the open section has held a line yet: a heading straight after its
    # own heading is its first item. True again after an inline label hands it
    # back, which is not a fresh heading.
    started = False
    for index, line in enumerate(text.split("\n")):
        if _WRAPPER.match(line.strip().strip("*#•·-–— ").rstrip(":").strip()):
            continue
        inline = _INLINE.match(line)
        labelled = heading(inline.group(1)) if inline else None
        if labelled is not None and labelled != key:
            label, rest = inline.group(1).strip(), inline.group(2).strip()
            walked.append(_Line(index, labelled, label, rest, inline=True))
            started = True
            continue
        opens = heading(line)
        just_opened = head is not None and not started
        # A benefits list names pay among its perks ("Life assurance worth 4x your
        # annual salary", "Competitive pay"): those are items, not a Pay heading,
        # which kept the company pitch after one under Pay. A real amount reaches
        # Pay by what it says, wherever it sits (`_sorted_lines`).
        in_perks = opens == "pay" and key == "benefits"
        if opens is None or opens == key or just_opened or in_perks:
            walked.append(_Line(index, key, head, line))
            started = started or bool(line.strip())
            continue
        key, head = opens, line.strip().strip("*#•·-–— ").rstrip(":").strip()
        walked.append(_Line(index, key, head, "", opens=True))
        started = False
    return walked


def split(text: str | None) -> tuple[Section, ...]:
    """The description's sections in the order written.

    Two rules keep a list's items in their list, where a pattern alone would cut it:

    - A heading of the section already open is content: under Benefits, "Commuter
      benefits" is an item, not a new section.
    - A heading needs a line of content before another can open. A heading-like line
      straight after one is its first item: "What we offer" then "Market competitive
      compensation structure" is a benefits list that starts with pay, not an empty
      benefits section and a pay one. Measured on the 2026-10-16 feed, 138 headings
      sat straight after another; nearly all were that list's first item.

    A heading with nothing under it at all, at the very end, is left out.

    **An inline label moves only its own line** (fix 1): "Overview: This is the team
    that…" puts its text under the label's section, then the section that was open
    carries on. A label inside a list ("Location: Austin, TX" among the duties)
    covers itself alone, so the lines after it stay where they were. A label naming
    the open section is content, like any heading of the open section. On the
    2026-10-16 feed, 406 such lines were read as plain text, 316 postings had one,
    and Tenstorrent's role summary sat in the intro this way.
    """
    if not text:
        return ()
    sections: list[Section] = []
    key, head, lines = INTRO, None, []

    def close() -> None:
        body = "\n".join(lines).strip()
        if body:
            sections.append(Section(key, head, body))

    for line in _walk(text):
        if line.inline:
            # Its own one-line section; the open one carries on after it.
            close()
            sections.append(Section(line.key, line.head, line.text))
            lines = []
        elif line.opens:
            close()
            key, head, lines = line.key, line.head, []
        else:
            lines.append(line.text)
    close()
    return tuple(sections)


#: An equal-opportunity line (fix 3): boilerplate wherever it sits, dropped even
#: from a kept section. Export control is not here: "must be eligible to access
#: U.S. export-controlled technology" is a requirement a student has to meet.
_EEO = re.compile(
    r"equal (employment )?opportunit|without regard to|regardless of (race|sex|gender|age)|"
    r"affirmative action|reasonable accommodations?|e-verify",
    re.I,
)

#: A perk with a price ("$250 monthly lunch stipend", "$20/pay period cell phone
#: reimbursement"), which the pay reader takes for pay. Moved to Pay only when the
#: line also speaks of pay itself, as "$25/hour plus a $2,000 monthly housing
#: stipend" does.
_PERK = re.compile(r"stipend|reimburse|allowance", re.I)
_PAY_WORDS = re.compile(
    r"salary|pay (range|rate)|base pay|hourly|per hour|an hour|/\s?h(ou)?r|annual(ly)?|"
    r"compensation|wage",
    re.I,
)

_KEPT_KEYS = {key for key, _ in KEPT}

#: The kept sections that say what the job is. A description with none of them is
#: kept whole: its pay or its details alone are not a description.
_ABOUT_THE_JOB = {INTRO, "role", "responsibilities", "requirements", "preferred"}


def _states_pay(line: str) -> bool:
    """Whether a line states the job's pay: the card's reader finds an amount, and
    the line is not a perk with a price."""
    if details.pay(line) is None:
        return False
    return not _PERK.search(line) or bool(_PAY_WORDS.search(line))


def _settled(key: str, line: str) -> tuple[str, str]:
    """(section, text) for a content line once what it says has had its say: a
    line stating pay goes to Pay, an equal-opportunity line to legal (left out),
    anything else stays in `key`. See `_sorted_lines`."""
    if key in _KEPT_KEYS and _EEO.search(line):
        return "legal", line
    if key != "pay" and _states_pay(line):
        # Without a label that names another section ("Comprehensive Benefits:
        # The salary range is…"), or the next read would split it off and the
        # stored text would change again.
        inline = _INLINE.match(line)
        labelled = heading(inline.group(1)) if inline else None
        return "pay", inline.group(2) if labelled not in (None, "pay") else line
    return key, line


def labels(text: str | None) -> list[str | None]:
    """Each of the text's lines' final section, by position: a heading line its
    section's, a content line where it is stored or left out (`_settled`), and
    None for a blank line or a whole-posting wrapper. What the gold test set
    scores (tests/test_sections_gold.py)."""
    if not text:
        return []
    found: list[str | None] = [None] * len(text.split("\n"))
    for line in _walk(text):
        if line.opens:
            found[line.index] = line.key
        elif line.text.strip():
            found[line.index] = _settled(line.key, line.text)[0]
    return found


def _sorted_lines(sections: tuple[Section, ...]) -> list[tuple[str, str]]:
    """Every line as (section, line), each sorted by what it says (fix 3).

    Headings decide most lines, but a line can say something its section is not
    about, and then it moves:

    - **A line stating pay goes to Pay**, from any section, a left-out one too.
      Tenstorrent's "Compensation for all interns … ranges from $50/hr - $70/hr"
      sat under its hiring timelines with no heading of its own. It is the card's
      own reader (`details.pay`), so the card and the Pay section agree on what
      pay is; a funding round it declines stays where it was, and so does a perk
      with a price (`_PERK`) unless the line also speaks of pay.
    - **An equal-opportunity line is dropped**, even from a kept section, as its
      own heading's section would be.
    """
    return [
        _settled(section.key, line)
        for section in sections
        for line in section.text.split("\n")
        if line.strip()
    ]


def kept(text: str | None) -> str | None:
    """The description as WorkIt stores it: the `KEPT` sections in `KEPT`'s order,
    each under its fixed heading, the rest left out, each line where it belongs by
    what it says (`_sorted_lines`).

    Sections of one kind are joined, in the order written: SpaceX states its
    requirements, then the pay, then the export-control requirement. A line that is
    only one of `KEPT`'s headings is dropped from the text, so the backend never
    reads it as the start of a section.

    A description that keeps nothing about the job itself (no intro, Overview,
    Responsibilities, Requirements or Preferred Qualifications) is kept whole. That
    is a posting whose every heading names a left-out section, which means its
    headings were misread, not that it says nothing about the job.
    """
    lines = _sorted_lines(split(text))
    # Nothing about the job itself kept means the headings were misread: Bose's
    # whole posting sits under "About Bose", and storing its pay line alone would
    # lose the rest. The posting is then kept whole.
    if not any(at in _ABOUT_THE_JOB for at, _ in lines):
        return text or None
    parts = []
    for key, head in KEPT:
        body = "\n".join(
            line
            for at, line in lines
            if at == key and line.strip().rstrip(":").strip().casefold() not in _KEPT_HEADINGS
        ).strip()
        if body:
            parts.append(f"{head}\n{body}" if head else body)
    return "\n".join(parts)
