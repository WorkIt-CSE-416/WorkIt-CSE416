"""robots.txt and pacing: the part of a scrape that keeps us a guest.

Every origin a run will touch is known before the first request -- it is just the
hosts of the URLs the caller is about to fetch -- so `Robots` reads every robots.txt
up front on the calling thread. After construction it is read-only apart from the
per-origin pacing locks, which is what lets worker threads share it without a guard.
"""

from __future__ import annotations

import threading
import time
import urllib.error
from collections.abc import Iterable
from urllib.robotparser import RobotFileParser

from workit_scraper import web

#: Minimum gap between requests to one origin when its robots.txt names no Crawl-delay.
DEFAULT_DELAY_S = 0.1


def _read_robots(origin: str) -> RobotFileParser | None:
    """The origin's rules, or None when it must be treated as disallowing us.

    RFC 9309 section 2.3.1: a 4xx means there are no rules. A 5xx, or a robots.txt we
    could not reach at all, means assume complete disallow -- an outage is not
    permission. Fetched through `web.get` rather than RobotFileParser.read(), because
    some hosts 403 the default urllib agent and a 403 here would read as "no rules".
    """
    parser = RobotFileParser()
    try:
        body = web.get(f"{origin}/robots.txt", timeout=15)
    except urllib.error.HTTPError as error:
        if 400 <= error.code < 500:
            parser.parse([])
            return parser
        return None
    except OSError:  # DNS, refused connection, timeout: unreachable
        return None
    parser.parse(body.decode("utf-8", "replace").splitlines())
    return parser


class Robots:
    """robots.txt per origin, fetched once per run, for exactly the URLs given."""

    def __init__(self, urls: Iterable[str]) -> None:
        origins = {web.origin(url) for url in urls}
        self._parsers = {origin: _read_robots(origin) for origin in origins}
        self._locks = {origin: threading.Lock() for origin in origins}

    def allows(self, url: str) -> bool:
        parser = self._parsers[web.origin(url)]
        return parser is not None and parser.can_fetch(web.USER_AGENT, url)

    def pace(self, url: str) -> None:
        """Hold the origin's lock for its Crawl-delay, or for our own default.

        Every origin is paced, not only those that publish a Crawl-delay: Greenhouse
        publishes none, and at eight in flight against ~130 ms responses we would run
        at roughly 60 requests a second across a 1,800-board sweep. DEFAULT_DELAY_S
        caps each origin near ten requests a second.
        """
        origin = web.origin(url)
        parser = self._parsers[origin]
        stated = parser.crawl_delay(web.USER_AGENT) if parser else None
        with self._locks[origin]:
            time.sleep(float(stated) if stated else DEFAULT_DELAY_S)
