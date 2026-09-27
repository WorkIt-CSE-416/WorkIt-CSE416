"""Scrape every board in boards.csv, then write jobs.json and the page.

    python3 -m workit_scraper              # scrape live, then render
    python3 -m workit_scraper --offline    # skip the network, render from jobs.json

Politeness lives here, not in the fetchers: robots.txt is checked once per origin per
run, Crawl-delay is respected by serialising the origins that ask for it, and no more
than eight boards are in flight at a time.

jobs.json is the whole store. It carries first_seen_at across runs, and it is
committed, so it is also the offline fallback -- which is why it is written with
sorted keys: a re-run should produce a readable diff, not a reshuffled file.
"""

from __future__ import annotations

import argparse
import csv
import json
import sys
import threading
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from dataclasses import asdict, replace
from datetime import UTC, datetime
from pathlib import Path
from urllib.parse import urlsplit
from urllib.robotparser import RobotFileParser

from workit_scraper import providers, report
from workit_scraper.providers import USER_AGENT, BoardNotFound, Job
from workit_scraper.shortlist import classify, pick

ROOT = Path(__file__).resolve().parent.parent
BOARDS_CSV = ROOT / "boards.csv"
JOBS_JSON = ROOT / "jobs.json"
PAGE_HTML = ROOT / "internships.html"
MAX_IN_FLIGHT = 8


class Robots:
    """robots.txt per origin, fetched once per run.

    RFC 9309: a 4xx means there are no rules, a 5xx means assume disallowed for the
    whole run. Fetched with our own User-Agent rather than RobotFileParser.read(),
    because some hosts 403 the default urllib agent and a 403 here would silently
    read as "no rules".
    """

    def __init__(self) -> None:
        self._parsers: dict[str, RobotFileParser | None] = {}
        self._locks: dict[str, threading.Lock] = {}
        self._guard = threading.Lock()

    def _parser(self, origin: str) -> RobotFileParser | None:
        with self._guard:
            if origin in self._parsers:
                return self._parsers[origin]
        parser = RobotFileParser()
        try:
            request = urllib.request.Request(
                f"{origin}/robots.txt", headers={"User-Agent": USER_AGENT}
            )
            with urllib.request.urlopen(request, timeout=15) as response:
                parser.parse(response.read().decode("utf-8", "replace").splitlines())
        except urllib.error.HTTPError as error:
            if error.code >= 500:
                parser = None  # disallow everything from this origin this run
            else:
                parser.parse([])  # 4xx: no rules published
        except Exception:
            parser.parse([])
        with self._guard:
            self._parsers[origin] = parser
            self._locks.setdefault(origin, threading.Lock())
        return parser

    def allows(self, url: str) -> bool:
        origin = f"{urlsplit(url).scheme}://{urlsplit(url).netloc}"
        parser = self._parser(origin)
        return parser is not None and parser.can_fetch(USER_AGENT, url)

    def pace(self, url: str) -> None:
        """Honour Crawl-delay by holding the origin's lock for the stated delay."""
        origin = f"{urlsplit(url).scheme}://{urlsplit(url).netloc}"
        parser = self._parser(origin)
        delay = parser.crawl_delay(USER_AGENT) if parser else None
        if not delay:
            return
        with self._guard:
            lock = self._locks.setdefault(origin, threading.Lock())
        with lock:
            time.sleep(float(delay))


def load_boards(path: Path) -> list[tuple[str, str, str]]:
    with path.open(newline="", encoding="utf-8") as handle:
        rows = list(csv.DictReader(handle))
    boards = []
    for row in rows:
        ats = (row.get("ats") or "").strip()
        token = (row.get("token") or "").strip()
        if not ats or not token:
            continue
        boards.append((ats, token, (row.get("company") or token).strip()))
    return boards


