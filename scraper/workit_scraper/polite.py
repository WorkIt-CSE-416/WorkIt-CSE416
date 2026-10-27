"""robots.txt and pacing: the part of a scrape that keeps us a guest.

Most origins a run will touch are known before the first request -- they are just
the hosts of the URLs the caller is about to fetch -- so `Robots` reads those
robots.txt files up front on the calling thread. An origin it was not given is read
the first time a worker asks about it, once, paced like any other request: Workday
gives each company its own host, ~1,500 of them, and a run reads only some of their
boards (`__main__.LANE_BUDGET_S`), so reading all of them up front would cost
minutes for files the run never needs.
"""

from __future__ import annotations

import threading
import time
import urllib.error
from collections.abc import Iterable
from urllib.parse import urlsplit
from urllib.robotparser import RobotFileParser

from workit_scraper import web

#: Minimum gap between requests to one origin when its robots.txt names no Crawl-delay.
DEFAULT_DELAY_S = 0.1

#: Providers that give each company its own subdomain (`acme.bamboohr.com`): one
#: origin, and one robots.txt, per board, but one provider's servers behind them
#: all. Their origins share one pace, so a lane of eight workers reads BambooHR
#: as gently as it reads Greenhouse's single host, not eight hosts' worth.
#: Workday (`nvidia.wd5.myworkdayjobs.com`) is one pace across all its data
#: centres, the cautious reading: ten requests a second to Workday as a whole.
#: Oracle Recruiting Cloud (`ecnf.fa.us2.oraclecloud.com`) is one pace the same way.
SHARED_PACE = ("bamboohr.com", "recruitee.com", "myworkdayjobs.com", "oraclecloud.com")

#: Hosts whose paths are case-insensitive, so their robots.txt is too. Workday
#: serves `/NVIDIAExternalCareerSite/` and `/nvidiaexternalcareersite/` alike, and
#: `build_boards.py` lower-cases every slug, so a rule written `Disallow:
#: /CaterpillarCareers/` must still stop a request for `/caterpillarcareers/`.
FOLD_CASE = ("myworkdayjobs.com",)


def _pace_key(origin: str) -> str:
    host = urlsplit(origin).hostname or ""
    return next((domain for domain in SHARED_PACE if host.endswith(f".{domain}")), origin)


def _folds(origin: str) -> bool:
    host = urlsplit(origin).hostname or ""
    return any(host.endswith(f".{domain}") for domain in FOLD_CASE)


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
    text = body.decode("utf-8", "replace")
    parser.parse((text.lower() if _folds(origin) else text).splitlines())
    return parser


class Robots:
    """robots.txt per origin, fetched once per run: the URLs given up front, and any
    other origin the first time it is asked about."""

    def __init__(self, urls: Iterable[str] = ()) -> None:
        origins = {web.origin(url) for url in urls}
        self._parsers = {origin: _read_robots(origin) for origin in origins}
        self._locks = {_pace_key(origin): threading.Lock() for origin in origins}
        # One per origin read late, so two workers asking at once read it once.
        # `dict.setdefault` is atomic, which is all the guarding these need.
        self._reading: dict[str, threading.Lock] = {}

    def _rules(self, origin: str) -> RobotFileParser | None:
        if origin not in self._parsers:
            with self._reading.setdefault(origin, threading.Lock()):
                if origin not in self._parsers:
                    self._wait(origin, None)
                    self._parsers[origin] = _read_robots(origin)
        return self._parsers[origin]

    def allows(self, url: str) -> bool:
        origin = web.origin(url)
        parser = self._rules(origin)
        return parser is not None and parser.can_fetch(
            web.USER_AGENT, url.lower() if _folds(origin) else url
        )

    def pace(self, url: str) -> None:
        """Hold the origin's lock for its Crawl-delay, or for our own default.

        Every origin is paced, not only those that publish a Crawl-delay: Greenhouse
        publishes none, and at eight in flight against ~130 ms responses we would run
        at roughly 60 requests a second across a 1,800-board sweep. DEFAULT_DELAY_S
        caps each origin near ten requests a second, and each `SHARED_PACE` provider
        as a whole.
        """
        origin = web.origin(url)
        self._wait(origin, self._rules(origin))

    def _wait(self, origin: str, parser: RobotFileParser | None) -> None:
        stated = parser.crawl_delay(web.USER_AGENT) if parser else None
        with self._locks.setdefault(_pace_key(origin), threading.Lock()):
            time.sleep(float(stated) if stated else DEFAULT_DELAY_S)
