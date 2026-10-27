"""Talk to one job board and return its postings.

One function per applicant tracking system, registered in `FETCHERS`. Each one
makes a single GET and maps the response onto `Job`. Explicit functions rather
than a shared field-map table: a teammate reading `lever()` should see Lever's
actual field names, not a DSL that encodes them.

Every API but Workday's returns a whole board in one response -- verified at
Stripe (701 postings), OpenAI (829), Palantir (321), Genetec's Workable board (188)
and Hard Rock Digital's Recruitee board (58). Workday sends 20 postings a request,
so `workday` pages, and paces every page (scraper/CLAUDE.md, "Workday"). Oracle,
TikTok, iCIMS's Jibe sites and SuccessFactors page too (`PAGED`), each read whole or
not at all (docs/providers.md).

A slug that does not exist is a 404 everywhere but BambooHR, which redirects it
to its own homepage (`bamboohr` turns that into the same answer). That is what
makes `BoardNotFound` meaningful: a 200 carrying an empty list is a real board
that simply has nothing open right now, and must never be confused with a typo.

Greenhouse, Workable, BambooHR and Workday list a board without its
descriptions, so a kept posting's own page is read once more (`describe`); Ashby,
Lever and Recruitee send the descriptions with the list.
"""

from __future__ import annotations

import html
import json
import re
import time
import urllib.error
from collections import Counter
from collections.abc import Callable, Iterable
from dataclasses import asdict, dataclass, fields, replace
from datetime import UTC, date, datetime, timedelta
from html.parser import HTMLParser

from workit_scraper import details, web
from workit_scraper.sections import kept

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


# One place both the fetchers and the robots.txt check read the URL from, so a board
# can never be checked at one address and then fetched at another.
LISTING_URL = {
    "greenhouse": "https://boards-api.greenhouse.io/v1/boards/{token}/jobs",
    # Pay is left out of Ashby's list unless asked for.
    "ashby": "https://api.ashbyhq.com/posting-api/job-board/{token}?includeCompensation=true",
    "lever": "https://api.lever.co/v0/postings/{token}?mode=json",
    # The careers-page widget's feed, which Workable documents for embedding a
    # board. Without `details=true`: the description comes from a kept posting's
    # own page, which also has the work model and pay the widget leaves out.
    "workable": "https://apply.workable.com/api/v1/widget/accounts/{token}",
    # Recruitee and BambooHR give each company its own subdomain, so its own
    # origin and robots.txt; `polite` still paces each provider as one host.
    "recruitee": "https://{token}.recruitee.com/api/offers/",
    "bamboohr": "https://{token}.bamboohr.com/careers/list",
    # What a Workday careers page itself calls: a POST of a search, answered 20
    # postings at a time. Not a documented public API (an accepted risk, like
    # Workable's per-posting page). `token` is "{tenant}.{wd}/{site}".
    "workday": "https://{tenant}.{wd}.myworkdayjobs.com/wday/cxs/{tenant}/{site}/jobs",
    # Oracle Recruiting Cloud's candidate site calls this public search, unsigned.
    # `token` is "{pod}/{site}": "ecnf.fa.us2/CX" is the pod ecnf.fa.us2.oraclecloud.com
    # and its careers site CX (one pod can run several). Paged (`oracle`).
    "oracle": (
        "https://{pod}.oraclecloud.com/hcmRestApi/resources/latest/recruitingCEJobRequisitions"
        "?onlyData=true&expand=requisitionList.secondaryLocations"
        "&finder=findReqs;siteNumber={site},limit={limit},offset={offset},sortBy=POSTING_DATES_DESC"
    ),
    # What lifeattiktok.com's search calls: a POST, one board for all of TikTok.
    "tiktok": "https://api.lifeattiktok.com/api/v1/public/supplier/search/job/posts",
    # iCIMS postings as a company's Jibe careers site lists them (careers.amd.com),
    # which is where the curated lists link them (`?icims=1`). `token` is that host.
    "icims": "https://{token}/api/jobs?page=1&limit=100",
    # SuccessFactors' career-site builder (jobs.grainger.com): its own search page,
    # HTML, a few dozen postings a page. `token` is that host. Sorted by title:
    # the default order is not stable from page to page (Hershey's repeated 8
    # postings across pages and left 8 out; by title, 328 of 328, 2026-10-26).
    "successfactors": "https://{token}/search/?q=&sortColumn=sort_title&sortDirection=asc&startrow=0",
}


def _parts(ats: str, token: str) -> dict[str, str]:
    """A Workday token's three parts: "nvidia.wd5/nvidiaexternalcareersite" is the
    tenant `nvidia`, on data centre `wd5`, careers site `nvidiaexternalcareersite`.
    A tenant can run several sites (Boeing has 40), each its own board."""
    if ats == "oracle":
        pod, site = token.split("/")
        return {"pod": pod, "site": site, "limit": str(ORACLE_PAGE), "offset": "0"}
    if ats != "workday":
        return {}
    host, site = token.split("/")
    tenant, wd = host.split(".")
    return {"tenant": tenant, "wd": wd, "site": site}


def listing_url(ats: str, token: str) -> str:
    return LISTING_URL[ats].format(token=token, **_parts(ats, token))


def robots_urls(ats: str, token: str) -> list[str]:
    """Every URL robots.txt must allow before a board is read. A Workday tenant's
    robots.txt names its careers sites, not the API path under them: Caterpillar's
    disallows `/CaterpillarCareers/`, and reading that site's postings through the
    API would be reading what the employer asked crawlers to leave alone."""
    urls = [listing_url(ats, token)]
    if ats == "workday":
        urls.append("https://{tenant}.{wd}.myworkdayjobs.com/{site}/".format(**_parts(ats, token)))
    return urls


