"""Prove which ATS boards sit behind short links and company careers pages.

Extracted from build_boards.py so both the legacy builder and daily discovery
can resolve the same kinds of unmatched URLs. Each board is proved before it
is kept, never guessed: a board under the wrong name would put another
company's name on real cards.
"""

from __future__ import annotations

import re
import time
import urllib.error
from collections.abc import Callable
from dataclasses import dataclass, field
from urllib.parse import urlsplit

from workit_scraper import web
from workit_scraper.polite import Robots
from workit_scraper.providers import PROVIDERS, listing_url
from workit_scraper.providers.urls import board_keys

#: The link shortener the vanshb03 list wraps every apply link in (2026-10-27).
SHORTENER = re.compile(r"//go\.vansh\.nyc/", re.I)
#: A Greenhouse posting on a company's own careers site, by its number.
GH_JID = re.compile(r"[?&]gh_jid=(\d+)", re.I)
#: An iCIMS posting on a company's own careers site.
ICIMS_HERE = re.compile(r"icims", re.I)

#: Names a careers page may give its Greenhouse board by.
GH_NAMED = (
    re.compile(
        r"greenhouse\.io/embed/job_(?:board|app)(?:/js)?\?[^\"'<>\s]*?\bfor=([a-z0-9_-]+)", re.I
    ),
    re.compile(r"boards-api\.greenhouse\.io/v1/boards/([a-z0-9_-]+)", re.I),
    re.compile(r"//(?:job-)?boards(?:\.eu)?\.greenhouse\.io/(?!embed\b)([a-z0-9_-]+)", re.I),
)
#: A posting's number in a company careers site's path.
JOB_NUMBER = re.compile(r"/jobs/(\d+)")
#: Tries per company and host.
TRIES = 3


@dataclass(frozen=True)
class ResolveLink:
    url: str
    company: str
    source: str = ""
    active: bool = True


@dataclass(frozen=True)
class ResolvedLink:
    link: ResolveLink
    ats: str
    token: str
    url: str


@dataclass
class Resolution:
    hits: list[ResolvedLink] = field(default_factory=list)
    attempted: int = 0
    total: int = 0
    deferred: int = 0
    timed_out: bool = False
    next_offset: int = 0


class _DeadlineReached(BaseException):
    """Escape the low-level readers' per-link Exception handlers."""


class _TimedRobots:
    def __init__(self, robots: Robots, check: Callable[[], None]) -> None:
        self.robots, self.check = robots, check

    def allows(self, url: str) -> bool:
        self.check()
        return self.robots.allows(url)

    def pace(self, url: str) -> None:
        self.check()
        self.robots.pace(url)


def _kind(url: str) -> str | None:
    if GH_JID.search(url):
        return "greenhouse"
    if ICIMS_HERE.search(url):
        return "icims"
    return None


def resolve_links(
    links: list[ResolveLink],
    robots: Robots,
    get: Callable[[str], bytes],
    *,
    limit: int | None = None,
    offset: int = 0,
    seconds: float | None = None,
) -> Resolution:
    """Resolve a rotating, bounded window of company/host/ATS groups.

    A careers group stops at its first proved board, trying at most TRIES
    distinct URLs, active postings first. All claims about the successful URL
    are retained, even from groups outside the budget, so a company-name
    conflict cannot disappear just because one claim was deferred.
    Short links are separate groups: the same company can link
    to different boards, and their destination hosts are not known yet.

    The time budget stops new robots, pacing and HTTP operations; an operation
    already in flight may finish after the deadline. Completed hits survive.
    """
    if (limit is not None and limit < 0) or offset < 0 or (seconds is not None and seconds < 0):
        raise ValueError("resolution limits, offset and seconds must be nonnegative")
    deadline = None if seconds is None else time.monotonic() + seconds

    def check() -> None:
        if deadline is not None and time.monotonic() >= deadline:
            raise _DeadlineReached

    def read(url: str) -> bytes:
        check()
        return get(url)

    paced = _TimedRobots(robots, check)
    groups: dict[tuple[str, str, str], list[ResolveLink]] = {}
    claims: dict[str, list[ResolveLink]] = {}
    for link in links:
        if board_keys(link.url):
            continue
        if SHORTENER.search(link.url):
            key = ("short", link.url, "")
        elif kind := _kind(link.url):
            try:
                host = urlsplit(link.url).hostname
            except ValueError:
                continue
            if not host:
                continue
            key = (kind, host, link.company)
        else:
            continue
        groups.setdefault(key, []).append(link)
        claims.setdefault(link.url, []).append(link)
    ordered = sorted(groups)
    result = Resolution(total=len(ordered))
    if not ordered:
        return result
    offset %= len(ordered)
    ordered = ordered[offset:] + ordered[:offset]
    proved: set[str] = set()

    def record(url: str, target: str, keys: list[tuple[str, str]]) -> None:
        result.hits.extend(
            ResolvedLink(link, ats, token, target)
            for link in dict.fromkeys(claims[url])
            for ats, token in keys
        )
        proved.add(url)

    completed = 0
    for key in ordered[:limit]:
        try:
            check()
            result.attempted += 1
            group = groups[key]
            urls = list(
                dict.fromkeys(link.url for link in sorted(group, key=lambda x: not x.active))
            )
            for url in urls[:TRIES]:
                if url in proved:
                    break
                check()
                target = unshortened(url, paced, read) if key[0] == "short" else url
                if not target:
                    continue
                keys = board_keys(target)
                if keys:
                    record(url, target, keys)
                    break
                kind = _kind(target)
                if kind is None:
                    continue
                reader = greenhouse_board if kind == "greenhouse" else icims_board
                # Names supply guesses, not ownership proof. Once this exact URL
                # identifies a board, retain every attribution for conflict checks.
                companies = dict.fromkeys(link.company for link in group if link.url == url)
                found = False
                for company in companies:
                    token = reader(target, company, paced, read)
                    if token:
                        canonical = (
                            f"https://job-boards.greenhouse.io/{token}"
                            if kind == "greenhouse"
                            else f"https://{token}.icims.com/jobs/1/job"
                        )
                        record(url, canonical, [(kind, token)])
                        found = True
                        break
                if found:
                    break
            completed += 1
        except _DeadlineReached:
            result.timed_out = True
            break
        except Exception:
            # An invalid URL or failed robots read cannot discard other groups.
            completed += 1
    result.deferred = result.total - completed
    # Move past an interrupted group too; retry it next pass rather than letting
    # one slow group prevent all later groups from ever being attempted.
    result.next_offset = (offset + result.attempted) % result.total
    return result


