"""Recognize one public ATS board/posting URL using the provider registry.

Both discovery commands use this boundary. Query text is not scanned for links;
the Greenhouse embed route is the one explicit query-based board identifier.
"""

from __future__ import annotations

import re
from urllib.parse import parse_qs, urlsplit

from workit_scraper.providers.registry import PROVIDERS

# Workday's alternate public host names the same tenant/site as myworkdayjobs.
WORKDAY_SITE = re.compile(
    r"//(wd\d+)\.myworkdaysite\.com/(?:[a-z]{2}(?:-[a-z]{2})?/)?"
    r"recruiting/([a-z0-9-]+)/([a-z0-9_-]+)",
    re.I,
)
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
    host = parts.hostname.lower()
    if host in GREENHOUSE_HOSTS and parts.path == "/embed/job_app":
        names = parse_qs(parts.query, keep_blank_values=True).get("for", [])
        if len(names) != 1 or not re.fullmatch(r"[a-zA-Z0-9_-]+", names[0]):
            return []
        return [("greenhouse", names[0].lower())]

    address = host + parts.path
    for ats, provider in PROVIDERS.items():
        # Some registry patterns include // to anchor a company subdomain,
        # others start at the ATS host. Match at the beginning in either case.
        for prefix in ("", "//"):
            match = provider.apply_link.match(prefix + address)
            if match is None or match.end() < len(prefix + host):
                continue
            token = "/".join(group for group in match.groups() if group)
            return [(ats, token if provider.keeps_case else token.lower())]
    if match := WORKDAY_SITE.match("//" + address):
        wd, tenant, site = match.groups()
        return [("workday", f"{tenant}.{wd}/{site}".lower())]
    return []
