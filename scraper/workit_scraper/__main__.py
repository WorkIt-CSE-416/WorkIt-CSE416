"""Scrape every board in boards.csv, then write jobs.json and the page.

    python3 -m workit_scraper              # scrape live, then render
    python3 -m workit_scraper --offline    # skip the network, render from jobs.json

No more than eight boards are in flight at a time, and every fetch goes through
`polite.Robots` first. The store itself is `store.py`.
"""

from __future__ import annotations

import argparse
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
from workit_scraper.board_read import ReadStatus, read_board
from workit_scraper.catalog import BOARDS_CSV, load_boards
from workit_scraper.discovery_review import validate_catalog
from workit_scraper.polite import Robots
from workit_scraper.providers import Board, Job
from workit_scraper.providers.systems.workday import WORKDAY_CAP
from workit_scraper.shortlist import (
    WIDENING_STEPS,
    classify,
    classify_job,
    pick,
    widening_step,
)
from workit_scraper.store import RunStats

ROOT = Path(__file__).resolve().parent.parent
JOBS_JSON = ROOT / "jobs.json"
PAGE_HTML = ROOT / "internships.html"
FEED_JSON = ROOT / "feed.json"
#: Why each stored posting is not in the feed (`feed.closings`), for the import's
#: `job_postings.closed_reason`.
CLOSINGS_JSON = ROOT / "closings.json"
METRICS_JSON = ROOT / "metrics.json"
MAX_IN_FLIGHT = 8
#: No posting's own page is asked for once this long has passed since the lanes
#: started; the rest wait for the next run, where `needs_page` puts them first in
#: line again. Board reads have a budget per lane, but page reads had none: after
#: the batch-apply merge (2026-10-28) added SuccessFactors, whose every kept posting
#: needs its page, one host at a time, every scheduled run spent 16 minutes on them
#: after its last board, hit the job's limit (`timeout-minutes` in scrape.yml) and
#: was cancelled. A cancelled run saves no store, so the next one read the same pages
#: again, and nothing was imported for 32 hours. Leave the import its 10 minutes.
PAGES_UNTIL_S = 20 * 60
#: No lane starts a board once this long has passed since the lanes started, budget
#: or not; the rest wait for the next run, first in line there (`Store.to_read`).
#: A lane without a budget ran as long as its boards took, and a run that hit the
#: job's 60-minute limit saved no store, so the next one faced the same boards and
#: was cancelled too: twice on 2026-10-30, by Jibe. A board started in time is read
#: whole, so the lanes end about this long plus their slowest board after starting,
#: leaving the store, the feed and the import well inside the limit.
BOARDS_UNTIL_S = 30 * 60
#: A lane in which this many boards we hold postings from say they do not exist,
#: and more of them than read whole, closes none of them: that is the hiring
#: system changing (every Workday tenant a 422), not its companies leaving. The
#: same holds for this many answering with an empty list, against those that
#: listed something.
SURGE = 3


class Outcome(Enum):
    OK = auto()
    MISSING = auto()
    SKIPPED = auto()
    FAILED = auto()
    DEFERRED = auto()


def _scrape_one(board: Board, robots: Robots) -> tuple[Outcome, list[Job], str | None]:
    """One board's read: what happened, its postings, and why it stayed unread
    (None when it was read whole)."""
    result = read_board(board, robots)
    if result.reason == "no reader":
        print(f"  ?  {board.key}: no fetcher for this provider", file=sys.stderr)
    elif result.reason == "robots.txt":
        print(f"  -  {board.key}: skipped, robots.txt disallows us")
    elif result.status is ReadStatus.MISSING:
        print(f"  x  {board.key}: no such board")
    elif result.reason == "too large":
        print(f"  -  {board.key}: skipped, too large to read whole ({result.error})")
    elif result.status is ReadStatus.FAILED:
        error = result.error
        print(f"  !  {board.key}: {type(error).__name__}: {error}", file=sys.stderr)
    else:
        print(f"  ok {board.key}: {len(result.jobs)} postings")
    return Outcome[result.status.name], result.jobs, result.reason


