"""The one way this package makes an HTTP request.

Every request carries our User-Agent, and none follows a redirect to another
origin: robots.txt is checked per origin, so a redirect elsewhere would land us
somewhere we never asked permission to be. Almost everything is a GET; Workday's
careers pages list a board with a POST of a JSON search (`post`), so that is here
too, under the same rules.
"""

from __future__ import annotations

import json
import urllib.error
import urllib.request
from urllib.parse import urlsplit

USER_AGENT = "workit-scraper/0.1 (CSE416 course project; +https://github.com/WorkIt-CSE-416)"


def origin(url: str) -> str:
    parts = urlsplit(url)
    return f"{parts.scheme}://{parts.netloc}"


class _SameOriginRedirects(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        if origin(newurl) != origin(req.full_url):
            raise urllib.error.HTTPError(
                newurl, code, f"refused cross-origin redirect to {newurl}", headers, fp
            )
        return super().redirect_request(req, fp, code, msg, headers, newurl)


_OPENER = urllib.request.build_opener(_SameOriginRedirects)


def get(url: str, *, timeout: float) -> bytes:
    """GET `url` and return the body. HTTP errors propagate as `HTTPError`."""
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with _OPENER.open(request, timeout=timeout) as response:
        return response.read()


def post(
    url: str, payload: object, *, timeout: float, headers: dict[str, str] | None = None
) -> bytes:
    """POST `payload` as JSON to `url` and return the body. HTTP errors propagate
    as `HTTPError`. Same User-Agent and same-origin rule as `get`; `headers` adds
    any a provider's search needs (TikTok's `website-path`)."""
    request = urllib.request.Request(
        url,
        data=json.dumps(payload).encode(),
        method="POST",
        headers={
            "User-Agent": USER_AGENT,
            "Content-Type": "application/json",
            "Accept": "application/json",
            **(headers or {}),
        },
    )
    with _OPENER.open(request, timeout=timeout) as response:
        return response.read()