def _get(url: str) -> bytes:
    return web.get(url, timeout=30)


def _read(url: str, robots: Robots, get: Callable[[str], bytes]) -> bytes | None:
    """The body; b"" for a 404, which answers "no"; None when we may not ask or the
    answer says nothing (robots.txt, a refused redirect, a failure)."""
    if not robots.allows(url):
        return None
    robots.pace(url)
    try:
        return get(url)
    except urllib.error.HTTPError as error:
        return b"" if error.code == 404 else None
    except Exception:  # noqa: BLE001 - one link must not end the run
        return None


def _guesses(company: str, url: str) -> list[str]:
    """Board names a company is likely to use: its name run together, and its
    careers site's own name (careers.withwaymo.com: "withwaymo")."""
    labels = (urlsplit(url).hostname or "").split(".")
    site = labels[-2] if len(labels) >= 2 else ""
    return list(dict.fromkeys(g for g in (re.sub(r"[^a-z0-9]", "", company.lower()), site) if g))


def unshortened(url: str, robots: Robots, get: Callable[[str], bytes]) -> str | None:
    """Where a short link leads: ``web.get`` refuses the redirect to another site and
    names where it went, which is all this needs."""
    if not robots.allows(url):
        return None
    robots.pace(url)
    try:
        get(url)
    except urllib.error.HTTPError as error:
        if 300 <= error.code < 400 and error.filename and error.filename != url:
            return error.filename
    except Exception:  # noqa: BLE001 - one link must not end the run
        return None
    return None


def greenhouse_board(
    url: str, company: str, robots: Robots, get: Callable[[str], bytes]
) -> str | None:
    """The Greenhouse board whose posting this careers page shows, proved by asking
    that board for the posting's number: only its own board answers 200."""
    number = GH_JID.search(url)
    if not number:
        return None

    def holds(token: str) -> bool:
        api = f"https://boards-api.greenhouse.io/v1/boards/{token}/jobs/{number[1]}"
        return bool(_read(api, robots, get))

    guesses = _guesses(company, url)
    if found := next((token for token in guesses if holds(token)), None):
        return found
    page = (_read(url, robots, get) or b"").decode("utf-8", "replace")
    named = dict.fromkeys(m.lower() for p in GH_NAMED for m in p.findall(page))
    return next((token for token in named if token not in guesses and holds(token)), None)


def icims_board(url: str, company: str, robots: Robots, get: Callable[[str], bytes]) -> str | None:
    """The iCIMS tenant whose posting this careers page shows, proved by its sitemap."""
    path_number = JOB_NUMBER.search(urlsplit(url).path)
    if not path_number:
        return None
    page = (_read(url, robots, get) or b"").decode("utf-8", "replace")
    named = [m.lower() for m in PROVIDERS["icims"].apply_link.findall(page)]
    guesses = [f"careers-{g}" for g in _guesses(company, url)]
    for tenant in dict.fromkeys([*named, *guesses]):
        sitemap = _read(listing_url("icims", tenant), robots, get)
        if sitemap and f"/jobs/{path_number[1]}/".encode() in sitemap:
            return tenant
    return None
