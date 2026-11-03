"""Known sign-in walls: job systems whose form opens only to a signed-in
applicant, with no Sign in with Google (TikTok, ByteDance, iCIMS).

Claude fill signs in there, or makes the Employer account, reading its code
from Gmail (apply.account_pages). Without Gmail set up it can't, and before
this check it spent 100-150k tokens on each such Posting just to find the
sign-in page. So then a Posting behind a wall is a Handoff before any Claude
call, unless Lisul signed the Worker profiles in to that site once by hand
(`apply sign-in <url>`), and then it fills as usual. A Posting on an
employer's own careers page can still lead to a wall: its page redirects
there, or its Apply link goes there.
"""

from collections.abc import Collection
from urllib.parse import urlsplit

from playwright.sync_api import Page

from apply.model import Handoff

# Each wall's domain, and the job system's name in a Handoff's reason. A
# TikTok or ByteDance account covers its whole domain; an iCIMS account
# belongs to one employer's iCIMS site (careers-shure.icims.com), so each of
# those is a site of its own.
WALLS = {"lifeattiktok.com": "TikTok", "bytedance.com": "ByteDance", "icims.com": "iCIMS"}
PER_HOST = {"icims.com"}


def _domain(host: str) -> str | None:
    return next((d for d in WALLS if host == d or host.endswith("." + d)), None)


def site(url: str) -> str:
    """The site one sign-in covers: a wall's domain, or the host (an iCIMS
    employer's, or any other)."""
    host = (urlsplit(url).hostname or "").lower()
    domain = _domain(host)
    return domain if domain and domain not in PER_HOST else host


def wall(url: str) -> str | None:
    """The job system whose sign-in wall `url` is behind, if any."""
    domain = _domain((urlsplit(url).hostname or "").lower())
    return WALLS[domain] if domain else None


def needs_account(url: str, why: str) -> str:
    """A Handoff's reason for a Posting behind a wall, where `why` Gmail
    can't be read: what Lisul does once."""
    return (f"Needs your {wall(url)} account at {site(url)}, which Apply signs in to only with Gmail set up "
            f"({why.rstrip('.')}): set it up, or run `apply sign-in {url}` once, then Postings there fill as usual")


# The links on a page that open its form: an "Apply", "Apply now" or "Apply for this job".
APPLY_LINKS = """links => links
  .filter(a => /\\bapply\\b/i.test(`${a.innerText} ${a.getAttribute('aria-label') || ''}`))
  .map(a => a.href)"""


def check_landing(page: Page, signed_in: Collection[str], why: str) -> None:
    """Raise Handoff if the open Posting landed on a wall Lisul isn't signed in
    to, or its Apply link leads to one, by plain code before Claude fill reads
    it, where `why` Gmail can't be read."""
    try:
        page.wait_for_load_state("networkidle", timeout=5_000)  # a redirect by script lands first
    except Exception:
        pass  # some pages never go quiet
    urls = [frame.url for frame in page.frames] + page.eval_on_selector_all("a[href]", APPLY_LINKS)
    for url in urls:
        if wall(url) and site(url) not in signed_in:
            raise Handoff(needs_account(url, why))
