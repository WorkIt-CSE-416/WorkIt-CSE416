"""A company careers page that embeds a Greenhouse, Lever or Ashby form, as
that form's own link, so the job system's Filler fills it instead of Claude
fill. Plain code, zero tokens.

greenhouse.board_behind finds a Greenhouse job from the link alone (its
?gh_jid=, or the job id in its path), with no page. Where it can't, the page
is opened in the Worker's browser and its frames are read: the form's frame
names its job system's link. A page that shows the form only once its Apply
button is clicked (Roblox's "Apply Now", live) gets that one click, on a
button or link outside any form, so it never sends anything. A page that
links its Apply straight to the job system's own page is read the same way.
"""

import re
from dataclasses import replace
from urllib.parse import parse_qs, urlsplit

from playwright.sync_api import Page

from apply import description
from apply.adapters import JobSite
from apply.fill_engine import posting_ai_trap
from apply.model import Posting

SETTLES_MS = 5_000  # how long the page may load before its frames are read
SHOWS_MS = 6_000  # how long the form's frame may take to show once Apply is clicked
POLL_MS = 250
APPLY = re.compile(r"^\s*apply(\s+(now|here|online|for this (job|role|position)))?\s*$", re.IGNORECASE)
GREENHOUSE_EMBED = re.compile(r"^https://(?:job-boards|boards)(?:\.eu)?\.greenhouse\.io/embed/job_app\?", re.IGNORECASE)
GREENHOUSE_JOB = re.compile(r"^https://(?:job-boards|boards)(?:\.eu)?\.greenhouse\.io/([\w-]+)/jobs/(\d+)", re.IGNORECASE)
LEVER = re.compile(r"^https://jobs(?:\.eu)?\.lever\.co/[\w.-]+/[0-9a-f-]{36}", re.IGNORECASE)
ASHBY = re.compile(r"^https://jobs\.ashbyhq\.com/[^/?#]+/[0-9a-f-]{36}", re.IGNORECASE)
JOB_ID = re.compile(r"[?&]gh_jid=(\d+)|/(\d{6,})/?(?:[?#]|$)")
# The page's frames' sources (a lazy one not yet loaded too), and every <a> whose words say apply:
# not another link, which may be another job's.
SOURCES = """() => [...document.querySelectorAll('iframe[src]')].map(f => f.src).concat([...document.querySelectorAll('a[href]')]
  .filter(a => /\\bapply\\b/i.test(a.innerText || a.getAttribute('aria-label') || '')).map(a => a.href))"""


def form_behind(posting: Posting, site: JobSite, text: str | None = None) -> Posting:
    """`posting` with its link turned into the link of the Greenhouse, Lever or
    Ashby form its page embeds; as it is when the page embeds none, or when
    it can't be opened. Only a Posting of no known job system is opened, and
    never one whose page, read with a plain fetch (`text`, when the caller
    read it already), speaks to AI agents: the Worker hands it off unopened."""
    if posting.job_system != "other":
        return posting
    if posting_ai_trap(description.from_link(posting, site) if text is None else text):
        return posting
    try:
        with site.open(posting.url) as page:
            found = embedded_form(page, posting.url)
    except Exception:
        return posting
    return replace(posting, url=found) if found else posting


def embedded_form(page: Page, url: str) -> str:
    """The link of the form the open page embeds, or ""."""
    try:
        page.wait_for_load_state("networkidle", timeout=SETTLES_MS)
    except Exception:
        pass  # some pages never go quiet
    if found := _found(page, url):
        return found
    if not _click_apply(page):
        return ""
    waited = 0
    while waited < SHOWS_MS:
        page.wait_for_timeout(POLL_MS)
        waited += POLL_MS
        if found := _found(page, url):
            return found
    return ""


def form_link(link: str, posting_url: str = "") -> str:
    """A frame's or link's URL as its job system's own Posting link, or "" if
    it is none: Greenhouse's embedded form with its board and job (the job
    from the posting's link where the frame names none), Lever's or Ashby's
    job page without its /apply or /application tail."""
    if GREENHOUSE_EMBED.search(link):
        query = parse_qs(urlsplit(link).query)
        board = (query.get("for") or [""])[0]
        job = (query.get("token") or [""])[0] or _job_id(posting_url)
        if re.fullmatch(r"[\w-]+", board) and job.isdigit():
            return f"https://job-boards.greenhouse.io/embed/job_app?for={board}&token={job}"
        return ""
    if hosted := GREENHOUSE_JOB.search(link):
        return f"https://job-boards.greenhouse.io/embed/job_app?for={hosted[1]}&token={hosted[2]}"
    for system in (LEVER, ASHBY):
        if found := system.search(link):
            return found[0]
    return ""


def _job_id(url: str) -> str:
    found = JOB_ID.search(url)
    return (found[1] or found[2]) if found else ""


def _found(page: Page, url: str) -> str:
    """A form's link among the page's frames and Apply links."""
    links = [frame.url for frame in page.frames]
    try:
        links += page.evaluate(SOURCES)
    except Exception:
        pass
    return next((found for link in links if (found := form_link(link, url))), "")


def _click_apply(page: Page) -> bool:
    """Click the page's own Apply button or link, outside any form, once.
    Whether there was one."""
    for role in ("button", "link"):
        for control in page.get_by_role(role, name=APPLY).all():
            try:
                if not control.is_visible() or control.evaluate("el => !!el.closest('form')"):
                    continue
                control.click(timeout=5_000)
                return True
            except Exception:
                continue
    return False
