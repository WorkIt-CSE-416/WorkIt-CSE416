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

The website a board names is kept too (`Store.websites`), beside an uploaded logo
as well: the Jobs page draws its logo from Brandfetch by that website
(`company_domain`), and an upload is only its fallback.
"""

from __future__ import annotations

import csv
import html
import json
import re
import urllib.error
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from urllib.parse import parse_qs, quote, urlsplit

from workit_scraper import providers, web
from workit_scraper.polite import Robots

#: Raise it when the reader learns a new place to find a logo or website: the next
#: live run reads again every board stored with no logo (`__main__`), once. Stored
#: logos are kept -- an image that worked does not need a second look.
VERSION = 2

# Each board's page and its logo pattern are its provider's (`Provider.logo_page`,
# `Provider.logo_pattern`); `favicon` accepts only Google's host, for the same reason
# those patterns accept only their own.
# Google's favicon service, the logo of a board that names only its website.
FAVICON = "https://www.google.com/s2/favicons?"
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
# Boards whose own pages name no website, or the wrong one (a careers site, a hiring
# vendor), with the company's site as checked (`checked_websites.csv`: it loads, and
# its name matches the company or the board; a person looked at every row that did
# not). Checked first, so it also replaces a board's own blurry answer, and it gives
# `company_domain` the site of a board with no logo page at all (iCIMS, Oracle).
CHECKED_CSV = Path(__file__).resolve().parent.parent / "checked_websites.csv"


def _checked(path: Path) -> dict[str, str]:
    with path.open(newline="", encoding="utf-8") as handle:
        rows = csv.DictReader(line for line in handle if not line.startswith("#"))
        return {row["board"]: row["website"] for row in rows}


CHECKED_WEBSITES = _checked(CHECKED_CSV)
# Hosts that serve companies' careers sites for them: a website on one is the
# vendor's, and so is its logo (micron.eightfold.ai gave Eightfold's).
VENDOR_DOMAINS = frozenset(
    {
        "ashbyhq.com",
        "avature.net",
        "bamboohr.com",
        "eightfold.ai",
        "google.com",
        "greenhouse.io",
        "icims.com",
        "jibeapply.com",
        "lever.co",
        "myworkday.com",
        "myworkdayjobs.com",
        "myworkdaysite.com",
        "oraclecloud.com",
        "phenompeople.com",
        "rippling.com",
        "smartrecruiters.com",
        "successfactors.com",
        "talentbrew.com",
        "taleo.net",
        "workable.com",
    }
)
# What `job_postings.company_domain`'s CHECK allows (backend migration d9b579e66623):
# the domain goes into an image URL on the Jobs page.
DOMAIN = re.compile(r"[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+")
# Greenhouse does not, but a board's job descriptions link the company's site.
GREENHOUSE_JOBS = "https://boards-api.greenhouse.io/v1/boards/{}/jobs?content=true"
# Nor do some Lever boards, or they hide every hosted page (Aircall: 404), but the
# postings API stays public and their descriptions link the site. 50 is plenty for
# boilerplate. On the board's own data centre's host (`lever_jobs`).
LEVER_JOBS = "https://{api}/v0/postings/{slug}?mode=json&limit=50"


def lever_jobs(token: str) -> str:
    """A Lever board's postings, on its US or EU API host (`registry._parts`)."""
    return LEVER_JOBS.format(**providers.registry._parts("lever", token))


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
    return f"{FAVICON}domain={quote(host)}&sz=128"


def registered_domain(host: str) -> str:
    """The name a company registered: `careers.gevernova.com` -> `gevernova.com`,
    `intel.co.uk` kept whole. Brandfetch knows a company by it, rarely by a subdomain.

    ponytail: the last two labels, or three under a country's `co.`/`com.`-style
    suffix, not the public suffix list; a suffix it misses keeps one label too few."""
    labels = host.lower().strip(".").split(".")
    second = ("ac", "co", "com", "edu", "gov", "net", "org")
    n = 3 if len(labels) > 2 and len(labels[-1]) == 2 and labels[-2] in second else 2
    return ".".join(labels[-n:])