# A kept posting's own page, for the providers whose list leaves it out. Each is on
# its list's origin, so the robots.txt read for the board covers it too.
JOB_URL = {
    # Greenhouse's list leaves descriptions out unless asked with `content=true`,
    # which sends every posting's full HTML -- hundreds of megabytes across all
    # boards to describe the ~1% we keep. So a kept Greenhouse posting is fetched
    # on its own, once: the store carries what it says forward after that.
    # `pay_transparency` adds the pay ranges a board entered in Greenhouse's own
    # pay fields.
    "greenhouse": (
        "https://boards-api.greenhouse.io/v1/boards/{token}/jobs/{job_id}?pay_transparency=true"
    ),
    # What Workable's own careers page reads: the description, requirements and
    # benefits, plus `workplace` (hybrid included) and a salary, neither of which
    # the widget carries. Six of 14 sampled postings had a salary (2026-10-10).
    "workable": "https://apply.workable.com/api/v2/accounts/{token}/jobs/{job_id}",
    # BambooHR's list has no description, no date and no pay.
    "bamboohr": "https://{token}.bamboohr.com/careers/{job_id}/detail",
    # Workday's list has the title, the place and a relative date; the
    # description, the exact date and the job type are on the posting's own
    # record. `job_id` is the posting's path ("/job/China-Shanghai/..._JR2024692").
    "workday": "https://{tenant}.{wd}.myworkdayjobs.com/wday/cxs/{tenant}/{site}{job_id}",
    # Oracle's list has a two-line summary; the record has the description.
    "oracle": (
        "https://{pod}.oraclecloud.com/hcmRestApi/resources/latest/recruitingCEJobRequisitionDetails"
        '?expand=all&onlyData=true&finder=ById;Id="{job_id}",siteNumber={site}'
    ),
    # The posting's own page, by its path, as on Workday.
    "successfactors": "https://{token}{job_id}",
}


def job_url(ats: str, token: str, job_id: str) -> str:
    return JOB_URL[ats].format(token=token, job_id=job_id, **_parts(ats, token))


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
    #: None only for a posting whose own page is not read yet (`JOB_URL`).
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


def _get_text(url: str) -> str:
    """`_get_json` for an HTML page: SuccessFactors' search and posting pages."""
    return _retry(url, lambda: web.get(url, timeout=TIMEOUT_S)).decode("utf-8", "replace")


def _get_json(url: str) -> object:
    """GET and parse JSON, with one retry on a 5xx, a 429 or an explicit Retry-After.

    A 404 becomes `BoardNotFound`; every other failure propagates, because a board
    we could not read is not a board we know anything about.
    """
    return _json(url, lambda: web.get(url, timeout=TIMEOUT_S))


def _post_json(url: str, payload: object, headers: dict[str, str] | None = None) -> object:
    """`_get_json` for a POST: Workday's and TikTok's lists. A 429 is retried once
    too, since five of ~1,700 Workday boards answered one on the first full sweep."""
    return _json(url, lambda: web.post(url, payload, timeout=TIMEOUT_S, headers=headers))


def _json(url: str, fetch: Callable[[], bytes]) -> object:
    return json.loads(_retry(url, fetch))


def _retry(url: str, fetch: Callable[[], bytes]) -> bytes:
    for attempt in (1, 2):
        try:
            return fetch()
        except urllib.error.HTTPError as error:
            if error.code == 404:
                raise BoardNotFound(url) from error
            retry_after = error.headers.get("Retry-After") if error.headers else None
            if attempt == 2 or (error.code < 500 and error.code != 429 and not retry_after):
                raise
            time.sleep(min(float(retry_after), 30) if retry_after and retry_after.isdigit() else 2)
    raise AssertionError("unreachable")


def _iso(value: object) -> str | None:
    """Normalise a provider timestamp to an ISO 8601 UTC string, or None.

    Greenhouse and Ashby send ISO strings. Lever sends epoch milliseconds, and sends
    them as an int in some records and a numeric string in others -- so this accepts
    `object` and narrows, rather than trusting either provider's type discipline.
    Workable and BambooHR send a bare date ("2026-05-29") and Recruitee
    "2026-10-08 10:34:56 UTC": a time with no zone is UTC, never this machine's.
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
        parsed = datetime.fromisoformat(value.removesuffix(" UTC"))
    except ValueError:
        return None
    return (parsed if parsed.tzinfo else parsed.replace(tzinfo=UTC)).astimezone(UTC).isoformat()


class _TextOnly(HTMLParser):
    """An HTML fragment's text, with a line break wherever a block ended, and the
    tags open around each piece of it."""

    BLOCKS = {"p", "div", "li", "br", "h1", "h2", "h3", "h4", "h5", "h6", "ul", "ol", "tr"}
    #: Tags that never close, so are never open around text.
    VOID = {"br", "img", "hr", "input", "meta", "link", "wbr", "col", "area", "base", "source"}

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.parts: list[tuple[str, tuple[str, ...]]] = []
        self.open: list[str] = []

    def handle_starttag(self, tag: str, attrs: object) -> None:
        if tag in self.BLOCKS:
            self.parts.append(("\n", ()))
        if tag not in self.VOID:
            self.open.append(tag)

    def handle_startendtag(self, tag: str, attrs: object) -> None:
        # "<br/>": a start and an end, two breaks, as before tags were tracked.
        if tag in self.BLOCKS:
            self.parts.extend((("\n", ()), ("\n", ())))

    def handle_endtag(self, tag: str) -> None:
        if tag in self.BLOCKS:
            self.parts.append(("\n", ()))
        for index in range(len(self.open) - 1, -1, -1):
            if self.open[index] == tag:
                del self.open[index:]
                break

    def handle_data(self, data: str) -> None:
        self.parts.append((data, tuple(self.open)))


def plain_lines(markup: str | None) -> list[tuple[str, str]]:
    """A description's plain-text lines, each with its role in the HTML: "h" inside a
    heading tag, "li" inside a list item, "b" when all of it is bold, "p" otherwise.

    The text is `plain_text`'s, line for line. The roles are what the HTML says and
    the text alone cannot: the section parser used to guess them from a line's
    shape, and took Workday's list item "Good interpersonal skills" for a heading
    (`sections._walk`). Plain text in, every line is "p".

    Unescaped once before parsing because Greenhouse entity-escapes its HTML
    ("&lt;p&gt;"), which the parser would otherwise keep as literal text.
    """
    if not markup:
        return []
    parser = _TextOnly()
    parser.feed(html.unescape(markup))
    parser.close()
    text = "".join(piece for piece, _ in parser.parts)
    # The tags open around each character, to read each line's role from.
    around = [tags for piece, tags in parser.parts for _ in piece]
    lines, start = [], 0
    for raw in text.splitlines(keepends=True):
        body = raw.rstrip("\r\n\x0b\x0c\x1c\x1d\x1e\x85\u2028\u2029")
        line = re.sub(r"[ \t\xa0]+", " ", body).strip()
        if line:
            tags = [around[start + k] for k, char in enumerate(body) if not char.isspace()]
            lines.append((line, _line_role(tags)))
        start += len(raw)
    return lines


def _line_role(tags: list[tuple[str, ...]]) -> str:
    """One line's role from the tags open around each of its characters."""
    if any(re.fullmatch(r"h[1-6]", tag) for open_tags in tags for tag in open_tags):
        return "h"
    if any("li" in open_tags for open_tags in tags):
        return "li"
    if tags and all("strong" in open_tags or "b" in open_tags for open_tags in tags):
        return "b"
    return "p"


