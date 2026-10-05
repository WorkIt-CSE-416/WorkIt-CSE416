"""Each company's own logo, read off its public job board page.

The listing APIs carry no logo, but every ATS shows the one the employer uploaded
on the board's page. Without one -- or with a tiny one -- the company's website's
favicon, when the board tells us the website: Ashby names it, a Greenhouse board's job
descriptions link it, a board may redirect to it, or a person checked it by hand
(`CHECKED_WEBSITES`). We never guess a website from a company name: "Workshop" is not
workshop.com. Each board is read once, ever: a board already in
`Store.logos` is never read again, because logos almost never change. Delete the
`logos` key from jobs.json to read them all again.
"""

from __future__ import annotations

import html
import json
import re
import urllib.error
from concurrent.futures import ThreadPoolExecutor
from urllib.parse import quote, urlsplit

from workit_scraper import web
from workit_scraper.polite import Robots

# `job-boards.`, not `boards.greenhouse.io`: the latter redirects there, and `web.get`
# refuses a cross-origin redirect.
PAGE = {
    "greenhouse": "https://job-boards.greenhouse.io/{}",
    "ashby": "https://jobs.ashbyhq.com/{}",
    "lever": "https://jobs.lever.co/{}",
}
# Each pattern only accepts its ATS's own image host, and `favicon` only Google's.
# frontend/next.config.ts allows exactly these hosts, and next/image throws -- failing
# the whole page -- on any other, so a logo from anywhere else must stay out of the feed.
PATTERN = {
    "greenhouse": re.compile(
        r'"(https://[\w-]*recruiting\.cdn\.greenhouse\.io/external_greenhouse_job_boards/logos/[^"]+)"'
    ),
    # The square mark, not `logoWordmarkImageUrl`: the card's tile is square.
    "ashby": re.compile(r'"logoSquareImageUrl":"(https://app\.ashbyhq\.com/api/images/[^"]+)"'),
    # The header logo, not `og:image` -- Lever's is a 1200x630 banner with a tagline.
    "lever": re.compile(
        r'class="main-header-logo"[^>]*>\s*<img[^>]*\ssrc="'
        r'(https://lever-client-logos\.s3(?:\.us-west-2)?\.amazonaws\.com/[^"]+)"'
    ),
}
# Where Ashby serves uploaded logos -- read only to measure one (see `fetch`).
ASHBY_IMAGES = "https://app.ashbyhq.com/api/images/"
# A logo smaller than this looks blurred in the card's 80px tile.
SMALL_PX = 64
# Ashby names the company's own website even when no logo was uploaded.
ASHBY_WEBSITE = re.compile(r'"publicWebsite":"(https?://[^"]+)"')
# Boards that state no logo and no website anywhere we read, with the site a person
# checked by hand -- its homepage names the same company. Only ever consulted when the
# board itself gives us nothing usable. Checked first, so it also replaces a board's
# own blurry answer. Add one only after opening the site yourself.
CHECKED_WEBSITES = {
    # Banner-only board, no links; momentenergy.com: "Repurposed EV Batteries".
    "greenhouse/momentenergy": "www.momentenergy.com",
    # Redirects to careers.withwaymo.com, whose icon is 32px; waymo.com's is 128px.
    "greenhouse/waymo": "waymo.com",
}
# Greenhouse does not, but a board's job descriptions link the company's site.
GREENHOUSE_JOBS = "https://boards-api.greenhouse.io/v1/boards/{}/jobs?content=true"


def stated_site(text: str, *names: str) -> str | None:
    """The first site linked in `text` whose name is in the company's own names.

    Descriptions also link eeoc.gov, benefits vendors and social media, so a link counts
    only when its domain name (`scale` of careers.scale.com) appears in the board token
    or company name -- a check on a site the employer linked, not a guess from the name.
    """
    who = re.sub(r"[^a-z0-9]", "", "".join(names).lower())
    for url in re.findall(r'https?://[^\s"<>)]+', html.unescape(text)):
        labels = (urlsplit(url).hostname or "").split(".")
        # `x.co.uk` / `x.com.au` keep the label before the two-part suffix.
        i = len(labels) - (3 if len(labels) > 2 and labels[-2] in ("co", "com") else 2)
        # ponytail: a 3+ letter substring test; a board named after a common word could
        # match some unrelated site. None has among the 51 checked.
        # Compared without punctuation, like `who`: squarepoint-capital.com.
        name = re.sub(r"[^a-z0-9]", "", labels[i]) if i >= 0 else ""
        if len(name) >= 3 and name in who:
            return ".".join(labels[i:])
    return None


