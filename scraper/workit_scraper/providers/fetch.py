"""The requests a reader makes, through `web`, and the dates they carry. Readers
call these through the module (`fetch._get_json`), so a test that swaps one
swaps it for every reader."""

from __future__ import annotations

import json
import time
import urllib.error
from collections.abc import Callable
from datetime import UTC, datetime

from workit_scraper import web
from workit_scraper.providers.model import BoardNotFound

TIMEOUT_S = 25


def _get_json(url: str) -> object:
    """GET and parse JSON, with one retry on a 5xx, a 429 or an explicit Retry-After.

    A 404 becomes `BoardNotFound`; every other failure propagates, because a board
    we could not read is not a board we know anything about.
    """
    return _json(url, lambda: web.get(url, timeout=TIMEOUT_S))


def _post_json(url: str, payload: object) -> object:
    """`_get_json` for a POST: Workday's list. A 429 is retried once too, since
    five of ~1,700 Workday boards answered one on the first full sweep."""
    return _json(url, lambda: web.post(url, payload, timeout=TIMEOUT_S))


def _get_text(url: str) -> str:
    """`_get_json` for a page that is not JSON: iCIMS's sitemap and job pages."""
    return _fetched(url, lambda: web.get(url, timeout=TIMEOUT_S)).decode("utf-8", "replace")


def _json(url: str, fetch: Callable[[], bytes]) -> object:
    return json.loads(_fetched(url, fetch))


def _fetched(url: str, fetch: Callable[[], bytes]) -> bytes:
    for attempt in (1, 2):
        try:
            return fetch()
        except urllib.error.HTTPError as error:
            if error.code == 404:
                raise BoardNotFound(url) from error
            retry_after = error.headers.get("Retry-After") if error.headers else None
            if attempt == 2 or (error.code < 500 and error.code != 429 and not retry_after):
                raise
            time.sleep(min(float(retry_after), 30) if retry_after and retry_after.isdigit() else 2)
    raise AssertionError("unreachable")


def _iso(value: object) -> str | None:
    """Normalise a provider timestamp to an ISO 8601 UTC string, or None.

    Greenhouse and Ashby send ISO strings. Lever sends epoch milliseconds, and sends
    them as an int in some records and a numeric string in others -- so this accepts
    `object` and narrows, rather than trusting either provider's type discipline.
    Workable and BambooHR send a bare date ("2026-05-29") and Recruitee
    "2026-10-08 10:34:56 UTC": a time with no zone is UTC, never this machine's.
    """
    if value is None or value == "":
        return None
    if isinstance(value, bool):
        return None
    if isinstance(value, int | float):
        return datetime.fromtimestamp(value / 1000, UTC).isoformat()
    if not isinstance(value, str):
        return None
    if value.isdigit():
        return datetime.fromtimestamp(int(value) / 1000, UTC).isoformat()
    try:
        parsed = datetime.fromisoformat(value.removesuffix(" UTC"))
    except ValueError:
        return None
    return (parsed if parsed.tzinfo else parsed.replace(tzinfo=UTC)).astimezone(UTC).isoformat()
