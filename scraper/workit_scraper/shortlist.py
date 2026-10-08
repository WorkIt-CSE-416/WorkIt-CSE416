"""Decide which postings belong on the page, and collapse true duplicates.

The scraper's densest logic, and the place a bug is quietest. Two steps:

1. **Classify.** A posting is kept when its title names an early-career stage
   (`intern` or `new-grad`) *and* a topic we care about (`swe` or `ai-ml`) *and*
   does not name a discipline that is plainly not software. Without that last
   check "Sales Engineer Intern" and "Mechanical Engineering Co-op" both pass on
   the word "engineer" alone.

2. **Dedupe** on `apply_url`. Each URL is its own job: Stripe posting "Software
   Engineer, New Grad" once per office, each with its own application, is seven
   jobs and seven rows. Only copies sharing one URL -- the same application
   reached from several places -- collapse into one role carrying their locations.
   Keying on `(company, title)` instead merged those seven and kept one link,
   hiding six applications.

Deduping is presentation only: every posting that classifies is stored in jobs.json
as its own row. (Postings that do not classify are counted and never stored.)
"""

from __future__ import annotations

import re
from collections import Counter
from collections.abc import Callable
from dataclasses import dataclass, field, replace
from enum import StrEnum

from workit_scraper.details import Facts
from workit_scraper.providers import Job


class Tag(StrEnum):
    """What a role is. A stage (intern or new grad), then one or more topics."""

    INTERN = "intern"
    NEW_GRAD = "new-grad"
    SWE = "swe"
    AI_ML = "ai-ml"


INTERN = re.compile(r"\bintern(?:s|ship|ships)?\b|\bco-?op\b", re.I)
NEW_GRAD = re.compile(
    r"\bnew ?grad(?:uate)?\b|\bgraduate\b|\bentry[- ]level\b|\bjunior\b"
    r"|\buniversity\b|\bcampus\b|\bearly[- ]career\b|\bapprentice\b",
    re.I,
)
# "Engineer" on its own is not a software signal. Wade Trim posts "Engineer Summer
# Intern", Olsson posts "Entry-Level Roadway Engineer", Rocket Lab posts "Thermal
# Engineering Intern" -- all real early-career engineering, none of it software. A page
# titled "software internships" that lists a nuclear engineer has lied to the reader,
# so the topic has to be named explicitly. The cost is real and accepted: a bare
# "Engineering Intern" at a software company is dropped too, because nothing in that
# title distinguishes it from Wade Trim's.
SWE = re.compile(
    r"\bsoftware\b|\bdeveloper\b|\bprogrammer\b|\bswe\b"
    r"|\bback[- ]?end\b|\bfront[- ]?end\b|\bfull[- ]?stack\b"
    r"|\bweb\b|\bmobile\b|\bios\b|\bandroid\b"
    r"|\binfrastructure\b|\bplatform\b|\bdistributed systems\b|\bsystems? software\b"
    r"|\bdev\s?ops\b|\bsre\b|\bsite reliability\b|\bcompiler\b|\bdatabase\b|\bcloud\b"
    r"|\bapi\b|\bembedded\b|\bfirmware\b|\bsecurity engineer\w*\b|\bnetwork engineer\w*\b"
    r"|\bdata engineer\w*\b|\bqa\b|\btest automation\b|\bcomputer science\b|\bcoding\b",
    re.I,
)
AI_ML = re.compile(
    r"\bmachine learning\b|\bml\b|\bai\b|\bdeep learning\b|\bgen-?ai\b"
    r"|\bgenerative ai\b|\bresearch (?:scientist|engineer)\b|\bdata scien\w*\b"
    r"|\bnlp\b|\bcomputer vision\b|\bllms?\b|\bagentic\b",
    re.I,
)
# A genuinely early-career posting never advertises a senior level. Together AI lists
# "Junior/Senior or Staff Software Engineer, Inference" -- one opening at any level,
# which matches `junior` and is not a new-grad role. Seniority wins over the stage.
SENIOR = re.compile(
    r"\bsenior\b|\bstaff\b|\bprincipal\b|\bdirector\b|\bhead of\b|\bmanager\b", re.I
)
# "Engineer" appears in jobs that have nothing to do with software. These words win.
NOT_SOFTWARE = re.compile(
    r"\bsales\b|\baccount\b|\bmarketing\b|\brecruit\w*\b|\bpeople\b|\bhr\b"
    r"|\bfinance\b|\blegal\b|\bmechanical\b|\belectrical\b|\bcivil\b|\bchemical\b"
    r"|\bindustrial\b|\bmanufactur\w*\b|\brefrigerat\w*\b|\bnurse\b|\bdentist\b"
    r"|\bphysician\b|\bteacher\b|\bcustomer\b|\bsupport\b"
    # "Structural Engineering Internship - Federal Infrastructure" otherwise qualifies
    # on the word `infrastructure`.
    r"|\bstructural\b"
    # The phrase, not the bare word: IMC posts both "Graduate Hardware Engineer",
    # which is not a software role, and "Hardware Machine Learning PhD Research
    # Internship", which is -- and excluding `hardware` outright would drop it.
    # Firmware and embedded stay in scope; they are software.
    r"|\bhardware engineer(?:ing)?\b",
    re.I,
)


