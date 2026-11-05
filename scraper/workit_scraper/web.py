"""The one way this package makes an HTTP request.

Every request carries our User-Agent, and none follows a redirect to another
origin: robots.txt is checked per origin, so a redirect elsewhere would land us
somewhere we never asked permission to be. Almost everything is a GET; Workday's
careers pages list a board with a POST of a JSON search (`post`), so that is here
too, under the same rules.
"""

from __future__ import annotations

import json
import threading
import urllib.error
import urllib.request
from urllib.parse import urlsplit

USER_AGENT = "workit-scraper/0.1 (+https://github.com/workitjobs)"


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

_lock = threading.Lock()
_requests = 0
_received_bytes = 0


def stats() -> dict[str, int]:
    """Thread-safe snapshot of request and byte counters since import. `requests`
    counts every request sent, failed ones (429, 5xx, 404, timeouts) included;
    `received_bytes` counts the bodies of the ones that succeeded."""
    with _lock:
        return {"requests": _requests, "received_bytes": _received_bytes}


def _send(request: urllib.request.Request, timeout: float) -> bytes:
    """Open `request` and return the body, counting it before it is sent, so a
    request that raises is still counted."""
    global _requests, _received_bytes
    with _lock:
        _requests += 1
    with _OPENER.open(request, timeout=timeout) as response:
        body = response.read()
    with _lock:
        _received_bytes += len(body)
    return body


def get(url: str, *, timeout: float, headers: dict[str, str] | None = None) -> bytes:
    """GET `url` and return the body. HTTP errors propagate as `HTTPError`."""
    request = urllib.request.Request(url, headers={**(headers or {}), "User-Agent": USER_AGENT})
    return _send(request, timeout)


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
    return _send(request, timeout)
