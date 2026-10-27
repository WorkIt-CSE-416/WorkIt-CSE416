"""Each company's own logo, read off its public job board page.

The listing APIs carry no logo, but most ATSs show the one the employer uploaded
on the board's page. Without one -- or with a tiny one, or Workday's wide banner --
the company's website's favicon, when the board tells us the website: Ashby and
Workable name it, a Workday careers site links its home page, a Lever board's footer
links it, a Greenhouse board's logo link or a Greenhouse or Lever board's job
descriptions link it, a board may redirect to it, or a person checked it by hand
(`CHECKED_WEBSITES`). We never guess a website from a company name: "Workshop" is not
workshop.com. Each board is read once, ever: a board already in
`Store.logos` is never read again, because logos almost never change. Delete the
`logos` key from jobs.json to read them all again; a board read with no logo is read
again once whenever `VERSION` goes up.
"""

from __future__ import annotations

import html
import json
import re
import urllib.error
from concurrent.futures import ThreadPoolExecutor
from urllib.parse import quote, urlsplit

from workit_scraper import providers, web
from workit_scraper.polite import Robots

#: Raise it when the reader learns a new place to find a logo or website: the next
#: live run reads again every board stored with no logo (`__main__`), once. Stored
#: logos are kept -- an image that worked does not need a second look.
VERSION = 2

# Each board's page and its logo pattern are its provider's (`Provider.logo_page`,
# `Provider.logo_pattern`); `favicon` accepts only Google's host, for the same reason
# those patterns accept only their own.
# Where Ashby serves uploaded logos -- read only to measure one (see `fetch`).
ASHBY_IMAGES = "https://app.ashbyhq.com/api/images/"
# A logo smaller than this looks blurred in the card's 80px tile.
SMALL_PX = 64
# Ashby names the company's own website even when no logo was uploaded.
ASHBY_WEBSITE = re.compile(r'"publicWebsite":"(https?://[^"]+)"')
# So does a Workable account, as its top-level `url`.
WORKABLE_WEBSITE = re.compile(r'^\{[^{]*"url":"(https?://[^"]+)"')
# And a Lever board, as its footer's "{Company} Home Page" link (Zoox: zoox.com).
LEVER_WEBSITE = re.compile(r'class="main-footer-text"><p><a href="(https?://[^"]+)"')
# A Greenhouse board's logo links somewhere even with no logo uploaded: usually the
# company's site (bgeinc.com), sometimes the board itself or a Slack file, so it goes
# through `stated_site` like the descriptions.
GREENHOUSE_LOGO_LINK = re.compile(r'"logo":\{"href":"(https?://[^"]+)"')
# And a Workday careers site, as the header's "Home" link: half of those sampled.
WORKDAY_WEBSITE = re.compile(r'"homePageURL":"(https?://[^"]+)"')
# Some sites' "Home" is the careers site itself, whose icon is Workday's, not theirs.
WORKDAY_HOSTS = (".myworkdayjobs.com", ".myworkdaysite.com", ".myworkday.com")
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
# Nor do some Lever boards, or they hide every hosted page (Aircall: 404), but the
# postings API stays public and their descriptions link the site. 50 is plenty for
# boilerplate.
LEVER_JOBS = "https://api.lever.co/v0/postings/{}?mode=json&limit=50"


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


def reads_logo(ats: str) -> bool:
    """Whether its provider has a board page to read a logo or website from."""
    provider = providers.PROVIDERS.get(ats)
    return provider is not None and provider.logo_page is not None


def page_url(ats: str, token: str) -> str:
    page = providers.PROVIDERS[ats].logo_page
    assert page is not None, f"{ats} has no logo page"
    return page.format(token, **providers.registry._parts(ats, token))


def extract(ats: str, page: str) -> str | None:
    # Workday has no pattern: only its website is read.
    pattern = providers.PROVIDERS[ats].logo_pattern
    if pattern and (match := pattern.search(page)):
        return html.unescape(match.group(1)).replace("\\/", "/")
    if ats == "ashby" and (site := ASHBY_WEBSITE.search(page)):
        return favicon(urlsplit(site.group(1)).netloc)
    if ats == "workable" and (site := WORKABLE_WEBSITE.search(page)):
        return favicon(urlsplit(site.group(1)).netloc)
    if ats == "lever" and (site := LEVER_WEBSITE.search(page)):
        host = urlsplit(site.group(1)).netloc
        return None if f".{host}".endswith(".lever.co") else favicon(host)
    if ats == "workday" and (site := WORKDAY_WEBSITE.search(page)):
        host = urlsplit(site.group(1)).netloc
        return None if f".{host}".endswith(WORKDAY_HOSTS) else favicon(host)
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
    boards = [board for board in boards if reads_logo(board[0])]
    # Each Workday company is its own host, so its robots.txt is read when a worker
    # gets there, not up front. Only the API path is checked: its careers site was
    # checked when the board was read (`providers.robots_urls`), or it has no jobs here.
    robots = Robots(
        [page_url(ats, token) for ats, token, _ in boards if ats != "workday"]
        + [GREENHOUSE_JOBS.format(token) for ats, token, _ in boards if ats == "greenhouse"]
        + [LEVER_JOBS.format(token) for ats, token, _ in boards if ats == "lever"]
        + [ASHBY_IMAGES]
    )

    def read(url: str, timeout: float = 15) -> tuple[bytes | None, str | None]:
        """`(body, None)`, an empty body for a 404; `(None, where)` for a cross-origin
        redirect we refused to follow; `(None, None)` when robots.txt says no or the
        read failed."""
        if not robots.allows(url):
            return None, None
        robots.pace(url)
        try:
            return web.get(url, timeout=timeout), None
        except urllib.error.HTTPError as error:
            if 300 <= error.code < 400 and error.filename:
                return None, error.filename
            # A page that is gone has no logo, but its board's descriptions may still
            # name the site (Aircall hides its Lever pages).
            if error.code == 404:
                return b"", None
            return None, None
        except Exception:  # noqa: BLE001 - a missing logo must not end the run
            return None, None

    def one(board: tuple[str, str, str]) -> tuple[str, str | None] | None:
        ats, token, company = board
        key = f"{ats}/{token}"
        if key in CHECKED_WEBSITES:
            return key, favicon(CHECKED_WEBSITES[key])
        body, moved = read(page_url(ats, token))
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
            names = (token, company)
            if ats == "workday":
                # Its privacy policy may be on the company's site (kbr.com), or not
                # (talentbrew.com). The tenant, not the token: a site named "careers"
                # must not make careers.com the company's.
                text, names = page, (token.split(".")[0], company)
            elif ats == "greenhouse":
                jobs = read(GREENHOUSE_JOBS.format(token), timeout=30)[0]
                if not jobs:
                    return None
                contents = (job.get("content") or "" for job in json.loads(jobs)["jobs"])
                link = GREENHOUSE_LOGO_LINK.search(page)
                text = " ".join([link.group(1) if link else "", *contents, text])
            elif ats == "lever":
                jobs = read(LEVER_JOBS.format(token), timeout=30)[0]
                if not jobs:
                    return None
                parts = [text]
                for job in json.loads(jobs):
                    # Its lists hold the bullets, an "About us" among them.
                    parts += [job.get("description", ""), job.get("additional", "")]
                    parts += [item.get("content", "") for item in job.get("lists", [])]
                text = " ".join(parts)
            found = stated_site(text, *names)
            logo = favicon(found) if found else None
        return key, logo

    with ThreadPoolExecutor(8) as pool:
        return dict(found for found in pool.map(one, boards) if found)
