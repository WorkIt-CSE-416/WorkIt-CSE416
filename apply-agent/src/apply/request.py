"""Requests: Posting links Lisul adds himself, in the Requests tab or with
`apply add`. They go ahead of every Match and skip the Match filters and the
per-company cap, but still pass the Repost check and everything after it.

LinkedIn links are read logged out through the JobSite, never signed in
(LinkedIn's terms ban bots). Logged out, LinkedIn's Apply button opens a
sign-in box and the page never names the employer's form (checked on
2026-10-15), so a LinkedIn Request is a Handoff. Older logged-out pages did
name it, in an externalApply link; if that comes back, it is followed.
Handshake sends every logged-out job link to "Log in or sign up", so a
Handshake Request is a Handoff without reading anything."""

import hashlib
import html
import re
from urllib.parse import unquote, urlsplit

from apply import fill_engine, workday
from apply.adapters import JobSite
from apply.feed import normalize_url
from apply.model import NOT_A_POSTING, Posting, Status
from apply.worker import Result

# Every Request's Application ID starts so; Feed ids are UUIDs.
REQUEST = "request-"
# A LinkedIn job, linked to directly or picked in search results.
LINKEDIN_JOB = re.compile(r"linkedin\.com/jobs/(?:view/(?:[^/?#]*-)?|.*[?&]currentJobId=)(\d+)")
LINKEDIN_TITLE = re.compile(r'class="[^"]*\btopcard__title\b[^"]*"[^>]*>([^<]+)<')
LINKEDIN_COMPANY = re.compile(r'class="[^"]*\btopcard__org-name-link\b[^"]*"[^>]*>([^<]+)<')
# LinkedIn's redirect to the employer's form, which carries the form's link.
LINKEDIN_EMPLOYER = re.compile(r"linkedin\.com/jobs/view/externalApply/\d+\?url=([^&\"\s]+)")
# How a link to one Posting looks on each job system with a Filler; a board,
# a company page or a search on that job system is not one.
POSTING_LINK = {
    "greenhouse": re.compile(r"greenhouse\.io/[^/]+/jobs/\d+|greenhouse\.io/embed/job_app\?.*\btoken=\d+|[?&]gh_jid=\d+"),
    "lever": re.compile(r"jobs\.lever\.co/[^/]+/[0-9a-f-]{36}"),
    "ashby": re.compile(r"jobs\.ashbyhq\.com/[^/]+/[0-9a-f-]{36}"),
    "workday": re.compile(r"/job/"),
    "workable": re.compile(r"apply\.workable\.com/[^/]+/j/[0-9A-Z]+"),
}


def resolve(url: str, site: JobSite) -> tuple[Posting, Result | None]:
    """The Posting a Request links to, and its Result if the Request ends
    before a Worker takes it. The Application ID comes from the link, so
    pasting the same link again finds the same Application."""
    parts = urlsplit(url)
    if parts.scheme not in ("http", "https") or not parts.netloc:
        return _posting(url), Result(Status.FAILED, f"{NOT_A_POSTING}.")
    host = parts.netloc.casefold()
    if host.endswith("linkedin.com"):
        return _from_linkedin(url, site)
    if host.endswith("joinhandshake.com"):
        return _posting(url), Result(Status.HANDOFF, (
            "Handshake shows Postings only after sign-in, which Apply never does. "
            "Open it and apply yourself, or paste the employer's own link as a Request."
        ))
    posting = _posting(url)
    if (shape := POSTING_LINK.get(posting.job_system)) and not shape.search(url):
        return posting, Result(Status.FAILED, f"{NOT_A_POSTING}: a {posting.job_system} page, but not one Posting.")
    # The company and role its job system names (zero tokens): Workday's pages name none, so the Feed's.
    names = workday.names if posting.job_system == "workday" else fill_engine.job_names if fill_engine.job_of(url) else None
    if names:
        try:
            posting = _posting(url, *names(url, site))
        except Exception:
            pass  # unnamed: the Filler meets whatever is wrong (a closed Posting, say) and says so
    return posting, None


def _from_linkedin(url: str, site: JobSite) -> tuple[Posting, Result | None]:
    job = LINKEDIN_JOB.search(url)
    if not job:
        return _posting(url), Result(Status.FAILED, "A LinkedIn page, not a link to a job posting.")
    url = f"https://www.linkedin.com/jobs/view/{job[1]}"
    try:
        page = site.fetch(url).decode("utf-8", "replace")
    except Exception:
        page = ""  # LinkedIn often turns logged-out readers away; Lisul can still open it
    company, title = _text(LINKEDIN_COMPANY, page), _text(LINKEDIN_TITLE, page)
    if employer := LINKEDIN_EMPLOYER.search(page):
        return _posting(unquote(employer[1]), company, title), None
    return _posting(url, company, title), Result(Status.HANDOFF, (
        "LinkedIn shows where to apply only after sign-in, which Apply never does. "
        "Open it and apply yourself, or paste the employer's own link as a Request."
    ))


def _posting(url: str, company: str = "", title: str = "") -> Posting:
    return Posting(id=request_id(url), company=company, title=title, url=url)


def _text(pattern: re.Pattern, page: str) -> str:
    found = pattern.search(page)
    return html.unescape(found[1]).strip() if found else ""


def request_id(url: str) -> str:
    return REQUEST + hashlib.sha1(normalize_url(url).encode()).hexdigest()[:12]


def is_request(application_id: str) -> bool:
    return application_id.startswith(REQUEST)

