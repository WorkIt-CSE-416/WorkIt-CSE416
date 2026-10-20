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

import json
import re
from dataclasses import dataclass
from pathlib import Path

from workit_scraper import details

#: Text before the first heading.
INTRO = "intro"

#: (section, the words that name it in a heading). First match wins, so the order is
#: the decision: export control before legal, so an "Export Compliance" section is
#: a requirement; legal before pay, so "Pay Transparency" is a notice; benefits
#: before pay, so "Compensation & Benefits" is a benefits list; preferred before
#: requirements, so "Preferred Qualifications" is not a requirement.
SECTIONS: tuple[tuple[str, str], ...] = (
    # A rule the student has to meet ("U.S. persons only"), not a notice: under
    # legal, K2 Space's ITAR section left the job page, and the card's sponsorship
    # reader does not read ITAR's wording either. In "we"/"our" voice it stays a
    # notice (`_ABOUT_THE_READER`), and `legal` still catches it. At most two words
    # after "export control": "Export control register for all CQC shipment" is a
    # duty in a list, not a heading.
    ("requirements", r"\bexport control\w*( \S+){0,2}$|\bexport compliance\b|\bitar\b"),
    (
        "legal",
        r"eeo|equal (employment )?opportunit\w*|e-verify|export control|accommodations?|"
        r"fraud|scams?|privacy|disclaimer|background checks?|affirmative action|"
        r"pay transparency|legal|compliance|diversity|inclusion|belonging|"
        r"verify communications|terms of service|vevraa|li-(remote|hybrid|onsite|dnp)|"
        r"a note on ai|use of artificial intelligence|other notices|\w+ applicants$|"
        # The 2026-10-17 Workday audit (`docs/sections.md`, "The HTML's structure").
        r"accessibility|identity statement|ai usage|non-?discrimination|employment practices|"
        r"posting statement|^disclosures?$",
    ),
    (
        "apply",
        r"how to apply|to apply|application (process|journey|timeline)|"
        r"interview process|next steps|hiring process|what is next|recruitment process|"
        r"referral instructions|apply (now|today)",
    ),
    (
        "benefits",
        r"benefits?|perks|what we offer|we offer|total rewards|why you.ll love|why join|"
        r"life at|what you(.ll| will) (get|gain)|what makes working|in it for you|"
        # Whole headings only: "insurance" or "retirement" anywhere in a line
        # would read "Knowledge of insurance claims" in a requirements list as
        # a benefits heading and drop the rest of the list.
        r"^health (&|and) wellness$|^(flexible pto|paid time off)$|can offer you|"
        r"we.ll bring to|taking care of our team|^health (&|and) well-?being$|"
        # "What you can expect" alone is duties (`responsibilities`); from us, perks.
        r"personal (&|and) professional development|what you can expect from us",
    ),
    (
        "pay",
        r"salary|compensation|pay range|base pay|pay rate|hourly (rate|range|pay)|\w+ pay|"
        r"wage|estimated (starting )?(salary|pay)|^pay$",
    ),
    (
        "preferred",
        r"preferred|nice[ -]to[ -]haves?|bonus( points)?|desired|good to have|extra credit|"
        r"stand out|we prefer|desirable|sets you apart|not required|also helpful",
    ),
    (
        "requirements",
        r"requirements?|qualifications?|minimum|basic|required|what you.ll bring|"
        r"what you bring|what (we.re|we are) looking for|what we look for|who you are|"
        r"you have|must[ -]haves?|what we (require|need|value)|eligibility|"
        r"skills( and experience)?|about you|what you.ll need|what you need|"
        r"to be successful|^experience$|qualities that make|looking for someone|"
        r"^profile$|^(work )?authorization$|the student we.re looking for|"
        r"(we.re|we are) looking for|^(your )?education\b(?! (assistance|reimbursement))|"
        r"educational (&|and) professional experience|you bring|^you are$|"
        r"you are passionate about|ideal candidate|who we look for|clearance",
    ),
    (
        "responsibilities",
        r"responsibilit\w*|what you.ll (do|be doing|work on)|what you will (do|be doing)|"
        r"duties|essential functions|your impact|make an impact|day[ -]to[ -]day|"
        r"in this role|you will|example projects|what you.ll learn|what you will learn|"
        r"what you (might|may|could) (do|work on)|the work you.ll do|what you.ll achieve|"
        r"what you.ll actually do|^your mission$|major objectives|"
        r"what will you (do|be doing)|accountabilit\w*|"
        # 116 of the 138 stored postings with it describe the job under it (Marvell's
        # 88, 1Password, PGIM); filed as benefits, every Marvell posting lost its
        # duties. The other 22 list perks (Kyndryl, CrowdStrike), now shown as duties.
        r"what you can expect",
    ),
    (
        "logistics",
        r"locations?|work arrangement|(work )?schedules?|dates?|timelines?|duration|"
        r"start dates?|available terms|internship information|"
        r"program details|internship details|logistics|additional information|"
        r"what to expect|offer deadline|visa sponsorship|^details$|"
        r"work(ing)? (environment|conditions)|^work model$|^at a glance$",
    ),
    (
        "company",
        r"about (us|the company)|company (overview|description)|who we are|"
        r"our (mission|story|company|values|principles|culture)|shared values|how we work|"
        r"world-changing company|what we do|core values|our commitments|"
        r"^why (?!this |join |work )[\w&.'’ -]{2,30}\??$|who are we|^the company$",
    ),
    (
        "role",
        # The loose words ("role", "team", "overview", "summary") count only as the
        # whole heading or in a fixed phrase: "Document your methods and share
        # findings with the team" and "Experience or exposure in a test or
        # automation role" are bullets, and each once swallowed the real heading
        # after it.
        # "About the Intern Program" (OCC), its text under "About OCC" without it.
        r"about (the|this) (role|position|job|team|opportunity|internship|"
        r"(intern(ship)? )?program)|"
        r"^(the |your )?role$|^(the |our )?team$|^overview$|^summary$|"
        r"(role|position|team|internship|program) (summary|overview|description)|"
        r"job (summary|overview)|why this role|the role entails|role at a glance|"
        r"the team and culture|^(the |our )?internship$|internship program|"
        r"the opportunity|project details|subteam for this role|program highlights|"
        r"tech(nology|nical)? stack|technologies we use|program structure|^purpose$|"
        # Nuro's teams and their duties, as the gold set labels them. Without it,
        # "About the Work" read as a company's name ("About Stripe", below) and
        # its new grad posting dropped all four On-Road Experience duties.
        r"^about the work$",
    ),
    # "About Stripe": a company's own name. Last, so "About the role" is the role.
    ("company", r"^about [\w&.'’ -]{2,30}$"),
)

