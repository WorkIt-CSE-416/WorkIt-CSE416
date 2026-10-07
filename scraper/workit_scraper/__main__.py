"""Scrape every board in boards.csv, then write jobs.json and the page.

    python3 -m workit_scraper              # scrape live, then render
    python3 -m workit_scraper --offline    # skip the network, render from jobs.json

No more than eight boards are in flight at a time, and every fetch goes through
`polite.Robots` first. The store itself is `store.py`.
"""

from __future__ import annotations

import argparse
import csv
import sys
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from dataclasses import replace
from datetime import UTC, datetime
from enum import Enum, auto
from pathlib import Path

from workit_scraper import feed, logos, providers, report, store
from workit_scraper.polite import Robots
from workit_scraper.providers import Board, BoardNotFound, Job
from workit_scraper.shortlist import classify, pick
from workit_scraper.store import RunStats

ROOT = Path(__file__).resolve().parent.parent
BOARDS_CSV = ROOT / "boards.csv"
JOBS_JSON = ROOT / "jobs.json"
PAGE_HTML = ROOT / "internships.html"
FEED_JSON = ROOT / "feed.json"
MAX_IN_FLIGHT = 8


class Outcome(Enum):
    OK = auto()
    MISSING = auto()
    SKIPPED = auto()
    FAILED = auto()


def load_boards(path: Path) -> list[Board]:
    with path.open(newline="", encoding="utf-8") as handle:
        # boards.csv opens with `#` provenance lines naming where the slugs came from
        # (see build_boards.py). DictReader would take the first of them as the header.
        rows = list(csv.DictReader(line for line in handle if not line.startswith("#")))
    boards = []
    for row in rows:
        ats = (row.get("ats") or "").strip()
        token = (row.get("token") or "").strip()
        if not ats or not token:
            continue
        boards.append(Board(ats, token, (row.get("company") or token).strip()))
    return boards


def _scrape_one(board: Board, robots: Robots) -> tuple[Outcome, list[Job]]:
    fetcher = providers.FETCHERS.get(board.ats)
    if fetcher is None:
        print(f"  ?  {board.key}: no fetcher for this provider", file=sys.stderr)
        return Outcome.SKIPPED, []
    url = providers.listing_url(board.ats, board.token)
    if not robots.allows(url):
        print(f"  -  {board.key}: skipped, robots.txt disallows us")
        return Outcome.SKIPPED, []
    robots.pace(url)
    try:
        jobs = fetcher(board.token, board.company)
    except BoardNotFound:
        print(f"  x  {board.key}: no such board")
        return Outcome.MISSING, []
    except Exception as error:  # noqa: BLE001 - one bad board must not end the run
        print(f"  !  {board.key}: {type(error).__name__}: {error}", file=sys.stderr)
        return Outcome.FAILED, []
    print(f"  ok {board.key}: {len(jobs)} postings")
    return Outcome.OK, jobs


def scrape(boards: list[Board], robots: Robots) -> tuple[list[Job], RunStats, list[str]]:
    """Every posting scanned, what happened, and the keys of the boards read in full."""
    with ThreadPoolExecutor(MAX_IN_FLIGHT) as pool:
        results = list(pool.map(lambda board: _scrape_one(board, robots), boards))
    scanned = [job for _, jobs in results for job in jobs]
    outcomes = Counter(outcome for outcome, _ in results)
    stats = RunStats(
        postings=len(scanned),
        boards_ok=outcomes[Outcome.OK],
        boards_missing=outcomes[Outcome.MISSING],
        boards_skipped=outcomes[Outcome.SKIPPED],
        boards_failed=outcomes[Outcome.FAILED],
    )
    read = [
        board.key
        for board, (outcome, _) in zip(boards, results, strict=True)
        if outcome is Outcome.OK
    ]
    return scanned, stats, read


def _describe_one(job: Job, robots: Robots) -> Job:
    url = providers.greenhouse_job_url(job.token, job.external_id)
    if not robots.allows(url):
        return job
    robots.pace(url)
    try:
        return providers.describe_greenhouse(job)
    except Exception as error:  # noqa: BLE001 - a missing description is not a failed run
        print(f"  !  {job.key}: no description: {type(error).__name__}: {error}", file=sys.stderr)
        return job


def describe(jobs: list[Job], robots: Robots) -> list[Job]:
    """Fill in the description of every Greenhouse posting that lacks one.

    Only Greenhouse needs this -- Lever and Ashby send descriptions with the list --
    and only once per posting, since the store carries a description forward.
    """
    todo = [job for job in jobs if job.ats == "greenhouse" and job.description is None]
    if not todo:
        return jobs
    print(f"\ndescribing {len(todo)} Greenhouse postings")
    with ThreadPoolExecutor(MAX_IN_FLIGHT) as pool:
        described = {job.key: job for job in pool.map(lambda job: _describe_one(job, robots), todo)}
    return [described.get(job.key, job) for job in jobs]


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="workit_scraper", description=__doc__)
    parser.add_argument(
        "--offline", action="store_true", help="skip the network; render from jobs.json"
    )
    parser.add_argument("--boards", type=Path, default=BOARDS_CSV)
    args = parser.parse_args(argv)

    previous = store.load(JOBS_JSON)

    if args.offline:
        if previous is None:
            print(f"--offline needs {JOBS_JSON.name}, which does not exist yet.", file=sys.stderr)
            return 1
        run = previous
        print(f"offline: {len(run.jobs)} postings from {JOBS_JSON.name}")
    else:
        boards = load_boards(args.boards)
        print(f"scraping {len(boards)} boards\n")
        # Every origin a run touches, so robots.txt is read once, up front. Greenhouse
        # postings' own pages share their board list's origin.
        robots = Robots(
            providers.listing_url(board.ats, board.token)
            for board in boards
            if board.ats in providers.FETCHERS
        )
        scanned, stats, read = scrape(boards, robots)
        # Store only what the page is about. Keeping all ~91,000 postings -- the sales,
        # marketing and senior roles included -- would make jobs.json tens of megabytes
        # and tell us nothing we display. `stats.postings` still counts everything
        # scanned, so the funnel on the page stays honest about how wide the net was.
        fresh = [job for job in scanned if classify(job.title)]
        stats = replace(stats, kept=len(fresh))
        run = store.update(previous, fresh, read, stats, datetime.now(UTC).isoformat())
        run = replace(run, jobs=describe(run.jobs, robots))
        # Only boards with a job on the page need a logo, and each is read once.
        unread = sorted(
            {
                (j.ats, j.token, j.company)
                for j in run.jobs
                if run.is_listed(j) and j.board_key not in run.logos
            }
        )
        print(f"\nreading {len(unread)} board pages for logos")
        run = replace(run, logos={**run.logos, **logos.fetch(unread)})
        store.save(run, JOBS_JSON)

    roles = pick([job for job in run.jobs if run.is_listed(job)], is_new=run.is_new)
    report.write_html(roles, run.stats, PAGE_HTML, run.scraped_at, counts_new=run.counts_new)
    feed.write(roles, run.logos, FEED_JSON)

    print(
        f"\n{run.stats.postings:,} postings -> {len(roles)} distinct roles"
        f"  ({run.stats.boards_ok} boards read,"
        f" {run.stats.boards_missing} not found,"
        f" {run.stats.boards_skipped} skipped,"
        f" {run.stats.boards_failed} failed)"
    )
    print(f"wrote {PAGE_HTML} and {FEED_JSON.name}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