def newest_first(jobs: list[Job]) -> bool | None:
    """Whether a board's list names its newest postings first, by the dates the list
    itself gives (Workday's "Posted 3 Days Ago"; none for "30+ Days Ago", the
    oldest). None when it gives too few dates to tell. An arrival scan, which would
    read only a list's first pages each run, needs True (docs/coverage.md)."""
    dates = [job.posted_at or "" for job in jobs]
    if len(set(dates)) < 2:
        return None
    return all(a >= b for a, b in zip(dates, dates[1:], strict=False))


def _lane(
    boards: list[Board],
    robots: Robots,
    before: dict[str, Job],
    pages_until: float | None = None,
    boards_until: float | None = None,
):
    """One provider's boards, then the own pages of their postings that need one
    (`with_page`) -- so Greenhouse's page reads start when its boards are done,
    not after Lever's. Order is kept, so each board gets its own jobs back.

    A lane with a budget (`Provider.budget_s`) starts no board once it has run out,
    no lane starts a board after `boards_until` (`BOARDS_UNTIL_S`), and no lane
    starts a page read after `pages_until` (`PAGES_UNTIL_S`). Also
    returns how long the lane took, how many pages it read, for a provider that
    pages how many of its lists named the newest postings first (`newest_first`),
    and why each board it did not read stayed unread, for the run's metrics."""
    started = time.monotonic()
    provider = providers.PROVIDERS.get(boards[0].ats) if boards else None
    budget = provider.budget_s if provider else None
    ends = [started + budget if budget is not None else None, boards_until]
    deadline = min((end for end in ends if end is not None), default=None)

    def read(board: Board) -> tuple[Outcome, list[Job], str | None]:
        if deadline is not None and time.monotonic() > deadline:
            return Outcome.DEFERRED, [], None
        return _scrape_one(board, robots)

    with ThreadPoolExecutor(MAX_IN_FLIGHT) as pool:
        reads = list(pool.map(read, boards))
        results = [(outcome, jobs) for outcome, jobs, _ in reads]
        unread = {board.key: why for board, (*_, why) in zip(boards, reads, strict=True) if why}
        # Read off the list as it came, before `carry` puts back the dates the
        # postings' own pages gave. A board read in slices, one per filter value
        # (Workday's capped ones), is in no one order, so it is left out.
        order = Counter(
            newest_first(jobs)
            for outcome, jobs in results
            if provider and provider.paged and outcome is Outcome.OK and len(jobs) < WORKDAY_CAP
        )
        listed = [store.carry(job, before) for _, jobs in results for job in jobs]
        late: list[str] = []

        def page(job: Job) -> Job:
            if pages_until is not None and time.monotonic() > pages_until and needs_page(job):
                late.append(job.key)
                return job
            return with_page(job, robots)

        paged = list(pool.map(page, listed))
    if late:
        print(f"  …  {boards[0].ats}: {len(late):,} postings' pages left for the next run")
    # `with_page` hands back the same posting when it reads nothing.
    pages = sum(1 for was, now in zip(listed, paged, strict=True) if now is not was)
    described = iter(paged)
    results = [(outcome, [next(described) for _ in jobs]) for outcome, jobs in results]
    return results, time.monotonic() - started, pages, order, unread


