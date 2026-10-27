"""What every reader produces and is registered by: a board, a posting and its
page, and the `Provider` record; and the errors a read can end in."""

from __future__ import annotations

import re
from collections.abc import Callable
from dataclasses import asdict, dataclass, fields

from workit_scraper import details

#: Bump when what a `Page` holds changes, so Greenhouse postings stored before it
#: are read once more. 5: the Page model (one value instead of nine fields).
#: 8: work-model metadata, LinkedIn tags and the facts the 2026-10-08 audit found missed.
#: 9: visa sponsorship (`details.sponsorship`). 10: the KAN-168 sponsorship fixes
#: (plural "citizens", narrower negations and headings), so stored pages are re-read.
#: 11: a Workday posting's requisition number (`Page.requisition`). 12: pay with
#: cents ("$61,900.00 to $141,000.00") read as the whole range, not its low end.
#: 13: pay words as whole words ("quota-based" is not "base"), and a sentence's own.
#: 14: the description keeps only its kept sections, under fixed headings, and a pay
#: range whose low end carries its unit ("$50/hr - $70/hr") reads whole (KAN-229).
#: 15: the HTML's list items and headings guide the sections, and a list item is
#: stored as "• item" (`plain_lines`); with it, unreleased, a line moved by what it
#: says and less job text hidden, and the learned headings (`docs/sections.md`).
# 16: lower-bound salary annotations and implicitly closed HTML lists.
# 17: preserve explicit requirements that mention benefits products.
PAGE_VERSION = 17


class BoardNotFound(Exception):
    """The board does not exist (HTTP 404), as opposed to existing and being empty."""


class TooLarge(Exception):
    """A board we cannot read whole within a run's means (Workday: see `workday`).
    Reported and skipped; a partial read would be evidence of nothing."""


class Incomplete(Exception):
    """A paged read that did not add up: the board changed under us, or the pages
    overlapped. Treated as a failed read, so it is evidence of nothing."""


@dataclass(frozen=True, slots=True)
class Board:
    """One row of boards.csv: a company's board on one applicant tracking system."""

    ats: str
    token: str
    company: str

    @property
    def key(self) -> str:
        return f"{self.ats}/{self.token}"


@dataclass(frozen=True, slots=True)
class Page:
    """What a posting's own text says: its description and the card's facts.

    Ashby, Lever and Recruitee send it with every listing; a Greenhouse, Workable
    or BambooHR posting has none until its own page is read (`describe`), once,
    after which the store carries it forward whole.
    """

    #: The PAGE_VERSION it was read under; an older one is read again.
    version: int
    #: Plain text, at most DESCRIPTION_CHARS. The facts were read before the cut.
    description: str | None
    facts: details.Facts
    #: A Greenhouse posting's offices: the place when its location is only a work
    #: model ("In-Office"). A Workday posting's places when its list said only
    #: "3 Locations", joined into one ("A; B; C").
    offices: tuple[str, ...] = ()
    #: A Workday posting's requisition number (`jobReqId`): one job posted on two of
    #: a company's careers sites has one, and `shortlist.pick` shows it once.
    requisition: str | None = None

    @classmethod
    def from_row(cls, row: dict) -> Page:
        return cls(
            version=row["version"],
            description=row["description"],
            facts=details.Facts.from_row(row["facts"]),
            offices=tuple(row.get("offices") or ()),
            requisition=row.get("requisition"),
        )