def scrape(boards: list[tuple[str, str, str]]) -> tuple[list[Job], dict[str, int]]:
    robots = Robots()
    stats = {"postings": 0, "boards_ok": 0, "boards_missing": 0, "boards_skipped": 0,
             "boards_failed": 0}
    lock = threading.Lock()
    collected: list[Job] = []

    def one(board: tuple[str, str, str]) -> None:
        ats, token, company = board
        fetcher = providers.FETCHERS.get(ats)
        if fetcher is None:
            print(f"  ?  {ats}/{token}: no fetcher for this provider", file=sys.stderr)
            with lock:
                stats["boards_skipped"] += 1
            return
        url = providers.listing_url(ats, token)
        if not robots.allows(url):
            print(f"  -  {ats}/{token}: skipped, robots.txt disallows us")
            with lock:
                stats["boards_skipped"] += 1
            return
        robots.pace(url)
        try:
            jobs = fetcher(token, company)
        except BoardNotFound:
            print(f"  x  {ats}/{token}: no such board")
            with lock:
                stats["boards_missing"] += 1
            return
        except Exception as error:  # noqa: BLE001 - one bad board must not end the run
            print(f"  !  {ats}/{token}: {type(error).__name__}: {error}", file=sys.stderr)
            with lock:
                stats["boards_failed"] += 1
            return
        with lock:
            collected.extend(jobs)
            stats["postings"] += len(jobs)
            stats["boards_ok"] += 1
        print(f"  ok {ats}/{token}: {len(jobs)} postings")

    with ThreadPoolExecutor(MAX_IN_FLIGHT) as pool:
        list(pool.map(one, boards))
    return collected, stats


def merge(fresh: list[Job], previous: dict[str, dict], now: str) -> list[Job]:
    """Stamp last_seen_at, and carry first_seen_at forward from any earlier run.

    ponytail: nothing is ever closed. A posting that vanishes keeps its last
    last_seen_at and stays in the file -- the safe direction, since it cannot wrongly
    retire a live job. Add the two-miss sweep rule when something needs to close.
    """
    merged = []
    for job in fresh:
        first_seen = (previous.get(job.key) or {}).get("first_seen_at") or now
        merged.append(replace(job, first_seen_at=first_seen, last_seen_at=now))
    seen = {job.key for job in fresh}
    for key, row in previous.items():
        if key not in seen:
            merged.append(Job(**{k: v for k, v in row.items() if k != "key"}))
    return merged


def read_jobs_json(path: Path) -> dict[str, dict]:
    if not path.exists():
        return {}
    payload = json.loads(path.read_text(encoding="utf-8"))
    return {row["key"]: row for row in payload.get("jobs", [])}


def write_jobs_json(jobs: list[Job], stats: dict[str, int], path: Path, now: str) -> None:
    rows = []
    for job in sorted(jobs, key=lambda item: item.key):
        row = asdict(job)
        row["tags"] = list(job.tags)
        row["key"] = job.key
        rows.append(row)
    path.write_text(
        json.dumps({"scraped_at": now, "stats": stats, "jobs": rows}, indent=1, sort_keys=True)
        + "\n",
        encoding="utf-8",
    )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="workit_scraper", description=__doc__)
    parser.add_argument(
        "--offline", action="store_true", help="skip the network; render from jobs.json"
    )
    parser.add_argument("--boards", type=Path, default=BOARDS_CSV)
    args = parser.parse_args(argv)

    now = datetime.now(UTC).isoformat()
    previous = read_jobs_json(JOBS_JSON)

    if args.offline:
        if not previous:
            print(f"--offline needs {JOBS_JSON.name}, which does not exist yet.", file=sys.stderr)
            return 1
        stored = json.loads(JOBS_JSON.read_text(encoding="utf-8"))
        jobs = [Job(**{k: v for k, v in row.items() if k != "key"}) for row in stored["jobs"]]
        stats = stored.get("stats", {})
        print(f"offline: {len(jobs)} postings from {JOBS_JSON.name}")
    else:
        boards = load_boards(args.boards)
        print(f"scraping {len(boards)} boards\n")
        scanned, stats = scrape(boards)
        # Store only what the page is about. Keeping all ~7,800 postings -- the sales,
        # marketing and senior roles included -- made jobs.json 4 MB and told us
        # nothing we display. `stats["postings"]` still counts everything scanned, so
        # the funnel on the page stays honest about how wide the net was.
        fresh = [
            replace(job, tags=tags) for job in scanned if (tags := classify(job.title))
        ]
        stats["kept"] = len(fresh)
        jobs = merge(fresh, previous, now)
        write_jobs_json(jobs, stats, JOBS_JSON, now)

    roles = pick(jobs)
    report.write_html(roles, stats, PAGE_HTML)

    print(
        f"\n{stats.get('postings', 0):,} postings -> {len(roles)} distinct roles"
        f"  ({stats.get('boards_ok', 0)} boards read,"
        f" {stats.get('boards_missing', 0)} not found,"
        f" {stats.get('boards_skipped', 0)} skipped)"
    )
    print(f"wrote {PAGE_HTML}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