def scrape(
    boards: list[Board], robots: Robots, before: dict[str, Job]
) -> tuple[list[Job], RunStats, list[str], list[str]]:
    """Every posting scanned, what happened, the keys of the boards read in full,
    and the keys of the boards we hold postings from that now say they do not exist.

    Each provider is its own lane with its own workers. They used to share one pool,
    and a worker waiting out Lever's one-second Crawl-delay was a worker not
    reading Greenhouse: the lanes cut a run from 9.5 minutes to Lever's own pace.
    Each provider's origin is still paced exactly as before (`Robots.pace`).
    """
    lanes: dict[str, list[Board]] = {}
    for board in boards:
        lanes.setdefault(board.ats, []).append(board)
    pages_until = time.monotonic() + PAGES_UNTIL_S
    boards_until = time.monotonic() + BOARDS_UNTIL_S
    with ThreadPoolExecutor(max(len(lanes), 1)) as pool:
        by_lane = list(
            pool.map(
                lambda lane: _lane(lane, robots, before, pages_until, boards_until),
                lanes.values(),
            )
        )
    outcome_of = {
        board.key: result
        for lane, (results, *_) in zip(lanes.values(), by_lane, strict=True)
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
                # Only a provider that pages has these (`newest_first`).
                **(
                    {
                        "newest_first": order[True],
                        "not_newest_first": order[False],
                        "order_unclear": order[None],
                    }
                    if order
                    else {}
                ),
            }
            for (ats, lane), (lane_results, seconds, pages, order, _) in zip(
                lanes.items(), by_lane, strict=True
            )
        },
        unread={key: why for *_, lane_unread in by_lane for key, why in lane_unread.items()},
    )
    # A board we hold postings from that now says it does not exist may have
    # nothing open (`store.update` closes it on the second answer in a row). Not
    # one never read (a typo has nothing to close), never a failure, which is
    # evidence of nothing, and never most of a lane at once (SURGE).
    #
    # An empty list is a complete read with nothing open, unless most of a lane's
    # boards we hold postings from answer one at once, as Freehire guards against:
    # two reads stop one empty answer, but a hiring system answering every board
    # empty for a run or two would close them all. Those count as no read.
    known = {job.board_key for job in before.values()}
    surged = set()
    held: set[str] = set()
    for ats, lane in lanes.items():
        said = Counter(outcome_of[board.key][0] for board in lane if board.key in known)
        if said[Outcome.MISSING] >= SURGE and said[Outcome.MISSING] > said[Outcome.OK]:
            print(
                f"  !  {ats}: {said[Outcome.MISSING]} boards we hold postings from say they"
                " do not exist; closing none",
                file=sys.stderr,
            )
            surged.add(ats)
        empty = [
            board.key
            for board in lane
            if board.key in known and outcome_of[board.key] == (Outcome.OK, [])
        ]
        if len(empty) >= SURGE and len(empty) > said[Outcome.OK] - len(empty):
            print(
                f"  !  {ats}: {len(empty)} boards we hold postings from list nothing; closing none",
                file=sys.stderr,
            )
            held.update(empty)
    read = [
        board.key
        for board, (outcome, _) in zip(boards, results, strict=True)
        if outcome is Outcome.OK and board.key not in held
    ]
    missing = [
        board.key
        for board, (outcome, _) in zip(boards, results, strict=True)
        if outcome is Outcome.MISSING and board.key in known and board.ats not in surged
    ]
    return scanned, stats, read, missing


def needs_page(job: Job) -> bool:
    """Whether `with_page` reads this posting's page: a kept posting of a provider
    whose list leaves the page out (`Provider.job_url`), with no `Page` under the
    current PAGE_VERSION."""
    current = job.page is not None and job.page.version == providers.PAGE_VERSION
    provider = providers.PROVIDERS.get(job.ats)
    return bool(provider and provider.job_url and not current and classify(job.title))


