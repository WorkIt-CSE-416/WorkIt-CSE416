"""Decide which postings belong on the page, and collapse true duplicates.

The scraper's densest logic, and the place a bug is quietest. Two steps:

1. **Classify.** A posting is kept when its title names an early-career stage
   (`intern` or `new-grad`) *and* one of five categories (software, data and AI,
   product, quant, hardware) *and* no discipline outside them. Without that last
   check "Sales Engineer Intern" and "Mechanical Engineering Co-op" both pass on
   the words "engineer" and "engineering" alone. The first category that matches
   is the role's one category (`CATEGORIES`).

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
    """What a role is: a stage (intern or new grad), then its one category.

    The categories are the SimplifyJobs lists' five, which `boards.csv` is
    built from (`build_boards.py`), and their values are `feed.json`'s
    `role_category`: the backend's `role_category` enum, so a new one is a
    change on both sides."""

    INTERN = "intern"
    NEW_GRAD = "new-grad"
    SOFTWARE = "software"
    DATA_AI = "data_ai"
    PRODUCT = "product"
    QUANT = "quant"
    HARDWARE = "hardware"


INTERN = re.compile(r"\bintern(?:s|ship|ships)?\b|\bco-?op\b", re.I)
NEW_GRAD = re.compile(
    r"\bnew ?grad(?:uate)?\b|\bgraduate\b|\bentry[- ]level\b|\bjunior\b"
    r"|\buniversity\b|\bcampus\b|\bearly[- ]career\b|\bapprentice\b",
    re.I,
)
# "Engineer" on its own is not a software signal. Wade Trim posts "Engineer Summer
# Intern", Olsson posts "Entry-Level Roadway Engineer", Rocket Lab posts "Thermal
# Engineering Intern" -- all real early-career engineering, none of it in our five
# categories. So each category names its specialisms explicitly. The cost is real
# and accepted: a bare "Engineering Intern" at a software company is dropped too,
# because nothing in that title distinguishes it from Wade Trim's.
SOFTWARE = re.compile(
    r"\bsoftware\b|\bdeveloper\b|\bprogrammer\b|\bswe\b"
    r"|\bback[- ]?end\b|\bfront[- ]?end\b|\bfull[- ]?stack\b"
    r"|\bweb\b|\bmobile\b|\bios\b|\bandroid\b"
    r"|\binfrastructure\b|\bplatform\b|\bdistributed systems\b|\bsystems? software\b"
    r"|\bdev\s?ops\b|\bsre\b|\bsite reliability\b|\bcompiler\b|\bdatabase\b|\bcloud\b"
    r"|\bapi\b|\bsecurity engineer\w*\b|\bnetwork engineer\w*\b"
    r"|\bqa\b|\btest automation\b|\bcomputer science\b|\bcoding\b"
    # SimplifyJobs files 114 of its 130 forward deployed roles under Software.
    r"|\bforward deployed\b",
    re.I,
)
DATA_AI = re.compile(
    r"\bmachine learning\b|\bml\b|\bdeep learning\b"
    r"|\bresearch (?:scientist|engineer)\b|\bdata scien\w*\b"
    # A robot's or a car's perception, not Brooks's "Run Perception Graduate
    # Internship" (consumer research).
    r"|\bnlp\b|\bcomputer vision\b|(?<!run )\bperception\b"
    r"|\bapplied (?:ai|scien\w*|research\w*)\b|\breinforcement learning\b|\brobot learning\b"
    # SimplifyJobs files data engineers (665 of 666) and analysts (1,063 of 1,064)
    # here, not under Software.
    r"|\bdata engineer\w*\b|\bdata analy\w*\b|\banalytics engineer\w*\b",
    re.I,
)
# "AI" as a modifier is weaker: "Software Engineer Intern (AI Internal Tools)" is a
# software job, as SimplifyJobs files 281 of its 347 titles naming both. So it
# claims a title only after hardware and software have passed (`CATEGORIES`).
AI = re.compile(r"\bai\b|\bgen-?ai\b|\bgenerative ai\b|\bllms?\b|\bagentic\b", re.I)
PRODUCT = re.compile(r"\bproduct manag\w*\b|\bproduct owner\b|\bproduct analyst\b|\bapm\b", re.I)
# A quant word names the role whatever else the title says: "Quantitative
# Developer" is a quant's job, not a software one.
QUANT = re.compile(r"\bquant(?:s|itative)?\b|\btraders?\b", re.I)
# "Trading" alone is weaker. "Software Engineer, Trading Systems" is a software
# job at a trading firm, so it is quant only when nothing else claims the title
# (`classify`); "Trading Operations" is back office.
TRADING = re.compile(r"\btrading\b(?!\s+operations?\b)", re.I)
# Electrical, computer and embedded engineering, chips, robotics: SimplifyJobs'
# Hardware list. Mechanical, civil and the rest stay out (NOT_OURS). Firmware and
# embedded are here, not in Software, as SimplifyJobs files them (681 of 701).
HARDWARE = re.compile(
    # Hermeus's "Flight Software Engineering Intern (Simulation/Hardware-In-The-Loop)"
    # is a software job.
    r"\bhardware\b(?![- ]in[- ]the[- ]loop)"
    r"|\belectrical\b|\belectronics?\b|\belectromagnetics?\b|\bembedded\b"
    r"|\bfirmware\b|\bfpga\b|\basic\b|\brtl\b|\bvlsi\b|\bsilicon\b|\bsemiconductors?\b"
    r"|\bphysical design\b|\bdesign verification\b|\bdigital design\b|\bdv engineer\w*\b"
    r"|\bdft\b|\bmixed[- ]signal\b|\banalog\b|\bsignal integrity\b|\bcircuits?\b|\bpcb\b"
    r"|\brf\b|\bantennas?\b|\bphotonics?\b|\boptic(?:s|al)\b|\bavionics\b"
    r"|\bmechatronics?\b",
    re.I,
)
# Robotics is hardware only when no software word claims the title first:
# Neuralink's "Software Engineer Intern, Robotics" writes software.
ROBOTICS = re.compile(r"\brobotics?\b", re.I)
# Which category a title is in, first match wins. Quant and product name the job
# outright; machine learning outranks the software or hardware it is done on
# (IMC's "Hardware Machine Learning PhD Research Internship" is research);
# hardware outranks the generic software words ("platform", "infrastructure").
CATEGORIES = (
    (Tag.QUANT, QUANT),
    (Tag.PRODUCT, PRODUCT),
    (Tag.DATA_AI, DATA_AI),
    (Tag.HARDWARE, HARDWARE),
    (Tag.SOFTWARE, SOFTWARE),
    (Tag.HARDWARE, ROBOTICS),
    (Tag.DATA_AI, AI),
    (Tag.QUANT, TRADING),
)
# A genuinely early-career posting never advertises a senior level. Together AI lists
# "Junior/Senior or Staff Software Engineer, Inference" -- one opening at any level,
# which matches `junior` and is not a new-grad role. Seniority wins over the stage.
# A product manager is the job's name, not a level above it.
SENIOR = re.compile(
    r"\bsenior\b|\bstaff\b|\bprincipal\b|\bdirector\b|\bhead of\b|(?<!product )\bmanager\b",
    re.I,
)
# Disciplines outside the five. Each names a job that one of the categories'
# words would otherwise claim ("Sales Engineer Intern", "Mechanical Engineering
# Co-op", "Hardware Sourcing Intern"), and these words win.
NOT_OURS = re.compile(
    r"\bsales\b|\baccount\b|\bmarketing\b|\brecruit\w*\b|\bpeople\b|\bhr\b"
    r"|(?<!quantitative )\bfinance\b|\blegal\b|\bcivil\b|\bchemical\b"
    r"|\bindustrial\b|\bmanufactur\w*\b|\brefrigerat\w*\b|\bnurse\b|\bdentist\b"
    r"|\bphysician\b|\bteacher\b|\bcustomer\b|\bsupport\b"
    # "Structural Engineering Internship - Federal Infrastructure" otherwise qualifies
    # on the word `infrastructure`.
    r"|\bstructural\b"
    # Mechanical engineering is its own discipline, not hardware; nor is "Hardware
    # Thermal Simulation Engineering Intern" (Rivian).
    r"|\bmechanical\b|\bthermal\b"
    # An electrical engineer for buildings and utilities is a civil discipline:
    # Burns & McDonnell's "Electrical Engineer-Power Systems", "Electrical
    # Engineering Internship - Facilities (Healthcare)", "Midstream Electrical
    # Engineer Intern".
    r"|\bpower systems?\b|\bfacilit(?:y|ies)\b|\bmidstream\b|\bsubstations?\b"
    r"|\butilit(?:y|ies)\b|\bconstruction\b"
    # A product designer designs; design is not one of the five.
    r"|\bproduct design\w*\b"
    # Waymo's "Quantitative UX Researcher" studies users, not markets.
    r"|\bux research\w*\b"
    r"|\bsourcing\b|\bprogram manag\w*\b|\btalent\b"
    # Trades and operators, not engineers: InfraServices' "Electrical Apprentice",
    # Silvus's "Electronics Test and Assembly Technician", Faraday Future's
    # "Robotics Data Operator Intern", Nexus's "Electrical Drafter/Designer".
    r"|\belectrical apprentice\b|\btechnicians?\b|\boperators?\b|\bdrafter\b",
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
    #: The first copy's facts, whole, with `work_style` and `job_type` as the card
    #: shows them: stated, or inferred (see `_work_style` and `_job_type`).
    facts: Facts = field(default_factory=Facts)

    @property
    def category(self) -> Tag:
        """The role's one category; `classify` puts it after the stage."""
        return self.tags[1]

    @property
    def location_label(self) -> str:
        if not self.locations:
            return ""
        if len(self.locations) == 1:
            return self.locations[0]
        return f"{len(self.locations)} locations"


