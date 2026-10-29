"""The requests a reader makes, through `web`, and the dates they carry. Readers
call these through the module (`fetch._get_json`), so a test that swaps one
swaps it for every reader."""

from __future__ import annotations

import json
import sys
import threading
import time
import urllib.error
from collections.abc import Callable
from datetime import UTC, datetime

from workit_scraper import web
from workit_scraper.providers.model import BoardNotFound

TIMEOUT_S = 25
#: A 429 holds every request to its host (`_hold`): for its Retry-After, else
#: HOLD_FIRST seconds, doubling on each 429 after the hold is up, to HOLD_LONGEST.
HOLD_FIRST = 1.0
HOLD_LONGEST = 60.0

#: Keyed by `polite._pace_key`: when each held host may be asked again, on
#: `time.monotonic`, and how long its last hold was.
_holds: dict[str, tuple[float, float]] = {}
_holding = threading.Lock()


def _get_json(url: str) -> object:
    """GET and parse JSON, with one retry on a 5xx, a 429 or an explicit Retry-After.
    A 429 also holds every request to its host for a while (`_hold`).

    A 404 becomes `BoardNotFound`; every other failure propagates, because a board
    we could not read is not a board we know anything about. A paged reader turns
    one after its first request into `Incomplete`: a page that is not there says
    nothing about the board.
    """
    return _json(url, lambda: web.get(url, timeout=TIMEOUT_S))


def _post_json(url: str, payload: object, headers: dict[str, str] | None = None) -> object:
    """`_get_json` for a POST: Workday's and TikTok's lists. A 429 is retried once
    too, since five of ~1,700 Workday boards answered one on the first full sweep.
    `headers` adds any a search needs (TikTok's `website-path`)."""
    return _json(url, lambda: web.post(url, payload, timeout=TIMEOUT_S, headers=headers))


def _get_text(url: str) -> str:
    """`_get_json` for a page that is not JSON: iCIMS's sitemap and job pages,
    SuccessFactors' search and job pages."""
    return _fetched(url, lambda: web.get(url, timeout=TIMEOUT_S)).decode("utf-8", "replace")


def _json(url: str, fetch: Callable[[], bytes]) -> object:
    return json.loads(_fetched(url, fetch))


def _fetched(url: str, fetch: Callable[[], bytes]) -> bytes:
    host = _host(url)
    for attempt in (1, 2):
        _wait_out(host)
        try:
            body = fetch()
        except urllib.error.HTTPError as error:
            if error.code == 404:
                raise BoardNotFound(url) from error
            retry_after = error.headers.get("Retry-After") if error.headers else None
            if error.code == 429:
                _hold(host, retry_after)
            if attempt == 2 or (error.code < 500 and error.code != 429 and not retry_after):
                raise
            if error.code != 429:
                time.sleep(
                    min(float(retry_after), 30) if retry_after and retry_after.isdigit() else 2
                )
            continue
        _release(host)
        return body
    raise AssertionError("unreachable")


def _host(url: str) -> str:
    # Imported here: polite reads PROVIDERS, which is still being built when this
    # module is first imported.
    from workit_scraper.polite import _pace_key

    return _pace_key(web.origin(url))


def _hold(host: str, retry_after: str | None) -> None:
    """Hold every request to `host` after it answered 429, as Freehire does.

    One 429 used to cost only the board that got it: its one retry, two seconds
    later, while the lane's other workers kept asking the same host. A Workday
    tenant's 429 now holds all of myworkdayjobs.com, which shares one pace
    (`polite.SHARED_PACE`). A 429 during a hold is the same burst, so it counts
    once and does not lengthen it.
    """
    now = time.monotonic()
    with _holding:
        until, length = _holds.get(host, (0.0, 0.0))
        if until > now:
            return
        if retry_after and retry_after.isdigit():
            length = min(float(retry_after), HOLD_LONGEST)
        else:
            length = min(length * 2, HOLD_LONGEST) if length else HOLD_FIRST
        _holds[host] = (now + length, length)
    print(f"  ~  {host}: 429, every request there waits {length:.0f}s", file=sys.stderr)


def _wait_out(host: str) -> None:
    until, _ = _holds.get(host, (0.0, 0.0))
    if (wait := until - time.monotonic()) > 0:
        time.sleep(wait)


def _release(host: str) -> None:
    """A success after the hold is up starts the next hold at HOLD_FIRST again. One
    from a request sent before the hold began leaves the hold alone."""
    with _holding:
        if (held := _holds.get(host)) and held[0] <= time.monotonic():
            del _holds[host]


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
