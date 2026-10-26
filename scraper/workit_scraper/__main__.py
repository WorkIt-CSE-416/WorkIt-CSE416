"""Scrape every board in boards.csv, then write jobs.json and the page.

    python3 -m workit_scraper              # scrape live, then render
    python3 -m workit_scraper --offline    # skip the network, render from jobs.json

No more than eight boards are in flight at a time, and every fetch goes through
`polite.Robots` first. The store itself is `store.py`.
"""

from __future__ import annotations

import argparse
import csv
import json
import sys
import time
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from dataclasses import asdict, replace
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
METRICS_JSON = ROOT / "metrics.json"
MAX_IN_FLIGHT = 8


class Outcome(Enum):
    OK = auto()
    MISSING = auto()
    SKIPPED = auto()
    FAILED = auto()
    DEFERRED = auto()


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
    provider = providers.PROVIDERS.get(board.ats)
    if provider is None:
        print(f"  ?  {board.key}: no fetcher for this provider", file=sys.stderr)
        return Outcome.SKIPPED, []
    url = providers.listing_url(board.ats, board.token)
    if not all(robots.allows(u) for u in providers.robots_urls(board.ats, board.token)):
        print(f"  -  {board.key}: skipped, robots.txt disallows us")
        return Outcome.SKIPPED, []
    robots.pace(url)
    try:
        if provider.paged:
            jobs = provider.read(board.token, board.company, pace=robots.pace)
        else:
            jobs = provider.read(board.token, board.company)
    except BoardNotFound:
        print(f"  x  {board.key}: no such board")
        return Outcome.MISSING, []
    except providers.TooLarge as error:
        print(f"  -  {board.key}: skipped, too large to read whole ({error})")
        return Outcome.SKIPPED, []
    except Exception as error:  # noqa: BLE001 - one bad board must not end the run
        print(f"  !  {board.key}: {type(error).__name__}: {error}", file=sys.stderr)
        return Outcome.FAILED, []
    print(f"  ok {board.key}: {len(jobs)} postings")
    return Outcome.OK, jobs


def _lane(boards: list[Board], robots: Robots, before: dict[str, Job]):
    """One provider's boards, then the own pages of their postings that need one
    (`with_page`) -- so Greenhouse's page reads start when its boards are done,
    not after Lever's. Order is kept, so each board gets its own jobs back.

    A lane with a budget (`Provider.budget_s`) starts no board once it has run out.
    Also returns how long the lane took and how many pages it read, for the run's
    metrics."""
    started = time.monotonic()
    provider = providers.PROVIDERS.get(boards[0].ats) if boards else None
    budget = provider.budget_s if provider else None
    deadline = started + budget if budget is not None else None

    def read(board: Board) -> tuple[Outcome, list[Job]]:
        if deadline is not None and time.monotonic() > deadline:
            return Outcome.DEFERRED, []
        return _scrape_one(board, robots)

    with ThreadPoolExecutor(MAX_IN_FLIGHT) as pool:
        results = list(pool.map(read, boards))
        listed = [store.carry(job, before) for _, jobs in results for job in jobs]
        paged = list(pool.map(lambda job: with_page(job, robots), listed))
    # `with_page` hands back the same posting when it reads nothing.
    pages = sum(1 for was, now in zip(listed, paged, strict=True) if now is not was)
    described = iter(paged)
    results = [(outcome, [next(described) for _ in jobs]) for outcome, jobs in results]
    return results, time.monotonic() - started, pages