def classify(title: str) -> tuple[Tag, ...]:
    """(stage, category) for a title, or an empty tuple if it does not belong."""
    if not title or NOT_OURS.search(title) or SENIOR.search(title):
        return ()
    if INTERN.search(title):
        stage = Tag.INTERN
    elif NEW_GRAD.search(title):
        stage = Tag.NEW_GRAD
    else:
        return ()
    category = next((tag for tag, pattern in CATEGORIES if pattern.search(title)), None)
    return (stage, category) if category else ()


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
                    facts,
                    work_style=_work_style(postings, styles.get(postings[0].company)),
                    job_type=_job_type(tags, facts),
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


def _job_type(tags: tuple[Tag, ...], facts: Facts) -> str | None:
    """The card's job type, first answer wins:

    1. what the posting states -- its board's field or a sentence (`Facts`);
    2. "full_time" for a new-grad role.

    Measured on the live feed (2026-10-10): 216 of 216 new-grad roles that state a
    job type say full-time. A stated type always wins, so this never turns a
    part-time or contract posting into a full-time one.

    An internship is not inferred: the Jobs page shows "Internship" as every
    internship's job type, whatever its hours (decided 2026-10-10: a card saying
    "Full-Time Internship" beside "Part-Time Internship" read as two kinds of
    internship). What an internship's posting states is still kept here.
    """
    if facts.job_type:
        return facts.job_type
    if Tag.NEW_GRAD in tags:
        return "full_time"
    return None
