"""
Which job postings auto apply takes: the hiring systems the extension can
fill, read from the posting's apply_url host: every hiring system the Fill
engine fills (KAN-370; auto-apply/architecture.md, "The batch"), the same
hosts as the extension's manifest.json. Never a job board (LinkedIn,
Indeed), whose terms ban automation. Add a host here and the
Jobs page's Auto Apply buttons, the matches, a batch and a single queueing
all follow, since each reads this one rule.

Imports nothing of the app, so the job listing schema (app/schemas/jobs.py)
can use it without a cycle.
"""

import re

AUTO_APPLY_HOSTS = (
    "greenhouse.io",
    "lever.co",
    "ashbyhq.com",
    "rippling.com",
    "workable.com",
    "eightfold.ai",
    # Eightfold on a company's own domain (the engine's EIGHTFOLD_COMPANIES).
    "explore.jobs.netflix.net",
    "myworkdayjobs.com",
    "myworkdaysite.com",
    # Oracle Recruiting Cloud's candidate experience (the engine's oracle.ts).
    "oraclecloud.com",
    # TikTok and ByteDance's careers sites: one form, behind the site's own
    # sign-in, which the student goes through (the extension never signs in).
    # Only these hosts, never the rest of tiktok.com or bytedance.com.
    "lifeattiktok.com",
    "careers.tiktok.com",
    "jobs.bytedance.com",
    "joinbytedance.com",
    # SmartRecruiters' postings and their one-click form (jobs.smartrecruiters.com).
    "smartrecruiters.com",
    # SAP SuccessFactors' career sites (the engine's successfactors.ts).
    "successfactors.com",
    "successfactors.eu",
    "sapsf.com",
    "sapsf.eu",
    # iCIMS career sites, the form in their own iframe (the engine's icims.ts).
    "icims.com",
)

# The host is one of AUTO_APPLY_HOSTS or a subdomain of it
# (job-boards.greenhouse.io, boards.eu.greenhouse.io), or the link is a
# company's own careers page that shows a Greenhouse posting, named by
# ?gh_jid= in its query: the extension fills the embedded form in its iframe
# there (KAN-369), or the page's own form where the Fill engine fills it
# (Waymo's careers site, careers.withwaymo.com, which builds its own form;
# it was left out until the engine's Waymo Filler). Written for both
# Python's re and Postgres's ~* (filters.py), so the SQL and the listing's
# flag agree: one capture-free alternation.
AUTO_APPLY_URL_PATTERN = (
    r"^https?://(?:[a-z0-9-]+\.)*(?:"
    + "|".join(re.escape(host) for host in AUTO_APPLY_HOSTS)
    + r")(?:[/:?#]|$)"
    + r"|^https?://[^/?#]+[^?#]*\?(?:[^#]*&)?gh_jid=[0-9]+(?:[&#]|$)"
)
_AUTO_APPLY_URL = re.compile(AUTO_APPLY_URL_PATTERN, re.IGNORECASE)


def auto_apply_supported(apply_url: str) -> bool:
    """Whether auto apply takes the job posting at this apply_url."""
    return _AUTO_APPLY_URL.match(apply_url) is not None


# Job boards (KAN-376): sites that list other employers' job postings. Their
# terms ban automated applications, so auto apply never opens one; a posting
# there is taken only through the employer's own form it names. Host, and the
# board's name as a student knows it.
JOB_BOARDS = {
    "linkedin.com": "LinkedIn",
    "lnkd.in": "LinkedIn",
    "indeed.com": "Indeed",
    "glassdoor.com": "Glassdoor",
    "ziprecruiter.com": "ZipRecruiter",
    "joinhandshake.com": "Handshake",
    "wellfound.com": "Wellfound",
    "simplyhired.com": "SimplyHired",
    "monster.com": "Monster",
    "dice.com": "Dice",
    "builtin.com": "Built In",
    "simplify.jobs": "Simplify",
    "jobright.ai": "Jobright",
}

JOB_BOARD_URL_PATTERN = (
    r"^https?://([a-z0-9-]+\.)*("
    + "|".join(re.escape(host) for host in JOB_BOARDS)
    + r")([/:?#]|$)"
)
_JOB_BOARD_URL = re.compile(JOB_BOARD_URL_PATTERN, re.IGNORECASE)


# The first link in a job board posting's text to a hiring system auto apply
# fills: the employer's own form, which the posting names ("Apply on our
# site"). Its host must end there (not greenhouse.io.example.com), and a
# sentence's closing stop or bracket is not part of it. Written for
# Postgres's substring() (filters.py FORM_URL): only non-capturing groups, as
# substring() answers the first group's match, and (?i) for its case.
NAMED_FORM_PATTERN = (
    r"(?i)https?://(?:[a-z0-9-]+\.)*(?:"
    + "|".join(re.escape(host) for host in AUTO_APPLY_HOSTS)
    + r")(?![a-z0-9.-])(?:[/:?#](?:[^ \t\r\n\"'<>]*[^ \t\r\n\"'<>.,;:!?)])?)?"
)


def job_board(url: str) -> str | None:
    """The job board this link is on ("LinkedIn"), or None for any other link."""
    found = _JOB_BOARD_URL.match(url)
    return found and JOB_BOARDS[found.group(2).lower()]


def refusal(apply_url: str) -> str:
    """Why auto apply won't take the job posting at this apply_url, for the student."""
    board = job_board(apply_url)
    if board:
        return (
            f"{board} is a job board, and its terms ban automated applications. "
            "Auto Apply fills only an employer's own application form, and this posting names none."
        )
    return "Auto Apply can't fill this job's hiring system yet."