_PATTERNS = tuple((key, re.compile(rf"\b({words})\b", re.I)) for key, words in SECTIONS)

#: A learned label saying a heading-shaped line names no section ("Python").
NOT_A_HEADING = "none"
#: What a learned label may say: a section `SECTIONS` names, or NOT_A_HEADING.
LEARNED_LABELS = frozenset({key for key, _ in SECTIONS} | {NOT_A_HEADING})
#: The headings no pattern names, each labeled once by a model and reviewed in git
#: (`label_headings.py`, which writes this file; `docs/sections.md`, "Learned
#: headings"). Read after the patterns, so a pattern always wins. A file, not a
#: call during the scrape: Groq answers about 30 requests a minute, and a run
#: reads thousands of pages, each stored once.
LEARNED_PATH = Path(__file__).with_name("learned_headings.json")


def learned_key(name: str) -> str:
    """How a heading is looked up among the learned ones: its words, casefolded."""
    return " ".join(name.split()).casefold()


def load_learned(path: Path = LEARNED_PATH) -> dict[str, str]:
    """The learned labels, a label no section has dropped; empty without the file."""
    if not path.exists():
        return {}
    labels = json.loads(path.read_text(encoding="utf-8")).get("labels", {})
    return {learned_key(name): key for name, key in labels.items() if key in LEARNED_LABELS}


_LEARNED = load_learned()