def scrape(
    boards: list[Board], robots: Robots, before: dict[str, Job]
) -> tuple[list[Job], RunStats, list[str]]:
    """Every posting scanned, what happened, and the keys of the boards read in full.

    Each provider is its own lane with its own workers. They used to share one pool,
    and a worker waiting out Lever's one-second Crawl-delay was a worker not
    reading Greenhouse: the lanes cut a run from 9.5 minutes to Lever's own pace.
    Each provider's origin is still paced exactly as before (`Robots.pace`).
    """
    lanes: dict[str, list[Board]] = {}
    for board in boards:
        lanes.setdefault(board.ats, []).append(board)
    with ThreadPoolExecutor(max(len(lanes), 1)) as pool:
        by_lane = list(pool.map(lambda lane: _lane(lane, robots, before), lanes.values()))
    outcome_of = {
        board.key: result
        for lane, (results, _, _) in zip(lanes.values(), by_lane, strict=True)
        for board, result in zip(lane, results, strict=True)
    }
    results = [outcome_of[board.key] for board in boards]
    scanned = [job for _, jobs in results for job in jobs]
    outcomes = Counter(outcome for outcome, _ in results)
    stats = RunStats(
        postings=len(scanned),
        boards_ok=outcomes[Outcome.OK],
        boards_missing=outcomes[Outcome.MISSING],
        boards_skipped=outcomes[Outcome.SKIPPED],
        boards_failed=outcomes[Outcome.FAILED],
        boards_deferred=outcomes[Outcome.DEFERRED],
        by_provider={
            ats: {
                "boards": len(lane),
                **Counter(outcome.name.lower() for outcome, _ in lane_results),
                "postings": sum(len(jobs) for _, jobs in lane_results),
                "pages": pages,
                "seconds": round(seconds, 1),
            }
            for (ats, lane), (lane_results, seconds, pages) in zip(
                lanes.items(), by_lane, strict=True
            )
        },
    )
    # A board we hold postings from that now says it does not exist has nothing
    # open: read in full, with none. Not one never read (a typo has nothing to
    # close), and never a failure, which is evidence of nothing.
    known = {job.board_key for job in before.values()}
    read = [
        board.key
        for board, (outcome, _) in zip(boards, results, strict=True)
        if outcome is Outcome.OK or (outcome is Outcome.MISSING and board.key in known)
    ]
    return scanned, stats, read


def with_page(job: Job, robots: Robots) -> Job:
    """The posting with its own page read, if it is a kept Greenhouse, Workable,
    BambooHR or Workday posting with no `Page` under the current PAGE_VERSION;
    otherwise exactly as it was.

    Only those four need this -- Ashby, Lever and Recruitee send it all with the
    list -- and only once per posting, since the store carries the page forward.
    Called on postings a board just listed, so one that has left its board is never
    asked for. A page that fails or is disallowed leaves the posting without one.
    """
    current = job.page is not None and job.page.version == providers.PAGE_VERSION
    provider = providers.PROVIDERS.get(job.ats)
    if provider is None or provider.job_url is None or current or not classify(job.title):
        return job
    url = providers.job_url(job.ats, job.token, job.external_id)
    if not robots.allows(url):
        return job
    robots.pace(url)
    try:
        return providers.describe(job)
    except Exception as error:  # noqa: BLE001 - a missing description is not a failed run
        print(f"  !  {job.key}: no description: {type(error).__name__}: {error}", file=sys.stderr)
        return job


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="workit_scraper", description=__doc__)
    parser.add_argument(
        "--offline", action="store_true", help="skip the network; render from jobs.json"
    )
    parser.add_argument("--boards", type=Path, default=BOARDS_CSV)
    parser.add_argument("--full", action="store_true", help="read every board, quiet ones included")
    args = parser.parse_args(argv)

    previous = store.load(JOBS_JSON)

    if args.offline:
        if previous is None:
            print(f"--offline needs {JOBS_JSON.name}, which does not exist yet.", file=sys.stderr)
            return 1
        run = previous
        print(f"offline: {len(run.jobs)} postings from {JOBS_JSON.name}")
    else:
        now = datetime.now(UTC).isoformat()
        boards = load_boards(args.boards)
        if previous:
            # Least recently read first, even with --full: Workday's lane reads
            # from the front until its time is up (`Provider.budget_s`).
            due = previous.to_read(boards, now, everything=args.full)
            rest = "" if args.full else " (quiet ones rest; --full reads all)"
            print(f"scraping {len(due)} of {len(boards)} boards{rest}\n")
            boards = due
        else:
            print(f"scraping {len(boards)} boards\n")
        # Every origin a run touches, so robots.txt is read once, up front. A
        # posting's own page shares its board list's origin (`Provider.job_url`).
        # Not a provider with a host per company (`Provider.subdomains`: Workday's
        # ~1,500, iCIMS's ~300): those are read as their lane reaches each, in
        # parallel, rather than one after another before the run starts.
        robots = Robots(
            url
            for board in boards
            if (provider := providers.PROVIDERS.get(board.ats)) and provider.subdomains is None
            for url in providers.robots_urls(board.ats, board.token)
        )
        before = {job.key: job for job in previous.jobs} if previous else {}
        scanned, stats, read = scrape(boards, robots, before)
        # Store only what the page is about. Keeping all ~91,000 postings -- the sales,
        # marketing and senior roles included -- would make jobs.json tens of megabytes
        # and tell us nothing we display. `stats.postings` still counts everything
        # scanned, so the funnel on the page stays honest about how wide the net was.
        fresh = [job for job in scanned if classify(job.title)]
        stats = replace(stats, kept=len(fresh))
        run = store.update(previous, fresh, read, stats, now)
        # Only boards with a job on the page need a logo, and each is read once --
        # except that a newer reader reads the ones that had none again, once.
        # Recruitee has none we read (`Provider.logo_page`).
        run = store.reread_missing_logos(run, logos.VERSION)
        unread = sorted(
            {
                (j.ats, j.token, j.company)
                for j in run.jobs
                if run.is_listed(j) and j.board_key not in run.logos and logos.reads_logo(j.ats)
            }
        )
        print(f"\nreading {len(unread)} board pages for logos")
        run = replace(run, logos={**run.logos, **logos.fetch(unread)})
        store.save(run, JOBS_JSON)

    roles = pick([job for job in run.jobs if run.is_listed(job)], is_new=run.is_new)
    report.write_html(roles, run.stats, PAGE_HTML, run.scraped_at, counts_new=run.counts_new)
    feed.write(roles, run.logos, FEED_JSON)
    if not args.offline:
        by_ats = Counter(role.ats for role in roles)
        write_metrics(run.stats, fresh, by_ats, run.scraped_at, METRICS_JSON)
        print_metrics(run.stats, fresh, by_ats)

    print(
        f"\n{run.stats.postings:,} postings -> {len(roles)} distinct roles"
        f"  ({run.stats.boards_ok} boards read,"
        f" {run.stats.boards_missing} not found,"
        f" {run.stats.boards_skipped} skipped,"
        f" {run.stats.boards_failed} failed,"
        f" {run.stats.boards_deferred} left for a later run)"
    )
    print(f"wrote {PAGE_HTML} and {FEED_JSON.name}")
    return 0


