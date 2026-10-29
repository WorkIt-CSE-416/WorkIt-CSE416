"""Recognize one public ATS board/posting URL using the provider registry.

Both discovery commands use this boundary. Query text is not scanned for links.
The query-based board identifiers are explicit: the Greenhouse embed route, and
the marks of a company's iCIMS Jibe site (`icims=1`) and SuccessFactors career
site (`ats=successfactors`), each matched from the link's start (WHOLE_LINK).
"""

from __future__ import annotations

import re
from urllib.parse import parse_qs, unquote, urlsplit

from workit_scraper.providers.registry import PROVIDERS

# Workday's alternate public host names the same tenant/site as myworkdayjobs.
WORKDAY_SITE = re.compile(
    r"//(wd\d+)\.myworkdaysite\.com/(?:[a-z]{2}(?:-[a-z]{2})?/)?"
    r"recruiting/([a-z0-9-]+)/([a-z0-9_-]+)",
    re.I,
)
# Job systems whose `apply_link` reads past the host and path, so the strict
# host-and-path match below never sees them: Jibe's and SuccessFactors' patterns
# end in their query mark, and TikTok's ends mid-path. They were dropped when
# board_keys replaced build_boards' tokens(), which matched the whole link, and
# their boards stopped reaching boards.csv (KAN-424). Each is matched from the
# start of the whole link, never searched for inside it.
WHOLE_LINK = ("tiktok", "jibe", "successfactors")
GREENHOUSE_HOSTS = {
    "boards.greenhouse.io",
    "job-boards.greenhouse.io",
    "boards.eu.greenhouse.io",
    "job-boards.eu.greenhouse.io",
}


def board_keys(url: str) -> list[tuple[str, str]]:
    """Return the board named by an actual ATS URL, preserving provider case rules."""
    try:
        parts = urlsplit(url)
        if parts.scheme not in {"http", "https"} or not parts.hostname:
            return []
        if parts.username or parts.password or parts.port not in {None, 80, 443}:
            return []
    except ValueError:
        return []
    # Browser/server normalization must not turn a link naming this board into
    # a different board. Ordinary escaped characters in job titles remain valid.
    segments = [unquote(segment) for segment in parts.path.split("/")]
    if any(segment in {".", ".."} or "/" in segment or "\\" in segment for segment in segments):
        return []
    host = parts.hostname.lower()
    if host in GREENHOUSE_HOSTS and parts.path == "/embed/job_app":
        names = parse_qs(parts.query, keep_blank_values=True).get("for", [])
        if len(names) != 1 or not re.fullmatch(r"[a-zA-Z0-9_-]+", names[0]):
            return []
        return [("greenhouse", names[0].lower())]

    # The query rides along because Jibe and SuccessFactors name themselves
    # there (`?icims=1`, `?ats=successfactors`). Matching stays anchored at
    # the host, so a link inside the query still names nothing.
    address = host + parts.path + (f"?{parts.query}" if parts.query else "")
    for ats, provider in PROVIDERS.items():
        # Some registry patterns include // to anchor a company subdomain,
        # others start at the ATS host. Match at the beginning in either case.
        for prefix in ("", "//"):
            text = prefix + address
            match = provider.apply_link.match(text)
            if match is None or match.end() < len(prefix + host):
                continue
            if not _ends_cleanly(text, match.end(), len(prefix + host + parts.path)):
                continue
            token = "/".join(group for group in match.groups() if group)
            return [(ats, token if provider.keeps_case else token.lower())]
    if match := WORKDAY_SITE.match("//" + address):
        if ("//" + address)[match.end() : match.end() + 1] not in {"", "/"}:
            return []
        wd, tenant, site = match.groups()
        return [("workday", f"{tenant}.{wd}/{site}".lower())]
    whole = "//" + address + ("?" + parts.query if parts.query else "")
    for ats in WHOLE_LINK:
        if match := PROVIDERS[ats].apply_link.match(whole):
            token = "/".join(group for group in match.groups() if group)
            return [(ats, token if PROVIDERS[ats].keeps_case else token.lower())]
    return []


def _ends_cleanly(text: str, end: int, path_end: int) -> bool:
    """Whether a match stops at a boundary rather than mid-name, so
    `jobs.ashbyhq.com/acme@x` names no board: at a slash or the end, where
    the path ends, at the next query flag, or on a pattern's own closing
    slash (TikTok's `lifeattiktok.com/`)."""
    after = text[end : end + 1]
    return (
        after in {"", "/"}
        or end == path_end
        or (end > path_end and after == "&")
        or text[end - 1] == "/"
    )
