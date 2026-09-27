"""Decide which postings belong on the page, and collapse the duplicates.

This is the only non-trivial logic in the scraper, so it is the only thing with a
test. Two steps:

1. **Classify.** A posting is kept when its title names an early-career stage
   (`intern` or `new-grad`) *and* a topic we care about (`swe` or `ai-ml`) *and*
   does not name a discipline that is plainly not software. Without that last
   check "Sales Engineer Intern" and "Mechanical Engineering Co-op" both pass on
   the word "engineer" alone.

2. **Dedupe** on exact `(company, title)`. Boards post one row per office, so
   Stripe lists "Software Engineer, New Grad" seven times; those collapse into one
   role carrying a location count. The match is exact on purpose -- Palantir's
   variants ("... Internship - US Government", "... - Commercial") are genuinely
   different roles, and normalising the suffix away would merge them.

Deduping is presentation only. Every raw posting stays in jobs.json.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

from workit_scraper.providers import Job

INTERN = re.compile(r"\bintern(?:s|ship|ships)?\b|\bco-?op\b", re.I)
NEW_GRAD = re.compile(
    r"\bnew ?grad(?:uate)?\b|\bgraduate\b|\bentry[- ]level\b|\bjunior\b"
    r"|\buniversity\b|\bcampus\b|\bearly[- ]career\b|\bapprentice\b",
    re.I,
)
SWE = re.compile(
    r"\bsoftware\b|\bengineer(?:ing)?\b|\bdeveloper\b|\bbackend\b|\bfrontend\b"
    r"|\bfull[- ]?stack\b|\binfrastructure\b|\bplatform\b|\bsystems?\b",
    re.I,
)
AI_ML = re.compile(
    r"\bmachine learning\b|\bml\b|\bai\b|\bdeep learning\b|\bgen-?ai\b"
    r"|\bgenerative ai\b|\bresearch (?:scientist|engineer)\b|\bdata scien\w*\b"
    r"|\bnlp\b|\bcomputer vision\b|\bllms?\b",
    re.I,
)
# A genuinely early-career posting never advertises a senior level. Together AI lists
# "Junior/Senior or Staff Software Engineer, Inference" -- one opening at any level,
# which matches `junior` and is not a new-grad role. Seniority wins over the stage.
SENIOR = re.compile(r"\bsenior\b|\bstaff\b|\bprincipal\b|\bdirector\b|\bhead of\b|\bmanager\b", re.I)
# "Engineer" appears in jobs that have nothing to do with software. These words win.
NOT_SOFTWARE = re.compile(
    r"\bsales\b|\baccount\b|\bmarketing\b|\brecruit\w*\b|\bpeople\b|\bhr\b"
    r"|\bfinance\b|\blegal\b|\bmechanical\b|\belectrical\b|\bcivil\b|\bchemical\b"
    r"|\bindustrial\b|\bmanufactur\w*\b|\brefrigerat\w*\b|\bnurse\b|\bdentist\b"
    r"|\bphysician\b|\bteacher\b|\bcustomer\b|\bsupport\b",
    re.I,
)


@dataclass(frozen=True, slots=True)
class Role:
    """One distinct role on the page, possibly standing for several postings."""

    title: str
    company: str
    apply_url: str
    ats: str
    tags: tuple[str, ...]
    posted_at: str | None
    first_seen_at: str
    department: str | None
    locations: tuple[str, ...]

    @property
    def location_label(self) -> str:
        if not self.locations:
            return ""
        if len(self.locations) == 1:
            return self.locations[0]
        return f"{len(self.locations)} locations"


def classify(title: str) -> tuple[str, ...]:
    """Tags for a title, or an empty tuple if it does not belong on the page."""
    if not title or NOT_SOFTWARE.search(title) or SENIOR.search(title):
        return ()
    stage = "intern" if INTERN.search(title) else "new-grad" if NEW_GRAD.search(title) else None
    if stage is None:
        return ()
    topics = [name for name, pattern in (("ai-ml", AI_ML), ("swe", SWE)) if pattern.search(title)]
    if not topics:
        return ()
    return (stage, *topics)


def pick(jobs: list[Job]) -> list[Role]:
    """Classify, dedupe, and order newest-first by the provider's posted date."""
    grouped: dict[tuple[str, str], list[Job]] = {}
    for job in jobs:
        tags = classify(job.title)
        if tags:
            grouped.setdefault((job.company, job.title), []).append(job)

    roles = []
    for (company, title), postings in grouped.items():
        # The oldest first_seen_at is the honest one: this role has been known to us
        # since whenever we first saw *any* of its copies.
        oldest = min(postings, key=lambda job: job.first_seen_at or "9999")
        locations = tuple(dict.fromkeys(job.location for job in postings if job.location))
        roles.append(
            Role(
                title=title,
                company=company,
                apply_url=oldest.apply_url,
                ats=oldest.ats,
                tags=classify(title),
                posted_at=min(
                    (job.posted_at for job in postings if job.posted_at), default=None
                ),
                first_seen_at=oldest.first_seen_at,
                department=next((job.department for job in postings if job.department), None),
                locations=locations,
            )
        )
    # None sorts last: a posting with no date is not a brand new one.
    return sorted(roles, key=lambda role: (role.posted_at is not None, role.posted_at or ""), reverse=True)
