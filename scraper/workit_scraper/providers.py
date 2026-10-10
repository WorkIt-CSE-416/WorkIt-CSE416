"""Talk to one job board and return its postings.

One function per applicant tracking system, registered in `FETCHERS`. Each one
makes a single GET and maps the response onto `Job`. Three explicit functions
rather than a shared field-map table: a teammate reading `lever()` should see
Lever's actual field names, not a DSL that encodes them.

All three APIs return a whole board in one response -- verified at Stripe (701
postings), OpenAI (829) and Palantir (321) -- so there is no pagination here.

All three also 404 on a slug that does not exist, which is what makes
`BoardNotFound` meaningful: a 200 carrying an empty list is a real board that
simply has nothing open right now, and must never be confused with a typo.
"""

from __future__ import annotations

import html
import json
import re
import time
import urllib.error
from collections.abc import Callable
from dataclasses import asdict, dataclass, fields, replace
from datetime import UTC, datetime
from html.parser import HTMLParser

from workit_scraper import details, web

TIMEOUT_S = 25

#: Longest description kept, about 2,000 tokens. Measured on the 2026-10-05
#: feed: at 3,000 a fifth of roles lost their requirements behind a long company
#: intro, which is the part Scout reads for. Past this is benefits and
#: boilerplate. Changing it does not re-cut stored Greenhouse descriptions --
#: see scraper/CLAUDE.md.
DESCRIPTION_CHARS = 8000


#: Bump when what a `Page` holds changes, so Greenhouse postings stored before it
#: are read once more. 5: the Page model (one value instead of nine fields).
#: 8: work-model metadata, LinkedIn tags and the facts the 2026-10-08 audit found missed.
#: 9: visa sponsorship (`details.sponsorship`). 10: the KAN-168 sponsorship fixes
#: (plural "citizens", narrower negations and headings), so stored pages are re-read.
PAGE_VERSION = 10


class BoardNotFound(Exception):
    """The board does not exist (HTTP 404), as opposed to existing and being empty."""


# One place both the fetchers and the robots.txt check read the URL from, so a board
# can never be checked at one address and then fetched at another.
LISTING_URL = {
    "greenhouse": "https://boards-api.greenhouse.io/v1/boards/{token}/jobs",
    # Pay is left out of Ashby's list unless asked for.
    "ashby": "https://api.ashbyhq.com/posting-api/job-board/{token}?includeCompensation=true",
    "lever": "https://api.lever.co/v0/postings/{token}?mode=json",
}


def listing_url(ats: str, token: str) -> str:
    return LISTING_URL[ats].format(token=token)


# Greenhouse's list leaves descriptions out unless asked with `content=true`, which
# sends every posting's full HTML -- hundreds of megabytes across all boards to
# describe the ~1% we keep. So a kept Greenhouse posting is fetched on its own,
# once: the store carries what it says forward after that. `pay_transparency` adds
# the pay ranges a board entered in Greenhouse's own pay fields.
GREENHOUSE_JOB_URL = (
    "https://boards-api.greenhouse.io/v1/boards/{token}/jobs/{job_id}?pay_transparency=true"
)


