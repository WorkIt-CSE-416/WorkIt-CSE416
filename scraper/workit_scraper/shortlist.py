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
from collections.abc import Callable
from dataclasses import dataclass
from enum import StrEnum

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
    tags: tuple[Tag, ...]
    posted_at: str | None
    #: No posting behind this role was known to us before today. See `Store.is_new`.
    new: bool
    department: str | None
    work_style: str | None
    locations: tuple[str, ...]

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
        locations = tuple(dict.fromkeys(job.location for job in postings if job.location))
        roles.append(
            Role(
                title=postings[0].title,
                company=postings[0].company,
                apply_url=oldest.apply_url,
                ats=oldest.ats,
                tags=tags,
                posted_at=min((job.posted_at for job in postings if job.posted_at), default=None),
                new=is_new(oldest),
                department=next((job.department for job in postings if job.department), None),
                # Copies of one role can disagree (remote in one city, hybrid in
                # another); the first stated answer is as good as any.
                work_style=next((job.work_style for job in postings if job.work_style), None),
                locations=locations,
            )
        )
    # None sorts last: a posting with no date is not a brand new one.
    return sorted(
        roles, key=lambda role: (role.posted_at is not None, role.posted_at or ""), reverse=True
    )
