"""Reading workday company job boards: its reader, its page reader and its record."""

from __future__ import annotations

import json
import re
import urllib.error
import urllib.parse
from collections import Counter
from collections.abc import Callable
from dataclasses import replace
from datetime import UTC, date, datetime, timedelta

from workit_scraper import details
from workit_scraper.providers import fetch
from workit_scraper.providers.fetch import _iso
from workit_scraper.providers.model import BoardNotFound, Incomplete, Job, Provider, TooLarge
from workit_scraper.providers.registry import _parts, job_url, listing_url
from workit_scraper.providers.text import (
    _described,
    _page,
    _places,
    _work_style,
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
                try:
                    page = _workday_page(url, facets, offset)
                except BoardNotFound as error:
                    raise Incomplete(f"no page at offset {offset:,}") from error
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
    payload = fetch._post_json(
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
    payload = fetch._get_json(job_url("workday", job.token, job.external_id))
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


PROVIDER = Provider(
    # What a Workday careers page itself calls: a POST of a search, answered 20
    # postings at a time. Not a documented public API (an accepted risk, like
    # Workable's per-posting page). `token` is "{tenant}.{wd}/{site}".
    listing_url="https://{tenant}.{wd}.myworkdayjobs.com/wday/cxs/{tenant}/{site}/jobs",
    read=workday,
    # {tenant}.wd{N}.myworkdayjobs.com/{locale}/{site}/job/..., whose token is
    # "{tenant}.wd{N}/{site}": all three are needed to reach the board. The
    # locale ("en-US") is optional, and a site can be two letters itself
    # (Boeing's "DA"), so a locale is only skipped when a site follows it.
    # build_boards.WORKDAY_SITE reads Workday's other address.
    apply_link=re.compile(
        r"//([a-z0-9-]+\.wd\d+)\.myworkdayjobs\.com/(?:[a-z]{2}(?:-[a-z]{2})?/)?"
        r"(?!(?:job|details|wday)/)([a-z0-9_-]+)",
        re.I,
    ),
    # Workday's list has the title, the place and a relative date; the
    # description, the exact date and the job type are on the posting's own
    # record. `job_id` is the posting's path ("/job/China-Shanghai/..._JR2024692").
    job_url="https://{tenant}.{wd}.myworkdayjobs.com/wday/cxs/{tenant}/{site}{job_id}",
    describe=describe_workday,
    paged=True,
    page_date=True,
    # A Workday tenant's robots.txt names its careers sites, not the API path
    # under them: Caterpillar's disallows `/CaterpillarCareers/`, and reading that
    # site's postings through the API would be reading what the employer asked
    # crawlers to leave alone.
    careers_site="https://{tenant}.{wd}.myworkdayjobs.com/{site}/",
    # One pace across all its data centres (`nvidia.wd5.myworkdayjobs.com`), the
    # cautious reading: ten requests a second to Workday as a whole.
    subdomains="myworkdayjobs.com",
    # It serves `/NVIDIAExternalCareerSite/` and `/nvidiaexternalcareersite/`
    # alike, and build_boards.py lower-cases every slug, so a rule written
    # `Disallow: /CaterpillarCareers/` must still stop `/caterpillarcareers/`.
    case_blind=True,
    # It pages 20 postings a request, and its ~1,470 readable boards hold
    # ~430,000 postings, ~22,000 requests, close to an hour at its pace. So each
    # run reads boards whole, least recently read first, until this runs out
    # (~440 boards on 2026-10-10); the rest wait for a later run, which proves
    # nothing about them either way. A board started in time is finished. 12
    # minutes keeps a run near 15 of its 30.
    budget_s=12 * 60,
    # The careers site's settings, as JSON: what its header draws from. Its logo
    # (`/{site}/assets/logo`) is the site's banner, not a square -- NVIDIA's is
    # 1200x627 -- so only the website it names is read (no `logo_pattern`).
    logo_page="https://{tenant}.{wd}.myworkdayjobs.com/wday/cxs/{tenant}/{site}/approot",
)