def greenhouse_job_url(token: str, job_id: str) -> str:
    return GREENHOUSE_JOB_URL.format(token=token, job_id=job_id)


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

    Ashby and Lever send it with every listing; a Greenhouse posting has none
    until its own page is read (`describe_greenhouse`), once, after which the
    store carries it forward whole.
    """

    #: The PAGE_VERSION it was read under; an older one is read again.
    version: int
    #: Plain text, at most DESCRIPTION_CHARS. The facts were read before the cut.
    description: str | None
    facts: details.Facts
    #: A Greenhouse posting's offices: the place when its location is only a work
    #: model ("In-Office").
    offices: tuple[str, ...] = ()

    @classmethod
    def from_row(cls, row: dict) -> Page:
        return cls(
            version=row["version"],
            description=row["description"],
            facts=details.Facts.from_row(row["facts"]),
            offices=tuple(row.get("offices") or ()),
        )


@dataclass(frozen=True, slots=True)
class Job:
    """One posting, normalised across providers.

    `posted_at` is the provider's own claim about when it went up. `first_seen_at`
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
    #: None only for a Greenhouse posting whose own page is not read yet.
    page: Page | None = None
    # None until `store.update` stamps them; every job read back from jobs.json has both.
    first_seen_at: str | None = None
    last_seen_at: str | None = None

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
        is a work style, not somewhere to be; "Remote" is a place: anywhere."""
        if not _placeless(self.location):
            return (self.location,) if self.location else ()
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


def _get_json(url: str) -> object:
    """GET and parse JSON, with one retry on a 5xx or an explicit Retry-After.

    A 404 becomes `BoardNotFound`; every other failure propagates, because a board
    we could not read is not a board we know anything about.
    """
    for attempt in (1, 2):
        try:
            return json.loads(web.get(url, timeout=TIMEOUT_S))
        except urllib.error.HTTPError as error:
            if error.code == 404:
                raise BoardNotFound(url) from error
            retry_after = error.headers.get("Retry-After") if error.headers else None
            if attempt == 2 or (error.code < 500 and not retry_after):
                raise
            time.sleep(min(float(retry_after), 30) if retry_after and retry_after.isdigit() else 2)
    raise AssertionError("unreachable")


def _iso(value: object) -> str | None:
    """Normalise a provider timestamp to an ISO 8601 UTC string, or None.

    Greenhouse and Ashby send ISO strings. Lever sends epoch milliseconds, and sends
    them as an int in some records and a numeric string in others -- so this accepts
    `object` and narrows, rather than trusting either provider's type discipline.
    """
    if value is None or value == "":
        return None
    if isinstance(value, bool):
        return None
    if isinstance(value, int | float):
        return datetime.fromtimestamp(value / 1000, UTC).isoformat()
    if not isinstance(value, str):
        return None
    if value.isdigit():
        return datetime.fromtimestamp(int(value) / 1000, UTC).isoformat()
    try:
        return datetime.fromisoformat(value).astimezone(UTC).isoformat()
    except ValueError:
        return None


class _TextOnly(HTMLParser):
    """An HTML fragment's text, with a line break wherever a block ended."""

    BLOCKS = {"p", "div", "li", "br", "h1", "h2", "h3", "h4", "h5", "h6", "ul", "ol", "tr"}

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []

    def handle_starttag(self, tag: str, attrs: object) -> None:
        self.handle_endtag(tag)

    def handle_endtag(self, tag: str) -> None:
        if tag in self.BLOCKS:
            self.parts.append("\n")

    def handle_data(self, data: str) -> None:
        self.parts.append(data)


def plain_text(markup: str | None) -> str | None:
    """Plain text from a description that may be HTML, whole.

    Unescaped once before parsing because Greenhouse entity-escapes its HTML
    ("&lt;p&gt;"), which the parser would otherwise keep as literal text.
    """
    if not markup:
        return None
    parser = _TextOnly()
    parser.feed(html.unescape(markup))
    parser.close()
    lines = (
        re.sub(r"[ \t\xa0]+", " ", line).strip() for line in "".join(parser.parts).splitlines()
    )
    return "\n".join(line for line in lines if line) or None


def cap(plain: str | None) -> str | None:
    """At most DESCRIPTION_CHARS, cut at a word: what is stored for Scout."""
    if plain is None or len(plain) <= DESCRIPTION_CHARS:
        return plain
    return plain[:DESCRIPTION_CHARS].rsplit(maxsplit=1)[0] + " …"


def _page(
    title: str,
    full: str | None,
    *,
    stated_type: str | None = None,
    stated_style: str | None = None,
    stated_pay: details.Pay | None = None,
    offices: tuple[str, ...] = (),
) -> Page:
    """A Page from a posting's whole text: facts read first, description cut after."""
    facts = details.read(
        title, full, stated_type=stated_type, stated_style=stated_style, stated_pay=stated_pay
    )
    return Page(version=PAGE_VERSION, description=cap(full), facts=facts, offices=offices)