def is_upload(logo: str | None) -> bool:
    """Whether the logo is an image the employer uploaded, not a website's favicon."""
    return logo is not None and not logo.startswith(FAVICON)


def needs_read(key: str, logos: dict[str, str | None], websites: dict[str, str | None]) -> bool:
    """Whether a board's page must be read: never read, or read for an uploaded logo
    before the reader kept websites. Each of those is read once more, so a board that
    kept its upload after KAN-442 gets a `company_domain`."""
    return key not in logos or (is_upload(logos[key]) and key not in websites)


def company_domain(
    key: str, logo: str | None, website: str | None = None, address: str | None = None
) -> str | None:
    """The employer's own registered domain, for the Jobs page's logo (KAN-442).

    The checked website first (`CHECKED_WEBSITES`), else the website the board named
    (`Store.websites`), else the website its favicon came from, else the domain its
    board's own address gave and `check_addresses` proved (`Store.addresses`). None
    for a hiring vendor's site or no website at all. Worked out when the feed is
    written, so a row added to the checked list reaches every board's jobs on the
    next run, read or not.
    """
    site = CHECKED_WEBSITES.get(key) or website
    if site is None and logo and logo.startswith(FAVICON):
        site = parse_qs(urlsplit(logo).query).get("domain", [None])[0]
    site = site or address
    if not site:
        return None
    domain = registered_domain(site)
    if domain in VENDOR_DOMAINS or not DOMAIN.fullmatch(domain):
        return None
    return domain


#: Hiring systems whose board token is a host on the company's own site:
#: Jibe's `careers.garmin.com`, SuccessFactors' `jobs.mcdonalds.com`.
OWN_HOST = ("jibe", "successfactors")
#: A home page's title, read to check the company's name on it.
TITLE = re.compile(r"<title[^>]*>(.*?)</title>", re.I | re.S)


def board_address(ats: str, token: str) -> tuple[str, bool] | None:
    """The company's domain as its board's own address gives it, and whether that
    is a guess. A Jibe or SuccessFactors board lives on the company's careers site,
    so its host's registered domain is the company's (not a guess). A Workday tenant
    is the name the company chose (`sbdinc` for Stanley Black & Decker), and
    `{tenant}.com` is only a guess: `yale` gives yale.com, a lock maker, not Yale
    University. None for other systems, a vendor's host, or no usable name."""
    if ats in OWN_HOST and "." in token:
        domain, guess = registered_domain(token.split("/")[0]), False
    elif ats == "workday":
        domain, guess = f"{token.split('.')[0].lower()}.com", True
    else:
        return None
    if domain in VENDOR_DOMAINS or not DOMAIN.fullmatch(domain):
        return None
    return domain, guess


def _squash(text: str) -> str:
    return re.sub(r"[^a-z0-9]", "", text.lower())


def names_company(domain: str, company: str, title: str, *, guess: bool) -> bool:
    """Whether a home page shows it is the company's: the check a row of
    `checked_websites.csv` passes (docs/logos.md, Checked websites), done by the
    scraper. A guess must have the company's whole name, of two words or more, in
    its page's title (Stanley Black & Decker on sbdinc.com); yale.com's "Yale
    Home" does not hold "Yale University", and a one-word company is left to a
    person. A domain the board's own address gave needs less: its name
    in the company's name (garmin.com) or the company's name at its start
    (chsinc.com for CHS), the company's initials (gxo.com), or the company's first
    word in the title."""
    name, heading = _squash(company), _squash(title)
    words = re.findall(r"[a-z0-9]+", company.lower())
    if guess:
        # Two words at least: a one-word name is in too many titles. On
        # 2026-11-04 denver.com was "Denver Media", not the City of Denver, and
        # nexstar.com a web host, not Nexstar Media.
        return len(words) >= 2 and name in heading
    label = domain.split(".")[0]
    initials = "".join(word[0] for word in words)
    return (
        (len(label) >= 3 and label in name)
        or (len(name) >= 3 and label.startswith(name))
        or (len(initials) >= 2 and label.startswith(initials))
        or (bool(words) and len(words[0]) >= 3 and words[0] in heading)
    )


