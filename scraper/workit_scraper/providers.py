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

import json
import time
import urllib.error
import urllib.request
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import UTC, datetime

USER_AGENT = "workit-scraper/0.1 (CSE416 course project; +https://github.com/WorkIt-CSE-416)"
TIMEOUT_S = 25


class BoardNotFound(Exception):
    """The board does not exist (HTTP 404), as opposed to existing and being empty."""


# One place both the fetchers and the robots.txt check read the URL from, so a board
# can never be checked at one address and then fetched at another.
LISTING_URL = {
    "greenhouse": "https://boards-api.greenhouse.io/v1/boards/{token}/jobs",
    "ashby": "https://api.ashbyhq.com/posting-api/job-board/{token}",
    "lever": "https://api.lever.co/v0/postings/{token}?mode=json",
}


def listing_url(ats: str, token: str) -> str:
    return LISTING_URL[ats].format(token=token)


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
    first_seen_at: str = ""
    last_seen_at: str = ""
    tags: tuple[str, ...] = field(default=())

    @property
    def key(self) -> str:
        return f"{self.ats}/{self.token}#{self.external_id}"


def _get_json(url: str) -> object:
    """GET and parse JSON, with one retry on a 5xx or an explicit Retry-After.

    A 404 becomes `BoardNotFound`; every other failure propagates, because a board
    we could not read is not a board we know anything about.
    """
    for attempt in (1, 2):
        try:
            request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
            with urllib.request.urlopen(request, timeout=TIMEOUT_S) as response:
                return json.loads(response.read())
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


def greenhouse(token: str, company: str) -> list[Job]:
    payload = _get_json(listing_url("greenhouse", token))
    assert isinstance(payload, dict)
    return [
        Job(
            ats="greenhouse",
            token=token,
            company=row.get("company_name") or company,
            external_id=str(row["id"]),
            title=(row.get("title") or "").strip(),
            apply_url=row.get("absolute_url") or "",
            location=(row.get("location") or {}).get("name"),
            posted_at=_iso(row.get("first_published") or row.get("updated_at")),
        )
        for row in payload.get("jobs") or []
    ]


def ashby(token: str, company: str) -> list[Job]:
    payload = _get_json(listing_url("ashby", token))
    assert isinstance(payload, dict)
    return [
        Job(
            ats="ashby",
            token=token,
            company=company,
            external_id=str(row["id"]),
            title=(row.get("title") or "").strip(),
            apply_url=row.get("applyUrl") or row.get("jobUrl") or "",
            location=row.get("location"),
            department=row.get("department"),
            posted_at=_iso(row.get("publishedAt")),
        )
        for row in payload.get("jobs") or []
        # Ashby is the only one that tells us a posting is unlisted. Believe it.
        if row.get("isListed", True)
    ]


def lever(token: str, company: str) -> list[Job]:
    # The odd one out: a bare JSON array, `text` for the title, and `createdAt` as
    # epoch milliseconds in a string.
    payload = _get_json(listing_url("lever", token))
    assert isinstance(payload, list)
    jobs = []
    for row in payload:
        categories = row.get("categories") or {}
        jobs.append(
            Job(
                ats="lever",
                token=token,
                company=company,
                external_id=str(row["id"]),
                title=(row.get("text") or "").strip(),
                apply_url=row.get("hostedUrl") or row.get("applyUrl") or "",
                location=categories.get("location"),
                department=categories.get("team"),
                posted_at=_iso(row.get("createdAt")),
            )
        )
    return jobs


FETCHERS: dict[str, Callable[[str, str], list[Job]]] = {
    "greenhouse": greenhouse,
    "ashby": ashby,
    "lever": lever,
}