@dataclass(frozen=True, slots=True)
class Job:
    """One posting, normalised across providers.

    `posted_at` is the provider's own claim about when it went up (on BambooHR,
    only its own page says, so it arrives with the page). `first_seen_at`
    is ours, written on the run that first saw the posting and never updated after
    -- an employer can re-stamp the former, but not the latter.
    """

    ats: str
    token: str
    company: str
    external_id: str
    title: str
    apply_url: str
    location: str | None = None
    department: str | None = None
    posted_at: str | None = None
    #: None only for a posting whose own page is not read yet (`Provider.job_url`).
    page: Page | None = None
    # None until `store.update` stamps them; every job read back from jobs.json has both.
    first_seen_at: str | None = None
    last_seen_at: str | None = None
    #: The work model its list states, for a provider whose posting's own page does
    #: not (Rippling): the page's facts are read with it (`describe_rippling`).
    work_style: str | None = None

    @property
    def board_key(self) -> str:
        return f"{self.ats}/{self.token}"

    @property
    def key(self) -> str:
        return f"{self.board_key}#{self.external_id}"

    @property
    def description(self) -> str | None:
        return self.page.description if self.page else None

    @property
    def facts(self) -> details.Facts:
        return self.page.facts if self.page else details.Facts()

    @property
    def places(self) -> tuple[str, ...]:
        """Where the posting is. Cloudflare's Greenhouse board names every location
        "In-Office" and puts the city in the posting's offices, so its Lisbon and
        London internships read as one role posted twice. "Hybrid" with no office
        is a work style, not somewhere to be; "Remote" is a place: anywhere. A
        Workday list says only "3 Locations" of a posting in several, so such a
        posting has no location, and its own page names them (`describe_workday`)."""
        if self.location and not _placeless(self.location):
            return (self.location,)
        return self.page.offices if self.page else ()

    def to_row(self) -> dict[str, object]:
        return {**asdict(self), "key": self.key}

    @classmethod
    def from_row(cls, row: dict[str, object]) -> Job:
        # Only our own fields: `key` is derived, and older files carry columns we
        # no longer keep (`tags`, and the flat card facts before `Page`).
        known = {f.name: row[f.name] for f in fields(cls) if f.name in row}
        page = known.get("page")
        return cls(**{**known, "page": Page.from_row(page) if isinstance(page, dict) else None})


def _placeless(location: str | None) -> bool:
    """A location that names a work model and no place: "In-Office", "Hybrid"."""
    return re.sub(r"[\s-]", "", (location or "").lower()) in {
        "inoffice",
        "onsite",
        "hybrid",
        "office",
    }


@dataclass(frozen=True, slots=True)
class Provider:
    """Everything the scraper knows about one hiring system, in one place, so a new
    one is its reader and one entry in `PROVIDERS` (scraper/CLAUDE.md, "Adding a
    provider"). Its key there is the `ats` of boards.csv."""

    #: The board's list. Both the reader and the robots.txt check read it, so a board
    #: is never checked at one address and then fetched at another.
    listing_url: str
    #: Reads one board, `(token, company) -> list[Job]`; with `pace=` when `paged`.
    read: Callable[..., list[Job]]
    #: What an apply link in the curated lists names a board by (build_boards.py):
    #: its groups, joined by "/", are the token.
    apply_link: re.Pattern[str]
    #: A kept posting's own page, when the list leaves out what it says, and the
    #: function that reads it (`describe`). On the list's origin, so the robots.txt
    #: read for the board covers it too.
    job_url: str | None = None
    describe: Callable[[Job], Job] | None = None
    #: More than one request per board: `read` takes the run's `pace` and calls it
    #: before each request after the first (`__main__._scrape_one`).
    paged: bool = False
    #: Its list names a posting only by its URL's slug, so the title its page gave
    #: wins and the store carries it forward (`store.carry`).
    page_title: bool = False
    #: Its list dates a posting only roughly (Workday's "Posted 3 Days Ago",
    #: Oracle's bare day), so the exact date its page gave wins over a bare
    #: listing's (`store.carry`).
    page_date: bool = False
    #: Its token's case is part of it, so build_boards.py keeps it as the apply link
    #: writes it rather than lower-casing it.
    keeps_case: bool = False
    #: Another URL robots.txt must allow before a board is read (`robots_urls`).
    careers_site: str | None = None
    #: Each company is its own subdomain of this domain, one provider's servers
    #: behind them all: they share one pace (`polite.SHARED_PACE`).
    subdomains: str | None = None
    #: Its paths are case-blind, so its robots.txt is read case-blind too
    #: (`polite.FOLD_CASE`). Read by its `subdomains`, which it needs.
    case_blind: bool = False
    #: How long its lane may keep starting boards, in seconds (`__main__._lane`).
    budget_s: int | None = None
    #: Its board page, for the logo (logos.py); None when no logo is read.
    logo_page: str | None = None
    #: The logo on that page. Each accepts only its own image host, and
    #: frontend/next.config.ts allows exactly these hosts: with the optimizer on,
    #: next/image throws -- failing the whole page -- on any other; it is off on
    #: Cloudflare (KAN-169) but stays one line from coming back, so a logo from
    #: anywhere else must stay out of the feed. None reads only a website (logos.py).
    logo_pattern: re.Pattern[str] | None = None