def plain_text(markup: str | None) -> str | None:
    """Plain text from a description that may be HTML, whole: a line wherever a
    block ended."""
    return "\n".join(line for line, _ in plain_lines(markup)) or None


def _described(markup: str | None) -> tuple[str | None, tuple[str, ...]]:
    """A description's plain text and its lines' roles (`plain_lines`), for `_page`."""
    lines = plain_lines(markup)
    return "\n".join(line for line, _ in lines) or None, tuple(role for _, role in lines)


def cap(plain: str | None) -> str | None:
    """At most DESCRIPTION_CHARS, cut at a word: what is stored for Scout."""
    if plain is None or len(plain) <= DESCRIPTION_CHARS:
        return plain
    return plain[:DESCRIPTION_CHARS].rsplit(maxsplit=1)[0] + " …"


def _page(
    title: str,
    full: str | None,
    *,
    roles: tuple[str, ...] | None = None,
    stated_type: str | None = None,
    stated_style: str | None = None,
    stated_pay: details.Pay | None = None,
    offices: tuple[str, ...] = (),
    requisition: str | None = None,
) -> Page:
    """A Page from a posting's whole text: facts read from all of it first, then the
    description is its kept sections (`sections.kept`), cut after. `roles` is each
    line's role in the HTML (`plain_lines`), when the provider sent HTML."""
    facts = details.read(
        title, full, stated_type=stated_type, stated_style=stated_style, stated_pay=stated_pay
    )
    return Page(
        version=PAGE_VERSION,
        description=cap(kept(full, roles)),
        facts=facts,
        offices=offices,
        requisition=requisition,
    )


def _work_style(value: object, location: str | None) -> str | None:
    """Remote / Hybrid / On site, or None when the provider does not say.

    Ashby sends `Remote|Hybrid|OnSite`, Lever sends the same words lowercased,
    Workable `remote|hybrid|on_site`, and Greenhouse sends nothing at all -- so on
    a Greenhouse board only a location that says remote fills it in.
    Blank is the honest answer; guessing "On site" because a field is missing would
    put a fact on the page that no employer stated. A location that says remote is
    the one safe inference.
    """
    text = str(value or "").strip().lower()
    if text.startswith("remote"):
        return "Remote"
    if text.startswith("hybrid"):
        return "Hybrid"
    if re.sub(r"[-_ ]", "", text) in {"onsite", "inoffice"}:
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
        full, roles = _described(row.get("descriptionPlain") or row.get("descriptionHtml"))
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
                    full,
                    roles=roles,
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
        full, roles = _described(_lever_markup(row))
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
                    full,
                    roles=roles,
                    stated_type=details.job_type_label(categories.get("commitment")),
                    # Some boards put the work model in `commitment` ("Remote").
                    stated_style=_work_style(row.get("workplaceType"), categories.get("location"))
                    or _work_style(categories.get("commitment"), None),
                    stated_pay=_lever_pay(row),
                ),
            )
        )
    return jobs


def _lever_markup(row: dict) -> str:
    """Lever splits a posting in three: an intro (`descriptionPlain`), titled lists
    that usually hold the requirements (`lists`, HTML items), and a closing
    (`additionalPlain`). The intro alone is often just a company blurb. A list's
    title is its heading, so it is marked as one."""
    sections = [row.get("descriptionPlain") or ""]
    for block in row.get("lists") or []:
        sections.append(f"<h3>{block.get('text') or ''}</h3><ul>{block.get('content') or ''}</ul>")
    sections.append(row.get("additionalPlain") or "")
    return "<br>".join(section for section in sections if section)


def _lever_description(row: dict) -> str | None:
    """A Lever posting's whole text (`_lever_markup`)."""
    return plain_text(_lever_markup(row))


def _place(*parts: object) -> str:
    """ "Munich, Bavaria, Germany" from a provider's split fields, each part once:
    Workable writes Ely as "Ely, Ely, United Kingdom"."""
    named = (str(part).strip() for part in parts if part)
    return ", ".join(dict.fromkeys(part for part in named if part))


def _places(places: Iterable[str | None]) -> str | None:
    """Several places as one location, as Greenhouse boards write them
    ("Stamford, CT; New York, NY"); the backend's resolver splits on ";"."""
    return "; ".join(dict.fromkeys(place for place in places if place)) or None