def _work_style(value: object, location: str | None) -> str | None:
    """Remote / Hybrid / On site, or None when the provider does not say.

    Ashby sends `Remote|Hybrid|OnSite`, Lever sends the same words lowercased, and
    Greenhouse sends nothing at all -- so on a Greenhouse board only a location that
    says remote fills it in.
    Blank is the honest answer; guessing "On site" because a field is missing would
    put a fact on the page that no employer stated. A location that says remote is
    the one safe inference.
    """
    text = str(value or "").strip().lower()
    if text.startswith("remote"):
        return "Remote"
    if text.startswith("hybrid"):
        return "Hybrid"
    if text.replace("-", "").replace(" ", "") in {"onsite", "inoffice"}:
        return "On site"
    if location and "remote" in location.lower():
        return "Remote"
    return None


def _placeless(location: str | None) -> bool:
    """A location that names a work model and no place: "In-Office", "Hybrid"."""
    return re.sub(r"[\s-]", "", (location or "").lower()) in {
        "inoffice",
        "onsite",
        "hybrid",
        "office",
    }


def _ashby_pay(row: dict) -> details.Pay | None:
    for part in (row.get("compensation") or {}).get("summaryComponents") or []:
        if part.get("compensationType") == "Salary":
            return details.Pay.from_interval(
                part.get("currencyCode"),
                part.get("minValue"),
                part.get("maxValue"),
                part.get("interval"),
            )
    return None


def _lever_pay(row: dict) -> details.Pay | None:
    salary = row.get("salaryRange") or {}
    return details.Pay.from_interval(
        salary.get("currency"), salary.get("min"), salary.get("max"), salary.get("interval")
    )


def greenhouse(token: str, company: str) -> list[Job]:
    payload = _get_json(listing_url("greenhouse", token))
    assert isinstance(payload, dict)
    return [
        Job(
            ats="greenhouse",
            token=token,
            # Not Greenhouse's `company_name`: boards carry internal labels there
            # ("LinkedIn Job Wrapping", "DRW - University Jobs") that split one
            # company's roles apart. boards.csv names the company once.
            company=company,
            external_id=str(row["id"]),
            title=(row.get("title") or "").strip(),
            apply_url=row.get("absolute_url") or "",
            location=(row.get("location") or {}).get("name"),
            posted_at=_iso(row.get("first_published") or row.get("updated_at")),
            # No page: its own page is read once (`describe_greenhouse`).
        )
        for row in payload.get("jobs") or []
    ]


def ashby(token: str, company: str) -> list[Job]:
    payload = _get_json(listing_url("ashby", token))
    assert isinstance(payload, dict)
    jobs = []
    for row in payload.get("jobs") or []:
        # Ashby is the only one that tells us a posting is unlisted. Believe it.
        if not row.get("isListed", True):
            continue
        title = (row.get("title") or "").strip()
        jobs.append(
            Job(
                ats="ashby",
                token=token,
                company=company,
                external_id=str(row["id"]),
                title=title,
                apply_url=row.get("applyUrl") or row.get("jobUrl") or "",
                location=row.get("location"),
                department=row.get("department"),
                posted_at=_iso(row.get("publishedAt")),
                page=_page(
                    title,
                    plain_text(row.get("descriptionPlain") or row.get("descriptionHtml")),
                    stated_type=details.job_type_label(row.get("employmentType")),
                    # Some boards leave `workplaceType` unset but still flag `isRemote`.
                    stated_style=_work_style(
                        row.get("workplaceType") or ("Remote" if row.get("isRemote") else None),
                        row.get("location"),
                    ),
                    stated_pay=_ashby_pay(row),
                ),
            )
        )
    return jobs