def favicon(host: str) -> str:
    """The site's own icon, via Google's favicon service -- one host for next.config.ts
    to allow, and a 404 (so the card's initials) for a site that has none."""
    return f"https://www.google.com/s2/favicons?domain={quote(host)}&sz=128"


def extract(ats: str, page: str) -> str | None:
    if match := PATTERN[ats].search(page):
        return html.unescape(match.group(1))
    if ats == "ashby" and (site := ASHBY_WEBSITE.search(page)):
        return favicon(urlsplit(site.group(1)).netloc)
    return None


def _png_side(data: bytes) -> int | None:
    """The shorter side of a PNG, from its header; None for anything else."""
    if data[:8] != b"\x89PNG\r\n\x1a\n":
        return None
    return min(int.from_bytes(data[16:20]), int.from_bytes(data[20:24]))


def fetch(boards: list[tuple[str, str, str]]) -> dict[str, str | None]:
    """`{"ats/token": url or None}` for each board whose page we could read.

    A page that loaded without a logo maps to None, so it is not read again. A page
    we could not read -- robots.txt, a timeout -- is left out, so the next run tries it
    again.
    """
    boards = [board for board in boards if board[0] in PAGE]
    robots = Robots(
        [PAGE[ats].format(token) for ats, token, _ in boards]
        + [GREENHOUSE_JOBS.format(token) for ats, token, _ in boards if ats == "greenhouse"]
        + [ASHBY_IMAGES]
    )

    def read(url: str, timeout: float = 15) -> tuple[bytes | None, str | None]:
        """`(body, None)`; `(None, where)` for a cross-origin redirect we refused to
        follow; `(None, None)` when robots.txt says no or the read failed."""
        if not robots.allows(url):
            return None, None
        robots.pace(url)
        try:
            return web.get(url, timeout=timeout), None
        except urllib.error.HTTPError as error:
            if 300 <= error.code < 400 and error.filename:
                return None, error.filename
            return None, None
        except Exception:  # noqa: BLE001 - a missing logo must not end the run
            return None, None

    def one(board: tuple[str, str, str]) -> tuple[str, str | None] | None:
        ats, token, company = board
        key = f"{ats}/{token}"
        if key in CHECKED_WEBSITES:
            return key, favicon(CHECKED_WEBSITES[key])
        body, moved = read(PAGE[ats].format(token))
        if body is None and moved is None:
            return None
        page = body.decode("utf-8", "replace") if body else ""
        logo = extract(ats, page) if page else None
        # Ashby keeps a square logo however small it was uploaded (Bedrock's is 50px);
        # the company's own website usually has a sharper icon.
        site = ASHBY_WEBSITE.search(page) if ats == "ashby" else None
        if logo and site and logo.startswith(ASHBY_IMAGES):
            side = _png_side(read(logo)[0] or b"")
            if side is not None and side < SMALL_PX:
                logo = favicon(urlsplit(site.group(1)).netloc)
        if logo is None:
            # The board names no logo. Its job descriptions, and where it redirects
            # (Stripe -> stripe.com), may name the company's site -- but only a site
            # whose name matches the company counts (Accenture's board redirects to a
            # Salesforce host).
            text = moved or ""
            if ats == "greenhouse":
                jobs = read(GREENHOUSE_JOBS.format(token), timeout=30)[0]
                if jobs is None:
                    return None
                contents = (job.get("content") or "" for job in json.loads(jobs)["jobs"])
                text = " ".join(contents) + " " + text
            found = stated_site(text, token, company)
            logo = favicon(found) if found else None
        return key, logo

    with ThreadPoolExecutor(8) as pool:
        return dict(found for found in pool.map(one, boards) if found)