@dataclass(frozen=True, slots=True)
class Role:
    """One distinct role on the page, possibly standing for several postings."""

    title: str
    company: str
    apply_url: str
    ats: str
    #: The oldest copy's board -- whose logo the feed shows.
    board_key: str
    tags: tuple[Tag, ...]
    posted_at: str | None
    #: No posting behind this role was known to us before today. See `Store.is_new`.
    new: bool
    department: str | None
    locations: tuple[str, ...]
    description: str | None
    #: The first copy's facts, whole, with `work_style` as the card shows it:
    #: stated, or inferred (see `_work_style`).
    facts: Facts = field(default_factory=Facts)

    @property
    def location_label(self) -> str:
        if not self.locations:
            return ""
        if len(self.locations) == 1:
            return self.locations[0]
        return f"{len(self.locations)} locations"


def classify(title: str) -> tuple[Tag, ...]:
    """Tags for a title, or an empty tuple if it does not belong on the page."""
    if not title or NOT_SOFTWARE.search(title) or SENIOR.search(title):
        return ()
    if INTERN.search(title):
        stage = Tag.INTERN
    elif NEW_GRAD.search(title):
        stage = Tag.NEW_GRAD
    else:
        return ()
    topics = [tag for tag, pattern in ((Tag.AI_ML, AI_ML), (Tag.SWE, SWE)) if pattern.search(title)]
    if not topics:
        return ()
    return (stage, *topics)


def pick(jobs: list[Job], *, is_new: Callable[[Job], bool]) -> list[Role]:
    """Classify, dedupe, and order newest-first by the provider's posted date."""
    # Copies at one URL are one posting, so its first copy's title and company
    # speak for all of them; tags depend only on the title.
    # Every work style a company's postings state, for its postings that state none.
    styles: dict[str, Counter[str]] = {}
    for job in jobs:
        if job.facts.work_style:
            styles.setdefault(job.company, Counter())[job.facts.work_style] += 1
    grouped: dict[str, tuple[tuple[Tag, ...], list[Job]]] = {}
    for job in jobs:
        if job.apply_url not in grouped:
            grouped[job.apply_url] = (classify(job.title), [])
        grouped[job.apply_url][1].append(job)

    roles = []
    for tags, postings in grouped.values():
        if not tags:
            continue
        # The oldest copy speaks for the role: it has been known to us since we first
        # saw *any* of its copies, so it is new only if that copy is. Unstamped sort last.
        oldest = min(postings, key=lambda job: (job.first_seen_at is None, job.first_seen_at))
        locations = tuple(dict.fromkeys(place for job in postings for place in job.places))
        # Facts come whole from one copy, never field by field across copies:
        # pay from one and job type from another would describe no posting.
        facts = next((job.facts for job in postings if job.page), Facts())
        roles.append(
            Role(
                title=postings[0].title,
                company=postings[0].company,
                apply_url=oldest.apply_url,
                ats=oldest.ats,
                board_key=oldest.board_key,
                tags=tags,
                posted_at=min((job.posted_at for job in postings if job.posted_at), default=None),
                new=is_new(oldest),
                department=next((job.department for job in postings if job.department), None),
                locations=locations,
                description=next((job.description for job in postings if job.description), None),
                facts=replace(
                    facts, work_style=_work_style(postings, styles.get(postings[0].company))
                ),
            )
        )
    # None sorts last: a posting with no date is not a brand new one.
    return sorted(
        roles, key=lambda role: (role.posted_at is not None, role.posted_at or ""), reverse=True
    )


# Words that make "On site" a guess too far: the posting allows something else.
# Only remote or hybrid *work*: "remote battery monitoring", "hybrid cloud" and
# "remote access VPNs" say nothing about where the job is done.
FLEXIBLE = re.compile(
    r"\bremote(?:ly)?\b(?!\s+(?:battery|access|sensing|monitoring|control|devices?|systems?"
    r"|sites?|vehicles?|operations?|support|desktop|server|procedure|management))"
    r"|\bhybrid\b(?!\s+(?:cloud|network|benchmark\w*|system|vehicle|quantum|search|approach to))"
    r"|work from home|\bwfh\b|\bwork from anywhere\b",
    re.I,
)


def _work_style(postings: list[Job], company: Counter[str] | None) -> str | None:
    """The card's work style, first answer wins:

    1. what the posting states -- its board's field or a sentence (`Facts`);
    2. what the company's other postings state, most often;
    3. "On site" when it names a place and nothing in it mentions remote, hybrid
       or working from home.

    Measured on 250 postings whose board states a work style but whose text does
    not: 2 then 3 is right 87% of the time, 3 alone 70% (the misses are hybrid).
    Postings that state nothing usually work on site, and a card that says so is
    more use than "not listed" -- the cost is a hybrid job sometimes shown on site.
    """
    stated = next((job.facts.work_style for job in postings if job.facts.work_style), None)
    if stated:
        return stated
    if company:
        return company.most_common(1)[0][0]
    text = " ".join(f"{job.title} {job.location or ''} {job.description or ''}" for job in postings)
    if any(job.places for job in postings) and not FLEXIBLE.search(text):
        return "On site"
    return None