def _per_provider(stats: RunStats, kept: list[Job], roles: Counter[str]) -> dict[str, dict]:
    """Each provider's counts from the scrape, with the postings it kept this run
    and the roles it has on the page now."""
    kept_by = Counter(job.ats for job in kept)
    return {
        ats: {**counts, "kept": kept_by[ats], "roles": roles.get(ats, 0)}
        for ats, counts in stats.by_provider.items()
    }


def write_metrics(
    stats: RunStats, kept: list[Job], roles: Counter[str] | dict[str, int], at: str, path: Path
) -> None:
    """metrics.json: the run's totals and each provider's share, so a change to one
    provider can be measured run against run (the scheduled run keeps it a week)."""
    totals = {key: value for key, value in asdict(stats).items() if key != "by_provider"}
    payload = {
        "scraped_at": at,
        "totals": totals,
        "by_provider": _per_provider(stats, kept, Counter(roles)),
    }
    path.write_text(json.dumps(payload, indent=1, sort_keys=True) + "\n", encoding="utf-8")


def print_metrics(stats: RunStats, kept: list[Job], roles: Counter[str]) -> None:
    columns = ("boards", "ok", "missing", "skipped", "failed", "deferred")
    print(f"\n{'provider':11s}" + "".join(f"{c:>9s}" for c in columns), end="")
    print(f"{'postings':>10s}{'kept':>7s}{'roles':>7s}{'pages':>7s}{'seconds':>9s}")
    for ats, row in sorted(_per_provider(stats, kept, roles).items()):
        print(f"{ats:11s}" + "".join(f"{row.get(c, 0):>9,}" for c in columns), end="")
        print(
            f"{row['postings']:>10,}{row['kept']:>7,}{row['roles']:>7,}"
            f"{row['pages']:>7,}{row['seconds']:>9,.0f}"
        )


if __name__ == "__main__":
    raise SystemExit(main())