def workable(token: str, company: str) -> list[Job]:
    # The widget lists a job once per location under one shortcode: Trexquant's
    # "C++ Trading & Simulator Engineer (USA)" is a Stamford row and a New York
    # row. One posting, so the rows are merged and their places joined.
    payload = _get_json(listing_url("workable", token))
    assert isinstance(payload, dict)
    by_code: dict[str, list[dict]] = {}
    for row in payload.get("jobs") or []:
        by_code.setdefault(str(row["shortcode"]), []).append(row)
    return [
        Job(
            ats="workable",
            token=token,
            company=company,
            external_id=shortcode,
            title=(rows[0].get("title") or "").strip(),
            apply_url=rows[0].get("url") or rows[0].get("shortlink") or "",
            location=_places(_workable_place(row) for row in rows),
            department=rows[0].get("department") or None,
            # The date the board shows. `created_at` is when the draft was
            # opened: Flexcompute's CFD developer was created 2024-05-14 and
            # published 2026-09-30.
            posted_at=_iso(rows[0].get("published_on") or rows[0].get("created_at")),
            # No page: its own page is read once (`describe_workable`).
        )
        for shortcode, rows in by_code.items()
    ]


def _workable_place(row: dict) -> str | None:
    """The row's locations the employer shows. A hidden one stays hidden: Hugging
    Face hides Paris on its "EMEA Remote" roles, where the top-level city still says
    it."""
    return _places(
        _place(place.get("city"), place.get("region"), place.get("country"))
        for place in row.get("locations") or []
        if not place.get("hidden")
    )


def describe_workable(job: Job) -> Job:
    """The same Workable posting with what only its own page says: the whole text,
    the work model (hybrid included, which the widget cannot say) and the salary."""
    payload = _get_json(job_url("workable", job.token, job.external_id))
    assert isinstance(payload, dict)
    # Three fields, shown on the posting under these headings. The headings stay,
    # since `details` reads a visa line by the heading above it.
    sections = [payload.get("description") or ""]
    for heading, field in (("Requirements", "requirements"), ("Benefits", "benefits")):
        if payload.get(field):
            sections.append(f"<h3>{heading}</h3>{payload[field]}")
    # `type` is the widget's employment type, abbreviated. On the 34 postings kept
    # 2026-10-10: "full" (14), "temporary" (12), "other" (3), "part" (2), none (3).
    # Temporary and other say nothing about hours, so the description decides.
    kind = str(payload.get("type") or "")
    full, roles = _described("".join(sections))
    return replace(
        job,
        page=_page(
            job.title,
            full,
            roles=roles,
            stated_type=details.job_type_label(
                {"full": "full_time", "part": "part_time"}.get(kind, kind)
            ),
            stated_style=_work_style(
                payload.get("workplace") or ("remote" if payload.get("remote") else None),
                job.location,
            ),
            stated_pay=details.Pay.from_interval(
                payload.get("salary_currency_iso_code"),
                payload.get("salary_from"),
                payload.get("salary_to"),
                payload.get("salary_frequency"),
            ),
        ),
    )


def recruitee(token: str, company: str) -> list[Job]:
    payload = _get_json(listing_url("recruitee", token))
    assert isinstance(payload, dict)
    jobs = []
    for row in payload.get("offers") or []:
        title = (row.get("title") or "").strip()
        full, roles = _described(
            "<br>".join(row.get(field) or "" for field in ("description", "requirements"))
        )
        jobs.append(
            Job(
                ats="recruitee",
                token=token,
                company=company,
                external_id=str(row["id"]),
                title=title,
                apply_url=row.get("careers_url") or "",
                location=_recruitee_location(row),
                department=row.get("department") or None,
                posted_at=_iso(row.get("published_at") or row.get("created_at")),
                page=_page(
                    title,
                    full,
                    roles=roles,
                    stated_type=details.job_type_label(row.get("employment_type_code")),
                    stated_style=_recruitee_work_style(row),
                    stated_pay=_recruitee_pay(row),
                ),
            )
        )
    return jobs


def _recruitee_location(row: dict) -> str | None:
    """The place names the employer typed. The split fields beside each are a
    form's defaults -- Hard Rock Digital's "United States" has the city "United
    States" in Florida -- and `location` is only "Remote job" on a remote posting."""
    named = _places(place.get("name") for place in row.get("locations") or [])
    return named or ("Remote" if row.get("remote") else row.get("location") or None)


def _recruitee_work_style(row: dict) -> str | None:
    """Three flags, and a posting can set two: 5 of Hard Rock Digital's 58 are
    remote and hybrid. One that can be done remotely is what someone filtering
    for remote work wants, so remote wins."""
    if row.get("remote"):
        return "Remote"
    if row.get("hybrid"):
        return "Hybrid"
    if row.get("on_site"):
        return "On site"
    return None


def _recruitee_pay(row: dict) -> details.Pay | None:
    # Amounts arrive as strings ("1000"), per Recruitee's API reference.
    salary = row.get("salary") or {}
    return details.Pay.from_interval(
        salary.get("currency"),
        _number(salary.get("min")),
        _number(salary.get("max")),
        salary.get("period"),
    )


def _number(value: object) -> float | None:
    try:
        return float(value) if isinstance(value, int | float | str) else None
    except ValueError:
        return None


def bamboohr(token: str, company: str) -> list[Job]:
    url = listing_url("bamboohr", token)
    try:
        payload = _get_json(url)
    except urllib.error.HTTPError as error:
        # No such company: BambooHR answers with a redirect to www.bamboohr.com,
        # which `web.get` refuses as cross-origin. That is BambooHR's 404.
        if 300 <= error.code < 400:
            raise BoardNotFound(url) from error
        raise
    assert isinstance(payload, dict)
    return [
        Job(
            ats="bamboohr",
            token=token,
            company=company,
            external_id=str(row["id"]),
            title=(row.get("jobOpeningName") or "").strip(),
            apply_url=f"https://{token}.bamboohr.com/careers/{row['id']}",
            location=_bamboohr_location(row),
            department=row.get("departmentLabel") or None,
            # No date and no page: both come from its own page (`describe_bamboohr`).
        )
        for row in payload.get("result") or []
    ]


def _bamboohr_location(row: dict) -> str | None:
    """The office ("Santa Clara, California"), or for a remote job with none, the
    area it is open to (Nexthop's "US East, United States")."""
    office = row.get("location") or {}
    area = row.get("atsLocation") or {}
    return (
        _place(office.get("city"), office.get("state"))
        or _place(area.get("city"), area.get("state") or area.get("province"), area.get("country"))
        or None
    )