def check_addresses(boards: list[tuple[str, str, str]]) -> dict[str, str | None]:
    """`{"ats/token": domain or None}` for each board whose address gives a domain
    (`board_address`) and whose home page we could read: the domain when the page
    shows it is the company's (`names_company`), None when it does not, refuses us
    or is not there, so it is flagged for a person (`checked_websites.csv`). A
    timeout or a dropped connection leaves the board out, for the next run.

    The home page is read through `web.get` behind robots.txt and pacing like any
    other request, at www. first and then the bare domain; a redirect to another
    host of the same domain (garmin.com -> www.garmin.com) is followed, any other
    is not."""
    robots = Robots()

    def title(url: str) -> str | None:
        """The page's title, "" for a page with none; None when it refused us
        (robots.txt, an HTTP error, a redirect elsewhere). Raises OSError when the
        site could not be reached at all."""
        for _ in range(3):
            if not robots.allows(url):
                return None
            robots.pace(url)
            try:
                body = web.get(url, timeout=15)
            except urllib.error.HTTPError as error:
                moved = error.filename if 300 <= error.code < 400 else None
                host = urlsplit(moved).hostname if moved else None
                if host and registered_domain(host) == registered_domain(urlsplit(url).hostname):
                    url = moved
                    continue
                return None
            match = TITLE.search(body[:400_000].decode("utf-8", "replace"))
            return html.unescape(match.group(1)).strip() if match else ""
        return None

    def one(board: tuple[str, str, str]) -> tuple[str, str | None] | None:
        ats, token, company = board
        found = board_address(ats, token)
        if found is None:
            return None
        domain, guess = found
        # www first: most bare domains redirect there, robots.txt included, and a
        # robots.txt that redirects reads as a refusal (viasat.com, 2026-11-04).
        heading, unreachable = None, 0
        for url in (f"https://www.{domain}/", f"https://{domain}/"):
            try:
                heading = title(url)
            except OSError:  # DNS, refused, timeout
                unreachable += 1
                continue
            if heading is not None:
                break
        if unreachable == 2:  # neither host answered today: ask again next run
            return None
        ok = heading is not None and names_company(domain, company, heading, guess=guess)
        return f"{ats}/{token}", domain if ok else None

    with ThreadPoolExecutor(8) as pool:
        return dict(found for found in pool.map(one, boards) if found)


def reads_logo(ats: str) -> bool:
    """Whether its provider has a board page to read a logo or website from."""
    provider = providers.PROVIDERS.get(ats)
    return provider is not None and provider.logo_page is not None


def page_url(ats: str, token: str) -> str:
    page = providers.PROVIDERS[ats].logo_page
    assert page is not None, f"{ats} has no logo page"
    return page.format(token, **providers.registry._parts(ats, token))


def extract(ats: str, page: str) -> str | None:
    """The uploaded logo, else the favicon of the website the page names."""
    # Workday has no pattern: only its website is read.
    pattern = providers.PROVIDERS[ats].logo_pattern
    if pattern and (match := pattern.search(page)):
        return html.unescape(match.group(1)).replace("\\/", "/")
    host = website(ats, page)
    return favicon(host) if host else None


# The board pages that name the company's website outright.
WEBSITE_PATTERNS = {
    "ashby": ASHBY_WEBSITE,
    "workable": WORKABLE_WEBSITE,
    "lever": LEVER_WEBSITE,
    "workday": WORKDAY_WEBSITE,
}


def website(ats: str, page: str) -> str | None:
    """The host of the company's website as its board page names it: Ashby's
    `publicWebsite`, a Workable account's `url`, a Lever footer's home page link or a
    Workday careers site's "Home" link. None for a link back to the hiring system, and
    for any other system: those name it, if at all, only where `fetch` looks next."""
    pattern = WEBSITE_PATTERNS.get(ats)
    if not pattern or not (site := pattern.search(page)):
        return None
    host = urlsplit(site.group(1)).netloc
    if f".{host}".endswith((".lever.co", *WORKDAY_HOSTS)):
        return None
    return host or None