def lever(token: str, company: str) -> list[Job]:
    # The odd one out: a bare JSON array, `text` for the title, and `createdAt` as
    # epoch milliseconds in a string.
    payload = _get_json(listing_url("lever", token))
    assert isinstance(payload, list)
    jobs = []
    for row in payload:
        categories = row.get("categories") or {}
        title = (row.get("text") or "").strip()
        jobs.append(
            Job(
                ats="lever",
                token=token,
                company=company,
                external_id=str(row["id"]),
                title=title,
                apply_url=row.get("hostedUrl") or row.get("applyUrl") or "",
                location=categories.get("location"),
                department=categories.get("team"),
                posted_at=_iso(row.get("createdAt")),
                page=_page(
                    title,
                    _lever_description(row),
                    stated_type=details.job_type_label(categories.get("commitment")),
                    # Some boards put the work model in `commitment` ("Remote").
                    stated_style=_work_style(row.get("workplaceType"), categories.get("location"))
                    or _work_style(categories.get("commitment"), None),
                    stated_pay=_lever_pay(row),
                ),
            )
        )
    return jobs


def _lever_description(row: dict) -> str | None:
    """Lever splits a posting in three: an intro (`descriptionPlain`), titled lists
    that usually hold the requirements (`lists`, HTML items), and a closing
    (`additionalPlain`). The intro alone is often just a company blurb."""
    sections = [row.get("descriptionPlain") or ""]
    for block in row.get("lists") or []:
        sections.append(f"<p>{block.get('text') or ''}</p><ul>{block.get('content') or ''}</ul>")
    sections.append(row.get("additionalPlain") or "")
    return plain_text("<br>".join(section for section in sections if section))


def describe_greenhouse(job: Job) -> Job:
    """The same Greenhouse posting with what only its own page says: the
    description, the offices, pay ranges and any employment-type field."""
    payload = _get_json(greenhouse_job_url(job.token, job.external_id))
    assert isinstance(payload, dict)
    return replace(
        job,
        page=_page(
            job.title,
            plain_text(payload.get("content")),
            stated_type=_greenhouse_job_type(payload.get("metadata") or []),
            # Greenhouse has no work-model field, but boards name one as the
            # location: Cloudflare's "In-Office", others' "Hybrid".
            stated_style=_work_style(job.location, job.location)
            or _greenhouse_work_style(payload.get("metadata") or []),
            stated_pay=_greenhouse_pay(payload.get("pay_input_ranges") or []),
            offices=tuple(o["name"] for o in payload.get("offices") or [] if o.get("name")),
        ),
    )


def _greenhouse_work_style(metadata: list[dict]) -> str | None:
    """A board's own work-model field: "Working Conditions: Hybrid" (Ashby-style
    location types), "Is Remote?: true"."""
    for field in metadata:
        name, value = str(field.get("name")), field.get("value")
        named = re.search(
            r"working conditions|work(?:place)? (?:type|model|arrangement)|location type",
            name,
            re.I,
        )
        if named and (style := _work_style(value, None)):
            return style
        if re.search(r"\bis remote\b|\bremote\??$", name, re.I) and value is True:
            return "Remote"
    return None


def _greenhouse_job_type(metadata: list[dict]) -> str | None:
    """Greenhouse has no employment-type field, but boards add one under their own
    name: "Employment Type" (Attentive), "Employment Length" (Canonical)."""
    for field in metadata:
        named = re.search(r"employment|time type|job type|worker", str(field.get("name")), re.I)
        if named and (kind := details.job_type_label(field.get("value"))):
            return kind
    return None


def _greenhouse_pay(ranges: list[dict]) -> details.Pay | None:
    """Pay ranges in cents, one per zone or state, with the period only in a title
    ("Hourly Pay Range") -- or nowhere, when only the amount can tell."""
    currencies = {r.get("currency_type") for r in ranges}
    if len(currencies) != 1:
        return None
    cents = [c for r in ranges for c in (r.get("min_cents"), r.get("max_cents"))]
    if not all(isinstance(c, int) for c in cents):
        return None
    titles = " ".join(f"{r.get('title') or ''} {plain_text(r.get('blurb')) or ''}" for r in ranges)
    return details.Pay.from_amounts(currencies.pop(), min(cents) / 100, max(cents) / 100, titles)


FETCHERS: dict[str, Callable[[str, str], list[Job]]] = {
    "greenhouse": greenhouse,
    "ashby": ashby,
    "lever": lever,
}