#: BambooHR's `locationType`. Read off postings that say which they are: Picton
#: Mahoney's "2"s are hybrid, Alkira's "1"s remote, Nexthop's Santa Clara "0"s on site.
_BAMBOOHR_STYLE = {"0": "On site", "1": "Remote", "2": "Hybrid"}


def describe_bamboohr(job: Job) -> Job:
    """The same BambooHR posting with what only its own page says: the
    description, the date it went up, the work model and the pay."""
    payload = _get_json(job_url("bamboohr", job.token, job.external_id))
    assert isinstance(payload, dict)
    opening = (payload.get("result") or {}).get("jobOpening") or {}
    compensation = str(opening.get("compensation") or "")
    full, roles = _described(opening.get("description"))
    return replace(
        job,
        posted_at=_iso(opening.get("datePosted")) or job.posted_at,
        page=_page(
            job.title,
            full,
            roles=roles,
            stated_type=details.job_type_label(opening.get("employmentStatusLabel")),
            stated_style=_BAMBOOHR_STYLE.get(str(opening.get("locationType"))),
            # Free text in a field that is only ever pay ("$90,000 to $115,000",
            # "$25-$30/hour"), so it gets the label prose would need to give it.
            stated_pay=details.pay(f"Compensation: {compensation}") if compensation else None,
        ),
    )


#: Postings per request: Workday answers a larger `limit` with a 400.
WORKDAY_PAGE = 20
#: The most a Workday list will report. A board answering exactly this is capped:
#: NVIDIA reports 2,000 and has 2,676, and an offset past 2,000 returns its first
#: page again. A board that reports more (Northrop Grumman: 3,740) pages past it.
WORKDAY_CAP = 2000
#: The largest Workday board read: 250 requests, about 2 minutes of one worker.
#: The ~20 boards past it on 2026-10-10 are retail and hospital chains (Dollar
#: Tree 25,026, CVS 18,575, Lowe's 12,701) plus Accenture (42,179) and Walmart.
WORKDAY_MAX = 5000


def workday(
    token: str, company: str, *, pace: Callable[[str], None] = lambda url: None
) -> list[Job]:
    """Every posting on a Workday board, read whole or not at all.

    The list comes 20 postings a request, and `pace` is called before each one but
    the first, which the caller paces like any board's one request. A read that
    does not add up to the count Workday gave raises `Incomplete`, and a board past
    WORKDAY_MAX raises `TooLarge`: only a whole read may count as evidence that a
    posting has gone (scraper/CLAUDE.md, "Nothing closes").

    A board reporting exactly WORKDAY_CAP is read in slices by one of its own
    filters (`_workday_slices`), or raises `TooLarge` when none splits it.
    """
    url = listing_url("workday", token)
    try:
        first = _workday_page(url, {}, 0)
    except urllib.error.HTTPError as error:
        # A tenant that does not exist, or the right tenant on the wrong data
        # centre, is a 422 rather than a 404.
        if error.code == 422:
            raise BoardNotFound(url) from error
        raise
    size = int(first.get("total") or 0)
    slices: list[dict] | None = [{}]
    if size == WORKDAY_CAP:
        size, slices = _workday_slices(first)
    if size > WORKDAY_MAX:
        raise TooLarge(f"{size:,} postings")
    if slices is None:
        raise TooLarge(f"capped at {WORKDAY_CAP:,} postings, and no filter splits it")

    rows: dict[str, dict] = {}
    for facets in slices:
        offset, expected = 0, None
        while expected is None or offset < expected:
            if facets or offset:
                pace(url)
                page = _workday_page(url, facets, offset)
            else:
                page = first
            # Only the first page of a search carries the count; later pages say 0.
            expected = int(page.get("total") or 0) if expected is None else expected
            postings = page.get("jobPostings") or []
            for row in postings:
                # AT&T's list has a row with only a requisition number: counted
                # in the total and linked nowhere, so counted here and never a Job.
                rows.setdefault(row.get("externalPath") or json.dumps(row, sort_keys=True), row)
            if not postings:
                break
            offset += WORKDAY_PAGE
    if len(rows) != size:
        raise Incomplete(f"read {len(rows):,} distinct postings of {size:,}")

    host = "https://{tenant}.{wd}.myworkdayjobs.com/{site}".format(**_parts("workday", token))
    today = datetime.now(UTC).date()
    return [
        Job(
            ats="workday",
            token=token,
            company=company,
            # The posting's path, which its own record is read by.
            external_id=row["externalPath"],
            title=(row.get("title") or "").strip(),
            apply_url=f"{host}{row['externalPath']}",
            location=_workday_location(row.get("locationsText")),
            # Only a relative date ("Posted 3 Days Ago"); the posting's own
            # record has the exact one (`describe_workday`).
            posted_at=_workday_posted(row.get("postedOn"), today),
        )
        for row in rows.values()
        if row.get("externalPath")
    ]


def _workday_page(url: str, facets: dict, offset: int) -> dict:
    payload = _post_json(
        url, {"appliedFacets": facets, "limit": WORKDAY_PAGE, "offset": offset, "searchText": ""}
    )
    assert isinstance(payload, dict)
    return payload


def _workday_slices(first: dict) -> tuple[int, list[dict] | None]:
    """A capped board's real size, and one filter value per slice to read it by.

    The list's filters (job family, job type, time type, ...) come with a count per
    value. A filter whose counts add up to the board's size puts every posting in
    exactly one slice; the size is the sum that two filters agree on, since one
    filter alone could leave postings out (NVIDIA: 2,676 by job family, job type
    and time type alike). A slice is only readable below the cap, so a filter with
    any value at 2,000 or more is no use. `workday` then checks that the slices
    really held that many distinct postings. None when no filter fits: 17 of the
    39 capped boards on 2026-10-10 (Citi, Walmart, Target, Airbus).
    """
    filters = {
        facet.get("facetParameter"): values
        for facet in first.get("facets") or []
        if (values := facet.get("values"))
        and all(isinstance(v.get("count"), int) and v.get("id") for v in values)
    }
    sums = Counter(sum(v["count"] for v in values) for values in filters.values())
    agreed = [total for total, n in sums.items() if n >= 2 and total >= WORKDAY_CAP]
    if not agreed:
        return WORKDAY_CAP, None
    size = max(agreed)
    for name, values in filters.items():
        if sum(v["count"] for v in values) == size and all(
            v["count"] < WORKDAY_CAP for v in values
        ):
            return size, [{name: [v["id"]]} for v in values]
    return size, None