def with_page(job: Job, robots: Robots) -> Job:
    """The posting with its own page read, if it is a kept Greenhouse, Workable,
    BambooHR or Workday posting with no `Page` under the current PAGE_VERSION;
    otherwise exactly as it was.

    Only those four need this -- Ashby, Lever and Recruitee send it all with the
    list -- and only once per posting, since the store carries the page forward.
    Called on postings a board just listed, so one that has left its board is never
    asked for. A page that fails or is disallowed leaves the posting without one.
    """
    if not needs_page(job):
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
        decisions = args.boards.with_name("discovery-review.json")
        try:
            if decisions.exists():
                validate_catalog(boards, json.loads(decisions.read_text(encoding="utf-8")))
        except (OSError, ValueError) as error:
            print(f"Invalid discovery review: {error}", file=sys.stderr)
            return 1
        if previous:
            # Least recently read first, even with --full: Workday's lane reads
            # from the front until its time is up (`Provider.budget_s`).
            due = previous.to_read(boards, now, everything=args.full)
            rest = "" if args.full else " (quiet ones rest; --full reads all)"
            print(f"scraping {len(due)} of {len(boards)} boards{rest}")
            print(f"{len(previous.resting(now)):,} boards rest after going unread")
            print(
                f"{len(previous.fingerprint_resting(now)):,} boards rest after an unchanged"
                " fingerprint\n"
            )
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
        scanned, stats, read, missing = scrape(boards, robots, before)
        # Store only what the page is about. Keeping all ~91,000 postings -- the sales,
        # marketing and senior roles included -- would make jobs.json tens of megabytes
        # and tell us nothing we display. `stats.postings` still counts everything
        # scanned, so the funnel on the page stays honest about how wide the net was.
        fresh = [job for job in scanned if classify_job(job)]
        stats = replace(stats, kept=len(fresh))
        # Hash each board's kept posting IDs so unchanged boards can rest.
        by_board: dict[str, list[str]] = {}
        for j in fresh:
            by_board.setdefault(j.board_key, []).append(j.external_id)
        fingerprints = {key: store.fingerprint(ids) for key, ids in by_board.items()}
        # A board read OK with zero kept postings hashes an empty list.
        for key in read:
            fingerprints.setdefault(key, store.fingerprint([]))
        run = store.update(
            previous, fresh, read, stats, now, missing=missing, fingerprints=fingerprints
        )
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
    found = feed.closings(run, roles)
    feed.write_closings(found, CLOSINGS_JSON)
    if not args.offline:
        by_ats = Counter(role.ats for role in roles)
        steps = widening(scanned)
        missed = len(run.missed_once())
        resting = {key: run.health[key].why for key in run.resting(run.scraped_at)}
        fp_resting = len(run.fingerprint_resting(run.scraped_at))
        write_metrics(
            run.stats,
            fresh,
            by_ats,
            run.scraped_at,
            METRICS_JSON,
            steps=steps,
            missed=missed,
            resting=resting,
            closings=Counter(found.values()),
            fp_resting=fp_resting,
        )
        print_metrics(
            run.stats,
            fresh,
            by_ats,
            steps=steps,
            missed=missed,
            resting=resting,
            fp_resting=fp_resting,
        )
        print(f"\n{len(found):,} stored postings not in the feed: {_reasons(found)}")

    print(
        f"\n{run.stats.postings:,} postings -> {len(roles)} distinct roles"
        f"  ({run.stats.boards_ok} boards read,"
        f" {run.stats.boards_missing} not found,"
        f" {run.stats.boards_skipped} skipped,"
        f" {run.stats.boards_failed} failed,"
        f" {run.stats.boards_deferred} left for a later run)"
    )
    print(f"wrote {PAGE_HTML}, {FEED_JSON.name} and {CLOSINGS_JSON.name}")
    return 0


def _reasons(found: dict[str, str]) -> str:
    counts = Counter(found.values())
    return ", ".join(f"{why} {counts[why]:,}" for why in feed.REASONS if counts[why]) or "none"


def _per_provider(stats: RunStats, kept: list[Job], roles: Counter[str]) -> dict[str, dict]:
    """Each provider's counts from the scrape, with the postings it kept this run
    and the roles it has on the page now."""
    kept_by = Counter(job.ats for job in kept)
    return {
        ats: {**counts, "kept": kept_by[ats], "roles": roles.get(ats, 0)}
        for ats, counts in stats.by_provider.items()
    }


def widening(scanned: list[Job]) -> dict[str, int]:
    """Every posting this run scanned, under the first step of a wider shortlist that
    would keep it (`shortlist.widening_step`). A run scans only what it reads, so
    compare steps with each other, not with a run that rested more boards.
    Inline eligibility is reused without parsing descriptions again."""
    steps = Counter[str]()
    for job in scanned:
        step = "kept" if classify_job(job) else widening_step(job.title)
        steps[step] += 1
    return {step: steps[step] for step in WIDENING_STEPS}


#: Board keys kept as examples for each provider's reason, so metrics.json names
#: the hosts that refused us without listing every quiet Workday tenant.
UNREAD_EXAMPLES = 5


def unread_by_provider(unread: dict[str, str]) -> dict[str, dict[str, dict[str, object]]]:
    """Why boards went unread (`RunStats.unread`), by provider and reason: how many,
    and a few of their keys, whose host is the site that answered."""
    grouped: dict[str, dict[str, list[str]]] = {}
    for key, why in sorted(unread.items()):
        grouped.setdefault(key.split("/")[0], {}).setdefault(why, []).append(key)
    return {
        ats: {
            why: {"boards": len(keys), "examples": keys[:UNREAD_EXAMPLES]}
            for why, keys in reasons.items()
        }
        for ats, reasons in grouped.items()
    }