def _png_side(data: bytes) -> int | None:
    """The shorter side of a PNG, from its header; None for anything else."""
    if data[:8] != b"\x89PNG\r\n\x1a\n":
        return None
    return min(int.from_bytes(data[16:20]), int.from_bytes(data[20:24]))


def fetch(
    boards: list[tuple[str, str, str]],
) -> tuple[dict[str, str | None], dict[str, str | None]]:
    """`({"ats/token": logo or None}, {"ats/token": website host or None})` for each
    board whose page we could read.

    A page that loaded without a logo maps to None, so it is not read again; so does
    one that named no website. A page we could not read -- robots.txt, a timeout -- is
    left out of both, so the next run tries it again.
    """
    boards = [board for board in boards if reads_logo(board[0])]
    # Each Workday company is its own host, so its robots.txt is read when a worker
    # gets there, not up front. Only the API path is checked: its careers site was
    # checked when the board was read (`providers.robots_urls`), or it has no jobs here.
    robots = Robots(
        [page_url(ats, token) for ats, token, _ in boards if ats != "workday"]
        + [GREENHOUSE_JOBS.format(token) for ats, token, _ in boards if ats == "greenhouse"]
        + [lever_jobs(token) for ats, token, _ in boards if ats == "lever"]
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

    def one(board: tuple[str, str, str]) -> tuple[str, str | None, str | None] | None:
        ats, token, company = board
        key = f"{ats}/{token}"
        if key in CHECKED_WEBSITES:
            return key, favicon(CHECKED_WEBSITES[key]), CHECKED_WEBSITES[key]
        body, moved = read(page_url(ats, token))
        if body is None and moved is None:
            return None
        page = body.decode("utf-8", "replace") if body else ""
        logo = extract(ats, page) if page else None
        site = website(ats, page) if page else None
        # Ashby keeps a square logo however small it was uploaded (Bedrock's is 50px);
        # the company's own website usually has a sharper icon.
        if logo and site and logo.startswith(ASHBY_IMAGES):
            side = _png_side(read(logo)[0] or b"")
            if side is not None and side < SMALL_PX:
                logo = favicon(site)
        if site is None:
            # The page names no website, beside a logo or not. Its job descriptions,
            # and where it redirects (Stripe -> stripe.com), may name the company's
            # site -- but only a site whose name matches the company counts
            # (Accenture's board redirects to a Salesforce host). Read beside an
            # upload too: the Jobs page draws its logo by the website (KAN-442).
            text = moved or ""
            names = (token, company)
            if ats == "workday":
                # Its privacy policy may be on the company's site (kbr.com), or not
                # (talentbrew.com). The tenant, not the token: a site named "careers"
                # must not make careers.com the company's.
                text, names = page, (token.split(".")[0], company)
            # No descriptions -- a failed read, or a 404 (an empty body) -- leave a
            # board with no logo for the next run, as before. Beside an upload only a
            # failed read does: a 404 records it with no website, or it would be
            # read on every run.
            elif ats == "greenhouse":
                jobs = read(GREENHOUSE_JOBS.format(token), timeout=30)[0]
                if jobs is None or (not jobs and logo is None):
                    return None
                listed = json.loads(jobs)["jobs"] if jobs else []
                contents = (job.get("content") or "" for job in listed)
                link = GREENHOUSE_LOGO_LINK.search(page)
                text = " ".join([link.group(1) if link else "", *contents, text])
            elif ats == "lever":
                jobs = read(lever_jobs(token), timeout=30)[0]
                if jobs is None or (not jobs and logo is None):
                    return None
                parts = [text]
                for job in json.loads(jobs) if jobs else []:
                    # Its lists hold the bullets, an "About us" among them.
                    parts += [job.get("description", ""), job.get("additional", "")]
                    parts += [item.get("content", "") for item in job.get("lists", [])]
                text = " ".join(parts)
            site = stated_site(text, *names)
            if logo is None and site:
                logo = favicon(site)
        return key, logo, site

    with ThreadPoolExecutor(8) as pool:
        found = [board for board in pool.map(one, boards) if board]
    return {key: logo for key, logo, _ in found}, {key: site for key, _, site in found}
