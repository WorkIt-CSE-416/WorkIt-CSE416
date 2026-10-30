"""Prove which ATS boards sit behind short links and company careers pages.

Extracted from build_boards.py so both the legacy builder and daily discovery
can resolve the same kinds of unmatched URLs. Each board is proved before it
is kept, never guessed: a board under the wrong name would put another
company's name on real cards.
"""

from __future__ import annotations

import re
import urllib.error
from collections.abc import Callable
from urllib.parse import urlsplit

from workit_scraper import web
from workit_scraper.polite import Robots
from workit_scraper.providers import PROVIDERS, listing_url

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