def write_metrics(
    stats: RunStats,
    kept: list[Job],
    roles: Counter[str] | dict[str, int],
    at: str,
    path: Path,
    *,
    steps: dict[str, int] | None = None,
    missed: int | None = None,
    resting: dict[str, str] | None = None,
    closings: Counter[str] | None = None,
    fp_resting: int | None = None,
) -> None:
    """metrics.json: the run's totals and each provider's share, so a change to one
    provider can be measured run against run (the scheduled run keeps it a week),
    and why boards went unread (`unread_by_provider`). With `steps`, what a wider
    shortlist would keep (`widening`); with `missed`, the boards holding a posting
    missed once, whose next complete read decides it; with `resting`, the boards
    the next runs will not ask (`Store.resting`), by why they last went unread;
    with `closings`, the stored postings not in the feed by reason
    (`feed.closings`). Those are totals: this run's closes, by reason, are in the
    import's report."""
    totals = {
        key: value for key, value in asdict(stats).items() if key not in ("by_provider", "unread")
    }
    payload: dict[str, object] = {
        "scraped_at": at,
        "totals": totals,
        "by_provider": _per_provider(stats, kept, Counter(roles)),
        "unread": unread_by_provider(stats.unread),
    }
    if steps is not None:
        payload["widening"] = steps
    if missed is not None:
        payload["boards_missed_once"] = missed
    if resting is not None:
        payload["resting"] = unread_by_provider(resting)
    if closings is not None:
        payload["closings"] = {why: closings[why] for why in feed.REASONS}
    if fp_resting is not None:
        payload["boards_fingerprint_resting"] = fp_resting
    path.write_text(json.dumps(payload, indent=1, sort_keys=True) + "\n", encoding="utf-8")


def print_metrics(
    stats: RunStats,
    kept: list[Job],
    roles: Counter[str],
    *,
    steps: dict[str, int] | None = None,
    missed: int | None = None,
    resting: dict[str, str] | None = None,
    fp_resting: int | None = None,
) -> None:
    columns = ("boards", "ok", "missing", "skipped", "failed", "deferred")
    print(f"\n{'provider':11s}" + "".join(f"{c:>9s}" for c in columns), end="")
    print(f"{'postings':>10s}{'kept':>7s}{'roles':>7s}{'pages':>7s}{'seconds':>9s}")
    rows = sorted(_per_provider(stats, kept, roles).items())
    for ats, row in rows:
        print(f"{ats:11s}" + "".join(f"{row.get(c, 0):>9,}" for c in columns), end="")
        print(
            f"{row['postings']:>10,}{row['kept']:>7,}{row['roles']:>7,}"
            f"{row['pages']:>7,}{row['seconds']:>9,.0f}"
        )
    for ats, row in rows:
        if "newest_first" in row:
            print(
                f"\n{ats} lists read whole: {row['newest_first']:,} name the newest postings"
                f" first, {row['not_newest_first']:,} do not,"
                f" {row['order_unclear']:,} give too few dates to tell"
            )
    for title, unread in (("went unread", stats.unread), ("rest now", resting)):
        if not unread:
            continue
        print(f"\nwhy boards {title}, by provider:")
        for ats, reasons in sorted(unread_by_provider(unread).items()):
            ranked = sorted(reasons.items(), key=lambda reason: -reason[1]["boards"])
            print(f"  {ats:11s} " + ", ".join(f"{why} {n['boards']:,}" for why, n in ranked))
    if steps:
        print(f"\nwhat a wider shortlist would keep, of the {sum(steps.values()):,} scanned:")
        for step, count in steps.items():
            print(f"  {count:>9,}  {step}")
    if missed is not None:
        print(f"\n{missed:,} boards hold a posting missed once; their next complete read decides")
    if fp_resting is not None:
        print(f"{fp_resting:,} boards rest after an unchanged fingerprint")


if __name__ == "__main__":
    raise SystemExit(main())