def _workday_location(text: str | None) -> str | None:
    """The list's place, or None for "3 Locations": the posting's own record names
    them (`describe_workday`)."""
    text = (text or "").strip()
    return None if not text or re.fullmatch(r"\d+ Locations", text) else text


def _workday_posted(text: str | None, today: date) -> str | None:
    """A date from "Posted Today", "Posted Yesterday" or "Posted 3 Days Ago",
    counted back from today in UTC (so a day either side of the employer's own).
    "Posted 30+ Days Ago" says only that it is older, so it gives no date."""
    match = re.fullmatch(r"Posted (?:(Today)|(Yesterday)|(\d+) Days? Ago)", (text or "").strip())
    if not match:
        return None
    days = 0 if match[1] else 1 if match[2] else int(match[3])
    return _iso((today - timedelta(days=days)).isoformat())


def _workday_work_style(value: object) -> str | None:
    """Workday's `remoteType` is the employer's own wording, ~80 kinds of it across
    the first sweep: "Hybrid", "On-Site", "Partially Remote", "Office Worker (NOT
    Remote)", "Remote work is not available". A refusal of remote work is on site;
    any mention of hybrid (or "Flex") is hybrid, so "Hybrid or 100% Remote" is too;
    then remote; then the on-site words. Others ("Field", "As Needed") say nothing.
    """
    text = re.sub(r"^(?:remote type\s*-\s*|#li-)", "", str(value or "").strip().lower())
    if re.search(r"not remote|remote work is not|not eligible|non[- ]flex", text):
        return "On site"
    if re.search(r"hybrid|partially remote|\bflex\b|office or home", text):
        return "Hybrid"
    if re.search(r"remote|work from home", text):
        return "Remote"
    if re.search(r"on[- ]?site|in[- ]?office|in[- ]?person|on campus|^office\b", text):
        return "On site"
    return None


def describe_workday(job: Job) -> Job:
    """The same Workday posting with what only its own record says: the
    description, its places, the date it went up, the time type, work model and
    requisition number.

    `startDate` is the day the posting went up, not when the job starts: it is
    exactly the list's "Posted 3 Days Ago" on every posting compared (2026-10-10).

    `jobReqId` is the requisition, the job itself: posted on two careers sites, it
    is one requisition with two paths (Autodesk's "..._26WD100002-1" on `ext` and
    "..._26WD100002-3" on `uni`). Only the record states it whole. The path ends in
    a slug of it plus a posting number, which no rule can split from an id that
    ends in digits itself (Amgen's "R-257526"), and the list's `bulletFields`
    show whatever each employer chose to show there.
    """
    payload = _get_json(job_url("workday", job.token, job.external_id))
    assert isinstance(payload, dict)
    info = payload.get("jobPostingInfo") or {}
    # All its places as one location, as Workable's are: the card would say only
    # "3 locations" of three offices, and the backend's resolver splits on ";".
    places = _places(
        str(place).strip()
        for place in [info.get("location"), *(info.get("additionalLocations") or [])]
        if place
    )
    full, roles = _described(info.get("jobDescription"))
    return replace(
        job,
        posted_at=_iso(info.get("startDate")) or job.posted_at,
        page=_page(
            job.title,
            full,
            roles=roles,
            stated_type=details.job_type_label(info.get("timeType")),
            stated_style=_workday_work_style(info.get("remoteType"))
            or _work_style(None, job.location),
            offices=(places,) if places else (),
            requisition=str(info.get("jobReqId") or "").strip() or None,
        ),
    )