#: The sections that speak to the reader about the job: their headings say "you"
#: ("What you'll do", "Who you are") or name the list ("Requirements").
_ABOUT_THE_READER = {"responsibilities", "requirements", "preferred"}
#: A heading in the company's voice. One cannot open those sections: Perpay's
#: "Products we've built to make an impact" matched "make an impact" and filed the
#: company's products, its office and its hiring event as Responsibilities.
_COMPANY_VOICE = re.compile(r"\b(we|we.ve|we.re|we.ll|our|ours|us)\b", re.I)
#: The headings in "we" that still speak about the reader.
_READER_WE = re.compile(
    r"look(ing)? for|excited about you|qualifications we|qualities we|ideal candidate|"
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
_WRAPPER = re.compile(
    r"^((job|position) )?description( (&|and) summary| summary)?$|^(job|position) details$", re.I
)

#: A typed bullet: a glyph, then a space. A line that starts with one is a list
#: item, never a heading, as the job page reads it too (`BULLET` in
#: description.tsx). "**Requirements**" has no space after its first asterisk.
_TYPED_BULLET = re.compile(r"[•·▪◦‣●○*\-–—]\s")

#: Longest heading, in characters and words. Measured on the feed: real headings run
#: to "What to expect during the internship" (36); past this is a sentence.
_MAX_CHARS = 60
_MAX_WORDS = 9


#: What WorkIt stores of a description, in this order, each under this heading
#: (decided 2026-10-17, scraper/docs/sections.md): the job's sections, then the
#: extras (`EXTRA`, 2026-10-18). Legal notices alone are left out.
#:
#: THE HEADINGS ARE PART OF THE FEED'S CONTRACT. The backend finds the parts job
#: matching reads by these exact lines (backend/app/services/matching/
#: embeddings.py, `job_text`), and the job posting page is to draw each one's
#: icon (KAN-246), so a heading renamed here alone makes every job embed its whole
#: description again and loses its icon. The intro has none: it comes first.
KEPT: tuple[tuple[str, str | None], ...] = (
    (INTRO, None),
    ("role", "Overview"),
    ("responsibilities", "Responsibilities"),
    ("requirements", "Requirements"),
    ("preferred", "Preferred Qualifications"),
    ("pay", "Pay"),
    ("logistics", "Details"),
    ("benefits", "Benefits"),
    ("apply", "How to Apply"),
    ("company", "About the Company"),
)

#: Kept, shown last and folded on the job posting page, but not the job: job
#: matching, its keywords and Tailor never read them (the backend's `job_text`
#: stops at their headings). Left out until 2026-10-18, they hid what employers
#: wrote about the job under a perks heading (Kepler's "Build and operate real
#: satellites!" under "What We Offer") and the internship under "About Us" (Wing).
EXTRA = frozenset({"benefits", "apply", "company"})

_KEPT_HEADINGS = {head.casefold() for _, head in KEPT if head}
_KEPT_KEYS = {key for key, _ in KEPT}
#: The job's own sections: what the rules that guard job text protect.
_JOB_KEYS = _KEPT_KEYS - EXTRA


@dataclass(frozen=True, slots=True)
class Section:
    key: str
    #: The heading line as written, without its colon or bullet; None for the intro.
    heading: str | None
    text: str


#: Zero-width characters: invisible, but Morningstar's "\u200bWho You Are" read as
#: starting with no capital, so it headed nothing.
_ZERO_WIDTH = dict.fromkeys(map(ord, "\u200b\u200c\u200d\u2060\ufeff"))


def _visible(line: str) -> str:
    """The line without its zero-width characters."""
    return line.translate(_ZERO_WIDTH)


def heading(line: str, learned: bool = True) -> str | None:
    """The section a line opens, or None when it is content.

    A heading is short, starts with a capital, and does not end like a sentence. A
    line that starts with a typed bullet ("• ", "- ") is a list item, never one. A
    comma means a list item ("Medical, dental, and vision insurance") unless the line
    ends with a colon, as "To apply, please submit the following:" does. A heading in
    the company's voice ("we", "our") opens no section about the reader
    (`_COMPANY_VOICE`) unless it asks for the reader ("What we're looking for").
    """
    name = _heading_name(line)
    return _named(name, learned) if name else None


def _heading_name(line: str) -> str | None:
    """The name a line gives if it is shaped like a heading (`heading`), or None."""
    stripped = _visible(line).strip()
    # Stripping the glyph below would let "• Perform other duties as assigned"
    # open Responsibilities and swallow the real heading after it.
    if _TYPED_BULLET.match(stripped):
        return None
    name = stripped.strip("*#•·-–— ").rstrip(":").strip()
    if not name or len(name) > _MAX_CHARS or len(name.split()) > _MAX_WORDS:
        return None
    if not name[0].isupper() and not name[0].isdigit():
        return None
    if name.endswith((".", ";")) or ("," in name and not stripped.endswith(":")):
        return None
    return name


def _named(name: str, learned: bool = True) -> str | None:
    """The section a heading's words name, or None: the patterns first, then the
    learned labels (`LEARNED_PATH`). The company-voice rule is the patterns' own: a
    pattern matches words ("make an impact"), while the model read the whole
    heading, and "Our ideal builders will have the following attributes & skills"
    is a requirements list. Under the rule, SharkNinja's requirements stayed under
    its Responsibilities."""
    company_voice = _COMPANY_VOICE.search(name) and not _READER_WE.search(name)
    for key, pattern in _PATTERNS:
        if key in _ABOUT_THE_READER and company_voice:
            continue
        if pattern.search(name):
            return key
    label = _LEARNED.get(learned_key(name)) if learned else None
    if label is None or label == NOT_A_HEADING:
        return None
    return label


def unknown_headings(text: str | None, roles: tuple[str | None, ...] | None = None) -> list[str]:
    """The heading-shaped lines whose words name no section, by pattern or learned
    label, in order: what `label_headings.py` asks a model about. A line the HTML
    marks as a heading counts by its words alone (`_marked_name`); a list item
    never does."""
    found = []
    for index, line in enumerate((text or "").split("\n")):
        role = _role(roles, index)
        if role == "li":
            continue
        if role in ("h", "b"):
            name = _marked_name(line)
        else:
            name = _heading_name(line)
            # In plain text only a title or a label is asked about: every short
            # list item ("Python", "Onsite gym") is heading-shaped too, and across
            # the feed they would be tens of thousands of questions.
            if name and not (line.rstrip().endswith(":") or _titled(name)):
                name = None
        if name and _named(name) is None and learned_key(name) not in _LEARNED:
            found.append(name)
    return found


def _titled(name: str) -> bool:
    """Two capitalized words or more, and every word of four letters or more
    capitalized ("Role Purpose", "Meaningful Impact"), as a heading is written and a
    list item rarely is ("Onsite gym")."""
    long = [w for w in name.split() if len(w) >= 4 and w[0].isalpha()]
    return len(long) >= 2 and all(w[0].isupper() for w in long)


#: A marked heading's limits: past these, a bold line is a sentence.
_MARKED_MAX_CHARS = 100
_MARKED_MAX_WORDS = 16


def _marked(line: str, learned: bool = True) -> str | None:
    """The section a line names that the HTML marks as a heading (a heading tag, or
    a bold line of its own), by its words alone. The shape test is what tells a
    heading from content in plain text, and here the markup has already told: so
    "In this internship, you will..." (a comma) and "“Let's find out about you.”"
    (quotes, a full stop) head their sections. A bold sentence is still emphasis:
    "The minimum length of the Internship must be 12 weeks." heads nothing."""
    name = _marked_name(line)
    return _named(name, learned) if name else None


def _marked_name(line: str) -> str | None:
    """The name a marked line gives as a heading, or None when it reads as a
    sentence or a list item (`_marked`)."""
    stripped = _visible(line).strip()
    if _TYPED_BULLET.match(stripped):
        return None
    bare = stripped.strip("* ")
    quoted = bare[:1] in "\"“'‘" and bare[-1:] in "\"”'’"
    if not quoted and (re.search(r"(?<!\.)\.$", bare) or re.search(r"[a-z]\.\s+[A-Z]", bare)):
        return None
    name = stripped.strip("*#•·-–— \"“”'‘’").rstrip(":.…?! ").strip("\"“”'‘’ ")
    if not name or len(name) > _MARKED_MAX_CHARS or len(name.split()) > _MARKED_MAX_WORDS:
        return None
    return name


def _role(roles: tuple[str | None, ...] | None, index: int) -> str | None:
    """A line's role in the HTML (`providers.plain_lines`): "h" a heading tag, "b" a
    bold line of its own, "li" a list item, "p" anything else; None when unknown."""
    return roles[index] if roles is not None and index < len(roles) else None


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


def _walk(text: str, roles: tuple[str | None, ...] | None = None) -> list[_Line]:
    """Every line but a whole-posting wrapper, each with the section it belongs to,
    by the rules `split` describes. The one pass `split`, `labels` and `kept` read.

    `roles` is each line's role in the posting's HTML, when the scraper had HTML.
    Two rules use it. A list item is never a heading, unless it ends in a colon
    ("Preferred:" as the first item of a list): Workday lists "Good interpersonal
    skills", which used to open Requirements. And a line the HTML marks as a
    heading is read by its words alone (`_marked`); after the company's section,
    one whose words name no section opens Overview."""
    walked: list[_Line] = []
    key, head = INTRO, None
    # Whether the open section has held a line yet: a heading straight after its
    # own heading is its first item. True again after an inline label hands it
    # back, which is not a fresh heading.
    started = False
    # Whether the open section's heading was a guess (below): a heading straight
    # after a guess opens its own section rather than being its first item.
    guessed = False
    for index, line in enumerate(text.split("\n")):
        if _WRAPPER.match(line.strip().strip("*#•·-–— ").rstrip(":").strip()):
            continue
        inline = _INLINE.match(line)
        labelled = heading(inline.group(1)) if inline else None
        if _hides(labelled, key) and heading(inline.group(1), learned=False) is None:
            labelled = None
        if labelled is not None and labelled != key:
            label, rest = inline.group(1).strip(), inline.group(2).strip()
            # Text that reads as a heading alone keeps its label: Blue Origin's
            # "Required for all positions: Blue's Standard Background Check" was
            # stored as "Blue's Standard Background Check", which a second read
            # takes for a legal heading and drops.
            # So does a label that is a sentence's start, not a section's name:
            # Nuro's "You will own features end-to-end: scoping, ..." was stored
            # as "scoping, ...". Past four words a label is a sentence's.
            if heading(rest) is not None or len(label.split()) > 4:
                rest = line.strip()
            walked.append(_Line(index, labelled, label, rest, inline=True))
            started = True
            continue
        # A label naming the open section is content (`split`), whatever the
        # whole line reads as: under Requirements, "Required for all positions:
        # ... Background Check" is a requirement, not a legal heading.
        opens = None if labelled is not None else heading(line)
        guess = False
        role = _role(roles, index)
        if role == "li" and not line.rstrip().endswith(":"):
            opens = None
        elif role in ("h", "b") and opens is None and labelled is None:
            opens = _marked(line)
            # A marked heading no pattern names ends the company's section, and the
            # text after it shows under Overview: the section otherwise runs on to
            # the next heading a pattern names. SharkNinja's "About Us" ran on
            # through "AI at SharkNinja" and "This role:", and its duties and
            # requirements left the page with the company's pitch. Only after the
            # company's: after benefits or a notice, the gold set's unnamed marked
            # headings were more of it ("And More:", "What You'll Experience").
            if opens is None and key == "company" and _marked_name(line):
                opens, guess = "role", True
        # A learned label moves text but never hides it: one naming a left-out
        # section cannot end a kept one. Groq filed Blenheim Chalcot's "The Centre
        # of Excellence", its early-careers programme, as the company's, and the
        # programme left the page. A pattern still can.
        if _hides(opens, key) and _by_pattern(line, role) is None:
            opens = None
        # A line ending in a colon is a heading even there: items rarely end in
        # one, and J&J's empty "Required Skills:" then "Preferred Skills:", or
        # Wade Trim's "Preferred Qualifications" then "About Wade Trim:", filed
        # the second heading's section under the first. After a guess too: a
        # slogan ("Outrageously Extraordinary") then "Candidate Privacy Notice"
        # filed SharkNinja's privacy notice as its Overview.
        just_opened = (
            head is not None and not started and not guessed and not line.strip().endswith(":")
        )
        # A benefits list names pay among its perks ("Life assurance worth 4x your
        # annual salary", "Competitive pay"): those are items, not a Pay heading,
        # which kept the company pitch after one under Pay. A real amount reaches
        # Pay by what it says, wherever it sits (`_settled`).
        in_perks = opens == "pay" and key == "benefits"
        if opens is None or opens == key or just_opened or in_perks:
            walked.append(_Line(index, key, head, line))
            started = started or bool(line.strip())
            continue
        key, head = opens, line.strip().strip("*#•·-–— ").rstrip(":").strip()
        walked.append(_Line(index, key, head, "", opens=True))
        started, guessed = False, guess
    return walked


def _hides(opens: str | None, key: str) -> bool:
    """Whether opening `opens` from the open section `key` would take job text where
    it should not go: from any job section into a left-out one, or from what
    matching reads (`_ABOUT_THE_JOB`) into an extra. Out of Pay or Details into an
    extra is fine, since matching reads neither: ASDA's own pitch ran on under
    "Closing Date" in Details past its "Everything about Asda", which Groq labeled
    the company's."""
    if opens is None:
        return False
    if opens not in _KEPT_KEYS:
        return key in _JOB_KEYS
    return opens in EXTRA and key in _ABOUT_THE_JOB


def _by_pattern(line: str, role: str | None) -> str | None:
    """The section a line opens by the patterns alone, learned labels aside."""
    by_shape = heading(line, learned=False)
    if by_shape is None and role in ("h", "b"):
        return _marked(line, learned=False)
    return by_shape


def split(text: str | None, roles: tuple[str | None, ...] | None = None) -> tuple[Section, ...]:
    """The description's sections in the order written.

    Two rules keep a list's items in their list, where a pattern alone would cut it:

    - A heading of the section already open is content: under Benefits, "Commuter
      benefits" is an item, not a new section.
    - A heading needs a line of content before another can open. A heading-like line
      straight after one is its first item: "What we offer" then "Market competitive
      compensation structure" is a benefits list that starts with pay, not an empty
      benefits section and a pay one. Measured on the 2026-10-16 feed, 138 headings
      sat straight after another; nearly all were that list's first item. A line
      ending in a colon still opens its own section: it is a heading, not an item.

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

    for line in _walk(text, roles):
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
    r"affirmative action|reasonable accommodations?|e-verify|"
    # "prohibits discrimination or harassment based on ... citizenship": boilerplate,
    # which the eligibility rule would otherwise show under Requirements.
    r"(prohibits?|does not|do not|will not|won.t) (unlawfully )?discriminat|"
    r"discriminat\w* (on the basis|based on|against|because)",
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

#: The kept sections that say what the job is. A description with none of them is
#: kept whole: its pay or its details alone are not a description.
_ABOUT_THE_JOB = {INTRO, "role", "responsibilities", "requirements", "preferred"}

#: A description whose kept text is under this share of it is kept whole too: a
#: left-out section swallowed the job. SharkNinja's "About Us" kept its "Education:"
#: line, so the rule above let 2 lines of 45 through. Of the 13,257 descriptions
#: stored on 2026-10-17, 36 kept under 10%; the median kept 73%.
_KEEP_WHOLE_BELOW = 0.10


#: What a line says that its heading does not (fix 4, `_settled`): each moves a line
#: out of the section its heading put it in. Scored on the gold set one by one; a
#: rule that broke more lines than it fixed was dropped (`docs/sections.md`).
#:
#: A nice-to-have marker: "is a plus", "preferred", "desirable", "ideally".
_PREFERRED = re.compile(
    r"\(preferred\)|\bpreferred\b[.)]?$|\b(is|are) preferred\b|"
    r"\bpreferred (but not required|knowledge|experience|qualifications?)\b|"
    r"\bnice[ -]to[ -]have\b|\b(is|are|would be) a (big |strong |huge )?plus\b|"
    r"\ba plus\b[.!]?$|\bideally\b|\bdesirable\b|\bdesired\b",
    re.I,
)
#: A side note in brackets: "(Postman or similar is a plus)" marks part of a
#: requirement, not the line. A bare "(preferred)" marks the whole line.
_SIDE_NOTE = re.compile(
    r"\((?!\s*(preferred|a plus|desired|desirable|nice to have)\s*\))[^)]*\)", re.I
)
#: A line that requires something, whatever else it prefers.
_REQUIRES = re.compile(r"\bmust\b|\brequired\b", re.I)
_NOT_REQUIRED = re.compile(r"\bnot required\b|\bno [\w ]{0,30}required\b", re.I)
#: A qualification, in a duties list: "Strong analytical skills", "Standard
#: knowledge of cost accounting principles", "Bachelor's degree in finance".
_QUALIFICATION = re.compile(
    r"^(•\s*)?((a |an )?(standard|strong|good|excellent|solid|basic|working|proven|"
    r"advanced|demonstrated|sound|thorough|fluent|proficient)\b.{0,40}\b(knowledge|"
    r"understanding|command|proficiency|skills?|abilit(y|ies)|experience|familiarity)\b|"
    r"(knowledge|understanding|proficiency|familiarity|fluency) (of|in|with)\b|"
    r"(currently )?(pursuing|enrolled)\b|(bachelor|master|associate)['’]?s?\b|"
    r"(a |an )?(degree|studies) in\b|minimum (gpa|of \d)|\d\.\d+ gpa|gpa of\b)",
    re.I,
)
#: Who may take the job: work authorization, sponsorship, citizenship, clearance.
_ELIGIBILITY = re.compile(
    r"\b(authori[sz]ed to work|work authori[sz]ation|visa sponsorship|sponsorship|"
    r"citizen(ship)?|green card|permanent resident|security clearance|eligible to work|"
    r"u\.?s\.? persons?)\b",
    re.I,
)
#: A perk named outright.
_BENEFIT = re.compile(
    r"\b401\(?k\)?|medical, dental|dental,? and vision|health insurance|paid time off|"
    r"\bpto\b|parental leave|tuition reimbursement|employee (discount|stock purchase)|"
    r"wellness program|paid holidays",
    re.I,
)
#: How to apply.
_APPLY = re.compile(
    r"\b(to apply|apply (now|online|today|by|through|via)|submit (your|a|an) (resume|cv|"
    r"application|cover letter)|application deadline|interview process|"
    r"next steps in the process)\b",
    re.I,
)


def _preferred(line: str) -> bool:
    """A nice-to-have, said in its own words: "Experience with automated testing is a
    plus." Not a requirement with a nice-to-have aside ("Fluent in English and German
    (any additional language is a plus)", "Programming skills in C++ and/or python.
    Julia is a plus!"), which stays a requirement."""
    core = _SIDE_NOTE.sub("", line)
    if not _PREFERRED.search(core):
        return False
    first = re.split(r"(?<=[.!?;])\s+", core.strip(), maxsplit=1)[0]
    if _REQUIRES.search(first) and not _NOT_REQUIRED.search(first):
        return False
    return _PREFERRED.search(first) is not None or len(first) <= 25


def _said(key: str, line: str) -> str | None:
    """The section a line belongs to by what it says, when its heading put it
    somewhere else; None to leave it there. The order is the decision."""
    if key in ("requirements", "responsibilities") and _preferred(line):
        return "preferred"
    if key == "responsibilities" and _QUALIFICATION.search(line):
        return "requirements"
    # From an extra too: ASDA's "All candidates must have the continuous right to
    # work in the UK" sat under "What you'll gain", and left the page with it.
    if key in ("logistics", INTRO, "role", "pay", *EXTRA) and _ELIGIBILITY.search(line):
        return "requirements"
    # A requirement can name a benefits product as domain experience.
    if key in _JOB_KEYS and key != "pay" and _BENEFIT.search(line) and not _REQUIRES.search(line):
        return "benefits"
    if key in _JOB_KEYS and _applying(line):
        return "apply"
    return None


def _applying(line: str) -> bool:
    """A line about applying, not one that mentions it: "Ability to apply critical
    thinking skills" is a qualification, and a role summary that ends "Apply
    today!" is the role's. A long line counts only when it opens with the ask."""
    found = _APPLY.search(line)
    if not found or _QUALIFICATION.search(line):
        return False
    if re.search(r"\b(ability|able|skills?|knowledge) to apply\b", line, re.I):
        return False
    return len(line) <= 160 or found.start() <= 40


def _states_pay(line: str) -> bool:
    """Whether a line states the job's pay: the card's reader finds an amount, and
    the line is not a perk with a price."""
    if details.pay(line) is None:
        return False
    return not _PERK.search(line) or bool(_PAY_WORDS.search(line))


def _settled(key: str, line: str) -> tuple[str, str]:
    """(section, text) for a content line once what it says has had its say: a
    line stating pay goes to Pay, an equal-opportunity line to legal (left out),
    then `_said`'s rules, and anything else stays in `key`. See `_sorted_lines`."""
    if key in _KEPT_KEYS and _EEO.search(line):
        return "legal", line
    if key != "pay" and _states_pay(line):
        # Without a label that names another section ("Comprehensive Benefits:
        # The salary range is…"), or the next read would split it off and the
        # stored text would change again.
        inline = _INLINE.match(line)
        labelled = heading(inline.group(1)) if inline else None
        return "pay", inline.group(2) if labelled not in (None, "pay") else line
    return _said(key, line) or key, line


def labels(text: str | None, roles: tuple[str | None, ...] | None = None) -> list[str | None]:
    """Each of the text's lines' final section, by position: a heading line its
    section's, a content line where it is stored or left out (`_settled`), and
    None for a blank line or a whole-posting wrapper. What the gold test set
    scores (tests/test_sections_gold.py)."""
    if not text:
        return []
    found: list[str | None] = [None] * len(text.split("\n"))
    for line in _walk(text, roles):
        if line.opens:
            found[line.index] = line.key
        elif line.text.strip():
            found[line.index] = _settled(line.key, line.text)[0]
    return found


def _sorted_lines(text: str, roles: tuple[str | None, ...] | None) -> list[tuple[str, str]]:
    """Every content line as (section, line), each sorted by what it says (fix 3).

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
    - **Then what else a line says** (`_said`, fix 4): a nice-to-have goes to
      Preferred Qualifications, a qualification in a duties list to Requirements,
      a work-eligibility line to Requirements (from an extra too), and a named perk
      and a how-to-apply line leave the job's sections for Benefits and How to
      Apply.

    A line the HTML lists keeps its bullet: it is stored as "• item", so the job
    page draws a list, and a second read takes it for an item, never a heading.
    """
    lines = []
    for line in _walk(text, roles):
        if line.opens or not line.text.strip():
            continue
        at, said = _settled(line.key, line.text)
        if _role(roles, line.index) == "li" and not _TYPED_BULLET.match(said.strip()):
            said = "• " + said.strip()
        lines.append((at, said))
    return lines


def kept(text: str | None, roles: tuple[str | None, ...] | None = None) -> str | None:
    """The description as WorkIt stores it: the `KEPT` sections in `KEPT`'s order,
    each under its fixed heading, the job's first and the extras after, legal
    notices left out, each line where it belongs by
    what it says (`_sorted_lines`).

    Sections of one kind are joined, in the order written: SpaceX states its
    requirements, then the pay, then the export-control requirement. A line that is
    only one of `KEPT`'s headings is dropped from the text, so the backend never
    reads it as the start of a section.

    A description that keeps nothing about the job itself (no intro, Overview,
    Responsibilities, Requirements or Preferred Qualifications) is kept whole. That
    is a posting whose every heading names a left-out section, which means its
    headings were misread, not that it says nothing about the job. So is one that
    keeps under a tenth of its text (`_KEEP_WHOLE_BELOW`): whole, a student still
    sees the job, under the employer's own headings.

    `roles` is each line's role in the posting's HTML (`_walk`), when there was HTML.
    """
    if not text:
        return None
    lines = _sorted_lines(text, roles)
    # Nothing about the job itself kept means the headings were misread: Bose's
    # whole posting sits under "About Bose", and storing its pay line alone would
    # lose the rest. The posting is then kept whole.
    if not any(at in _ABOUT_THE_JOB for at, _ in lines):
        return text or None
    if sum(len(line) for at, line in lines if at in _JOB_KEYS) < _KEEP_WHOLE_BELOW * len(text):
        return text
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