def describe_greenhouse(job: Job) -> Job:
    """The same Greenhouse posting with what only its own page says: the
    description, the offices, pay ranges and any employment-type field."""
    payload = _get_json(job_url("greenhouse", job.token, job.external_id))
    assert isinstance(payload, dict)
    full, roles = _described(payload.get("content"))
    return replace(
        job,
        page=_page(
            job.title,
            full,
            roles=roles,
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


#: Requisitions per Oracle request: a larger `limit` is answered with 200 anyway.
ORACLE_PAGE = 200
#: The deepest Oracle's search pages: past an offset of 10,000 it serves nothing
#: (egud.fa.us2/CX_1 counts 10,757, ejwl.fa.us2/CX 13,426; 2026-10-26).
ORACLE_MAX = 10_000


def oracle(
    token: str, company: str, *, pace: Callable[[str], None] = lambda url: None
) -> list[Job]:
    """Every requisition on an Oracle Recruiting Cloud careers site, read whole or
    not at all, 200 a request (Oracle's own page sends 25). The search reports
    `hasMore: false` even mid-board, so the count it gives decides when to stop.
    A site number the pod does not have is a search with a count of 0, so it reads
    as an empty board; a pod that does not exist is a 404.

    The count can run a few over what the search serves (ebwg.fa.us2/CX: 115
    counted, 113 served on one page of 200, nothing after). So a read is whole
    when its pages never overlapped and either it reached the count or its last
    page came back short: the search had nothing more to give."""
    parts = _parts("oracle", token)
    rows: dict[str, dict] = {}
    served, expected, offset, short = 0, None, 0, False
    while expected is None or offset < expected:
        url = LISTING_URL["oracle"].format(**{**parts, "offset": str(offset)})
        if offset:
            pace(url)
        payload = _get_json(url)
        assert isinstance(payload, dict)
        search = (payload.get("items") or [{}])[0]
        expected = int(search.get("TotalJobsCount") or 0) if expected is None else expected
        if expected > ORACLE_MAX:
            raise TooLarge(f"{expected:,} requisitions")
        page = search.get("requisitionList") or []
        served += len(page)
        for row in page:
            rows.setdefault(str(row["Id"]), row)
        if len(page) < ORACLE_PAGE:
            short = True
            break
        offset += ORACLE_PAGE
    if len(rows) != expected and (served != len(rows) or len(rows) > expected or not short):
        raise Incomplete(f"read {len(rows):,} distinct requisitions of {expected:,}")
    site = "https://{pod}.oraclecloud.com/hcmUI/CandidateExperience/en/sites/{site}".format(**parts)
    return [
        Job(
            ats="oracle",
            token=token,
            company=company,
            external_id=job_id,
            title=(row.get("Title") or "").strip(),
            apply_url=f"{site}/job/{job_id}",
            location=_oracle_places(row),
            department=row.get("JobFamily") or None,
            posted_at=_iso(row.get("PostedDate")),
            # No page: the list has only a summary (`describe_oracle`).
        )
        for job_id, row in rows.items()
    ]


def _oracle_places(row: dict) -> str | None:
    return _places(
        [row.get("PrimaryLocation"), *(p.get("Name") for p in row.get("secondaryLocations") or [])]
    )


def describe_oracle(job: Job) -> Job:
    """The same Oracle requisition with what only its record says: the
    description (in up to three parts), the exact time it went up, the schedule
    and the work model."""
    payload = _get_json(job_url("oracle", job.token, job.external_id))
    assert isinstance(payload, dict)
    record = (payload.get("items") or [{}])[0]
    full, roles = _described(
        "<br>".join(
            record.get(part) or ""
            for part in (
                "ExternalDescriptionStr",
                "ExternalResponsibilitiesStr",
                "ExternalQualificationsStr",
            )
        )
    )
    return replace(
        job,
        posted_at=_iso(record.get("ExternalPostedStartDate")) or job.posted_at,
        page=_page(
            job.title,
            full,
            roles=roles,
            stated_type=details.job_type_label(record.get("JobSchedule")),
            stated_style=_work_style(record.get("WorkplaceType"), job.location),
        ),
    )


#: Postings per TikTok request; it takes 200 (lifeattiktok.com itself asks for 12).
TIKTOK_PAGE = 200


def tiktok(
    token: str, company: str, *, pace: Callable[[str], None] = lambda url: None
) -> list[Job]:
    """Every posting TikTok lists on lifeattiktok.com (about 4,300), with its
    description and requirements, read whole or not at all. The search answers
    "invalid request" without a `website-path` header naming the site. ByteDance's
    own site (jobs.bytedance.com) is a separate list, and did not answer at all
    when this was written."""
    url = listing_url("tiktok", token)
    rows: dict[str, dict] = {}
    expected, offset = None, 0
    while expected is None or offset < expected:
        if offset:
            pace(url)
        payload = _post_json(
            url,
            {
                "keyword": "",
                "limit": TIKTOK_PAGE,
                "offset": offset,
                "recruitment_id_list": [],
                "job_category_id_list": [],
                "subject_id_list": [],
                "location_code_list": [],
            },
            headers={"website-path": "tiktok"},
        )
        assert isinstance(payload, dict)
        if payload.get("code") != 0:
            raise RuntimeError(f"TikTok's search said {payload.get('message')!r}")
        data = payload.get("data") or {}
        expected = int(data.get("count") or 0) if expected is None else expected
        page = data.get("job_post_list") or []
        for row in page:
            rows.setdefault(str(row["id"]), row)
        if not page:
            break
        offset += TIKTOK_PAGE
    if len(rows) != expected:
        raise Incomplete(f"read {len(rows):,} distinct postings of {expected:,}")
    jobs = []
    for job_id, row in rows.items():
        title = (row.get("title") or "").strip()
        full, roles = _described(
            "\n\n".join(row.get(part) or "" for part in ("description", "requirement"))
        )
        jobs.append(
            Job(
                ats="tiktok",
                token=token,
                company=company,
                external_id=job_id,
                title=title,
                apply_url=f"https://lifeattiktok.com/search/{job_id}",
                location=_tiktok_place(row.get("city_info")),
                department=_tiktok_root(row.get("job_category")),
                # The search gives no date.
                page=_page(title, full, roles=roles),
            )
        )
    return jobs


def _tiktok_place(city: dict | None) -> str | None:
    """ "San Jose, California, United States of America" from a city and its parents."""
    names = []
    while city:
        names.append(city.get("en_name"))
        city = city.get("parent")
    return _place(*names) or None


def _tiktok_root(category: dict | None) -> str | None:
    """A category's top level ("R&D" over "Backend"): the closest TikTok has to a
    department."""
    while category and category.get("parent"):
        category = category["parent"]
    return (category or {}).get("en_name") or None


#: Postings per Jibe request (its own page asks for 10).
JIBE_PAGE = 100


def icims(token: str, company: str, *, pace: Callable[[str], None] = lambda url: None) -> list[Job]:
    """Every iCIMS posting on a company's Jibe careers site, read whole or not at
    all, with its description. Jibe can front other systems too, so only rows it
    says are on iCIMS (`ats_code`) are kept. Jibe sites publish a Crawl-delay of
    5 s, which `pace` keeps between pages.

    A site can list one posting twice (MasTec: 1,258 rows, 1,211 postings, all
    pages read; 2026-10-26), so the rows served, not the distinct postings, must
    add up to the count; the twice-listed posting is kept once."""
    rows: dict[str, dict] = {}
    served, expected, number = 0, None, 1
    while expected is None or (number - 1) * JIBE_PAGE < expected:
        url = f"https://{token}/api/jobs?page={number}&limit={JIBE_PAGE}"
        if number > 1:
            pace(url)
        payload = _get_json(url)
        assert isinstance(payload, dict)
        expected = int(payload.get("totalCount") or 0) if expected is None else expected
        page = [row.get("data") or {} for row in payload.get("jobs") or []]
        served += len(page)
        for row in page:
            rows.setdefault(str(row.get("slug") or row.get("req_id")), row)
        if not page:
            break
        number += 1
    if served != expected:
        raise Incomplete(f"read {served:,} postings of {expected:,}")
    jobs = []
    for slug, row in rows.items():
        if row.get("ats_code") != "icims":
            continue
        title = (row.get("title") or "").strip()
        full, roles = _described(
            "<br>".join(
                row.get(part) or ""
                for part in ("description", "responsibilities", "qualifications")
            )
        )
        jobs.append(
            Job(
                ats="icims",
                token=token,
                company=company,
                external_id=slug,
                title=title,
                # The posting on the company's site, as the curated lists link it;
                # its Apply goes on to the tenant's icims.com form.
                apply_url=f"https://{token}/jobs/{slug}?icims=1",
                location=_place(row.get("city"), row.get("state"), row.get("country"))
                or row.get("full_location")
                or None,
                posted_at=_iso(row.get("posted_date")),
                page=_page(
                    title,
                    full,
                    roles=roles,
                    stated_type=details.job_type_label(row.get("employment_type")),
                ),
            )
        )
    return jobs


def successfactors(
    token: str, company: str, *, pace: Callable[[str], None] = lambda url: None
) -> list[Job]:
    """Every posting on a SuccessFactors career site, read whole or not at all,
    from its search page: a table of title, place and date, as many rows a page
    as the site chose (Grainger 35). No description: the posting's own page has
    it (`describe_successfactors`)."""
    rows: dict[str, tuple[str, str, str, str]] = {}
    served, expected, ended = 0, None, False
    while expected is None or len(rows) < expected:
        url = listing_url("successfactors", token).replace("startrow=0", f"startrow={len(rows)}")
        if rows:
            pace(url)
        text = _get_text(url)
        total = re.search(r"paginationLabel[^>]*>.*?of\s*<b>([\d,]+)</b>", text, re.S)
        expected = int(total[1].replace(",", "")) if total else 0 if expected is None else expected
        page = _successfactors_rows(text)
        served += len(page)
        for row in page:
            rows.setdefault(row[0], row)
        if not page:
            # Past the last posting. As on Oracle, the count can run over what the
            # site serves. Every posting seen is whole even if pages overlapped:
            # postings with one title can still swap places between pages
            # (Sonepar: 938 of 938 read, some twice).
            ended = True
            break
    if len(rows) != expected and (served != len(rows) or len(rows) > expected or not ended):
        raise Incomplete(f"read {len(rows):,} distinct postings of {expected:,}")
    return [
        Job(
            ats="successfactors",
            token=token,
            company=company,
            # The posting's path, which its own page is read by.
            external_id=path,
            title=title,
            apply_url=f"https://{token}{path}",
            location=place or None,
            posted_at=_successfactors_date(day, "%b %d, %Y"),
        )
        for path, title, place, day in rows.values()
    ]


def _successfactors_rows(text: str) -> list[tuple[str, str, str, str]]:
    """(path, title, place, date) per row of a search page's results table."""
    found = []
    for row in re.findall(r'<tr class="data-row">(.*?)</tr>', text, re.S):
        link = re.search(r'<a href="([^"]+)" class="jobTitle-link">(.*?)</a>', row, re.S)
        place = re.search(r'<span class="jobLocation">(.*?)</span>', row, re.S)
        day = re.search(r'<span class="jobDate">(.*?)</span>', row, re.S)
        if link:
            found.append(
                (
                    html.unescape(link[1]),
                    html.unescape(link[2]).strip(),
                    " ".join(html.unescape(place[1]).split()) if place else "",
                    " ".join(day[1].split()) if day else "",
                )
            )
    return found


def _successfactors_date(text: str | None, layout: str) -> str | None:
    try:
        return _iso(datetime.strptime((text or "").strip(), layout).date().isoformat())
    except ValueError:
        return None


def describe_successfactors(job: Job) -> Job:
    """The same SuccessFactors posting with its description and the exact time it
    went up ("Tue Oct 13 07:00:00 UTC 2026"), from its own page."""
    text = _get_text(job_url("successfactors", job.token, job.external_id))
    posted = re.search(r'<meta itemprop="datePosted" content="([^"]+)"', text)
    try:
        stamp = posted and datetime.strptime(posted[1], "%a %b %d %H:%M:%S UTC %Y")
    except ValueError:
        stamp = None
    full, roles = _described(_element(text, '<span itemprop="description"'))
    return replace(
        job,
        posted_at=_iso(stamp.replace(tzinfo=UTC).isoformat()) if stamp else job.posted_at,
        page=_page(job.title, full, roles=roles),
    )


def _element(text: str, opening: str) -> str | None:
    """The element starting at `opening`, up to its own closing tag."""
    start = text.find(opening)
    if start < 0:
        return None
    tag = re.match(r"<(\w+)", opening)[1]
    depth = 0
    for match in re.finditer(rf"<(/?){tag}\b[^>]*>", text[start:]):
        depth += -1 if match[1] else 1
        if depth == 0:
            return text[start : start + match.end()]
    return text[start:]


FETCHERS: dict[str, Callable[[str, str], list[Job]]] = {
    "greenhouse": greenhouse,
    "ashby": ashby,
    "lever": lever,
    "workable": workable,
    "recruitee": recruitee,
    "bamboohr": bamboohr,
    "workday": workday,
    "oracle": oracle,
    "tiktok": tiktok,
    "icims": icims,
    "successfactors": successfactors,
}

#: Providers whose reader makes more than one request per board, and so takes the
#: run's `pace` to space them (`__main__._scrape_one`).
PAGED = frozenset({"workday", "oracle", "tiktok", "icims", "successfactors"})


def describe(job: Job) -> Job:
    """`job` with its own page read; only for a provider in `JOB_URL`."""
    # Looked up per call rather than kept in a table, so a test can swap one.
    return {
        "greenhouse": describe_greenhouse,
        "workable": describe_workable,
        "bamboohr": describe_bamboohr,
        "workday": describe_workday,
        "oracle": describe_oracle,
        "successfactors": describe_successfactors,
    }[job.ats](job)
