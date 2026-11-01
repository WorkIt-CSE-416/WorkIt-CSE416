"""jobs.json: the store, the first_seen_at history, and the offline fallback.

The whole file is one `Store`, loaded and rewritten each run, with sorted keys so two
runs can be diffed rather than compared as reshuffled files. It is gitignored: each
machine that runs the scraper keeps its own.

It also answers the two questions the page's header asks of it -- which postings are
still listed, and which are new today -- because both are claims about time, and
the store is what holds the timestamps.
"""

from __future__ import annotations

import json
import zlib
from collections.abc import Iterable
from dataclasses import asdict, dataclass, field, fields, replace
from datetime import UTC, datetime, timedelta
from pathlib import Path

from workit_scraper.providers import PROVIDERS, Board, Job

NEW_WINDOW = timedelta(hours=24)
#: A quiet board -- read before, never a kept posting -- is read on one run in this
#: many, and always once QUIET_LONGEST has passed since its last read.
QUIET_EVERY = 3
QUIET_LONGEST = timedelta(days=1)
#: How often the scheduled run fires (.github/workflows/scrape.yml, every three
#: hours): the slot that each quiet board's turn comes round in.
RUN_EVERY = timedelta(hours=3)
#: A board that went unread this many runs in a row -- it failed, said it does not
#: exist, or robots.txt refused it -- rests: it is not asked for REST_FIRST, then
#: twice that after each further miss, up to REST_LONGEST. Never for good.
REST_AFTER = 3
REST_FIRST = timedelta(hours=6)
REST_LONGEST = timedelta(hours=24)
#: A board whose kept postings hash to the same fingerprint as its last read
#: rests after the first unchanged read, doubling from FINGERPRINT_FIRST to
#: FINGERPRINT_LONGEST. No threshold: a board just read with identical content
#: needs no second look in three hours.
FINGERPRINT_FIRST = timedelta(hours=4)
FINGERPRINT_LONGEST = timedelta(hours=24)


@dataclass(frozen=True, slots=True)
class RunStats:
    """What one scrape did. Counters, so an outcome that never happened is zero."""

    postings: int = 0
    kept: int = 0
    boards_ok: int = 0
    boards_missing: int = 0
    boards_skipped: int = 0
    boards_failed: int = 0
    #: Left for a later run when a lane's time ran out (`Provider.budget_s`).
    boards_deferred: int = 0
    #: Each provider's share of the run, keyed by `ats` (`__main__.scrape`): its
    #: boards by outcome, postings scanned, pages read and lane seconds.
    by_provider: dict[str, dict[str, float]] = field(default_factory=dict)
    #: Why each board this run did not read stayed unread, keyed by `Board.key`
    #: (`board_read.failure_reason`): the HTTP status a site answered ("403"), "timeout",
    #: "robots.txt", "no such board" and the rest.
    unread: dict[str, str] = field(default_factory=dict)


@dataclass(frozen=True, slots=True)
class BoardReads:
    """When we first and last read a board's complete listing."""

    first_read_at: str
    last_read_at: str
    #: When it first said it does not exist since its last complete read. The next
    #: such answer closes its postings (`update`); one alone is evidence of nothing.
    missing_at: str | None = None
    #: The complete read before `last_read_at`, None until there have been two. A
    #: posting seen there and not at the last was missed once, and is still shown
    #: (`Store.is_listed`).
    prior_read_at: str | None = None
    #: Hex CRC32 of the sorted kept `external_id` values from the last complete read.
    fingerprint: str | None = None
    #: Consecutive complete reads whose kept postings hashed to the same fingerprint.
    unchanged_reads: int = 0
    #: ISO timestamp: the board rests until this time when its fingerprint is unchanged.
    fingerprint_until: str | None = None


@dataclass(frozen=True, slots=True)
class BoardHealth:
    """A board that went unread on its last runs: how many in a row, why the last
    time (`RunStats.unread`), and until when it rests, if it does."""

    failures: int
    why: str
    rest_until: str | None = None


@dataclass(frozen=True, slots=True)
class Store:
    scraped_at: str
    stats: RunStats
    jobs: list[Job]
    #: Keyed by `Board.key`. Only successful reads count: a timeout says nothing.
    boards: dict[str, BoardReads]
    #: Keyed by `Board.key`: the board page's logo, or None if the page had none.
    #: Absent means not read yet -- see `logos.fetch`.
    logos: dict[str, str | None] = field(default_factory=dict)
    #: The `logos.VERSION` that read the boards stored with no logo.
    logos_version: int = 1
    #: Keyed by `Board.key`: only boards whose last runs left them unread. A
    #: complete read removes the entry (`update`).
    health: dict[str, BoardHealth] = field(default_factory=dict)

    def resting(self, now: str) -> set[str]:
        """The boards not asked for this run, because they kept going unread."""
        at = _at(now)
        return {
            key
            for key, health in self.health.items()
            if health.rest_until is not None and _at(health.rest_until) > at
        }

    def fingerprint_resting(self, now: str) -> set[str]:
        """The boards not asked for this run, because their kept postings have
        not changed since the last read."""
        at = _at(now)
        return {
            key
            for key, reads in self.boards.items()
            if reads.fingerprint_until is not None and _at(reads.fingerprint_until) > at
        }

    def is_listed(self, job: Job) -> bool:
        """Whether the posting was on its board at one of the last two complete
        reads of that board.

        ponytail: nothing is ever closed -- a vanished posting stays in the file.
        It stops being shown once two *complete* reads of its board in a row lack
        it. One is not enough: a hiring system mid-outage can answer with an empty
        list, which reads as a real board with nothing open, and that one answer
        closed every posting on the board in Supabase until the next read. A board
        we failed to read this run keeps its postings on the page, because a failed
        read is not evidence that anything went away.
        """
        board = self.boards.get(job.board_key)
        if board is None:
            return True
        return job.last_seen_at is not None and job.last_seen_at in (
            board.last_read_at,
            board.prior_read_at,
        )

    def missed_once(self) -> set[str]:
        """The boards holding a posting their last complete read lacked and the one
        before it had: their next complete read decides whether it closes."""
        return {
            job.board_key
            for job in self.jobs
            if (reads := self.boards.get(job.board_key))
            and reads.prior_read_at is not None
            and job.last_seen_at == reads.prior_read_at
        }

    def is_new(self, job: Job) -> bool:
        """First seen in the 24 hours up to this scrape, on a board we already watched.

        The second half is what makes the count true. A posting found on a board's
        very first read was already there before we looked, so it is never new --
        which covers the first run, a board added to boards.csv, and a second run
        on the same day without a special case for any of them.
        """
        board = self.boards.get(job.board_key)
        if board is None or job.first_seen_at is None:
            return False
        seen = _at(job.first_seen_at)
        return seen > _at(board.first_read_at) and seen >= _at(self.scraped_at) - NEW_WINDOW

    def to_read(self, boards: list[Board], now: str, *, everything: bool = False) -> list[Board]:
        """The boards this run reads, least recently read first: every one, except
        resting boards (`resting`), fingerprint-resting boards
        (`fingerprint_resting`, skipped with `everything`), and quiet boards not
        due today (all of the quiet ones with `everything`, for `--full`).

        The last run asked 191 boards that said "no such board" and 12 that failed,
        every run, since boards.csv keeps every board. A board that goes unread
        REST_AFTER runs in a row now rests, as Freehire's do. Even `--full` does not
        ask a resting board: it answers as it did a few hours ago.

        Most boards in boards.csv have never had a posting we keep -- 282 of 333 on
        Lever, whose one-second Crawl-delay made it most of a run. A quiet board is
        read on a third of runs, staggered by its key over the run's RUN_EVERY slot
        so each run takes its own third, and whenever QUIET_LONGEST has passed, so
        missed runs do not leave one unread. A new posting on one can arrive about
        nine hours late; `--full` reads everything. The stagger was by day until
        2026-10-26: a day's eight runs read one third eight times, and a posting
        could wait two days.

        Skipping is safe for the rest of the store: a quiet board has nothing
        listed, and its `last_read_at` simply does not move.

        The order is for a lane with a time budget (Workday's): it reads from the
        front until its time is up. A board holding a posting missed once comes
        first (`missed_once`), so the second read that closes it, or keeps it, comes
        on the next run rather than after a whole sweep of the lane (about a day on
        Workday). Then a board never read, then the one read longest ago, so every
        board gets its turn. Other lanes read all.
        """
        at = _at(now)
        slot = int(at.timestamp() // RUN_EVERY.total_seconds())
        hot = {job.board_key for job in self.jobs}
        missed = self.missed_once()
        resting = self.resting(now)
        fp_resting = set() if everything else self.fingerprint_resting(now)
        due = []
        for board in boards:
            if board.key in resting:
                continue
            if board.key in fp_resting:
                continue
            reads = self.boards.get(board.key)
            if (
                everything
                or reads is None
                or board.key in hot
                or at - _at(reads.last_read_at) >= QUIET_LONGEST
                or zlib.crc32(board.key.encode()) % QUIET_EVERY == slot % QUIET_EVERY
            ):
                due.append(board)
        never = datetime.min.replace(tzinfo=UTC)
        return sorted(
            due,
            key=lambda b: (
                b.key not in missed,
                _at(self.boards[b.key].last_read_at) if b.key in self.boards else never,
            ),
        )

    @property
    def counts_new(self) -> bool:
        """False until some board has a read older than this one to compare against."""
        scraped = _at(self.scraped_at)
        return any(_at(board.first_read_at) < scraped for board in self.boards.values())


def _at(iso: str) -> datetime:
    # Compared as datetimes, not strings: isoformat() drops a zero microsecond, so two
    # stamps of one instant can differ in length and sort by accident rather than time.
    return datetime.fromisoformat(iso)


def update(
    previous: Store | None,
    fresh: list[Job],
    read: list[str],
    stats: RunStats,
    now: str,
    *,
    missing: Iterable[str] = (),
    fingerprints: dict[str, str] | None = None,
) -> Store:
    """Fold one scrape into the store.

    Stamps last_seen_at and carries first_seen_at forward, so first_seen_at is
    written once and never moves. A posting's `Page` is carried forward too when
    this read had none: Greenhouse's list never includes one, and each posting's
    own page is read only once (see `__main__.with_page`). `read` is the keys of the
    boards this run read completely; only those advance their `last_read_at`.

    `missing` is the keys of the boards we hold postings from that said they do not
    exist (`__main__.scrape`). The first answer is only noted; a second with no
    complete read between is a complete read with nothing open, so their postings
    close. One spurious 404 must not close a company's postings in Supabase. The
    two answers are the two misses `Store.is_listed` needs, so the first one's time
    becomes the read before.

    `stats.unread` gives each board this run left unread one more miss in a row,
    and the REST_AFTER-th and later a rest (`rest_for`). A board left for a later
    run (`Outcome.DEFERRED`) has no reason there, and its count stays.

    `fingerprints` maps each board key to the hex CRC32 of its sorted kept
    external_ids (`__main__` computes it after `classify_job`). When a board's
    fingerprint matches its previous read's, `unchanged_reads` increments and
    the board rests (`fingerprint_rest`). None (the default) treats every board
    as changed, which is the correct fallback for test helpers and `--offline`.
    """
    before = {job.key: job for job in previous.jobs} if previous else {}
    merged = []
    for job in fresh:
        old = before.get(job.key)
        merged.append(
            replace(
                carry(job, before),
                first_seen_at=(old.first_seen_at if old else None) or now,
                last_seen_at=now,
            )
        )
    seen = {job.key for job in fresh}
    merged += [job for key, job in before.items() if key not in seen]

    boards = dict(previous.boards) if previous else {}
    fp = fingerprints or {}
    for key in read:
        prev = boards.get(key)
        new_fp = fp.get(key)
        if prev and prev.fingerprint is not None and new_fp == prev.fingerprint:
            unchanged = prev.unchanged_reads + 1
        else:
            unchanged = 0
        rest = fingerprint_rest(unchanged)
        until = (_at(now) + rest).isoformat() if rest else None
        boards[key] = BoardReads(
            first_read_at=prev.first_read_at if prev else now,
            last_read_at=now,
            prior_read_at=prev.last_read_at if prev else None,
            fingerprint=new_fp,
            unchanged_reads=unchanged,
            fingerprint_until=until,
        )
    for key in missing:
        reads = boards.get(key)
        if reads is None:
            continue
        if reads.missing_at is None:
            boards[key] = replace(reads, missing_at=now)
        else:
            boards[key] = replace(
                reads, last_read_at=now, prior_read_at=reads.missing_at,
                fingerprint=None, unchanged_reads=0, fingerprint_until=None,
            )
    health = dict(previous.health) if previous else {}
    for key in read:
        health.pop(key, None)
    for key, why in stats.unread.items():
        failures = (health[key].failures if key in health else 0) + 1
        rest = rest_for(failures)
        until = (_at(now) + rest).isoformat() if rest else None
        health[key] = BoardHealth(failures=failures, why=why, rest_until=until)
    logos = dict(previous.logos) if previous else {}
    version = previous.logos_version if previous else 1
    return Store(
        scraped_at=now,
        stats=stats,
        jobs=merged,
        boards=boards,
        logos=logos,
        logos_version=version,
        health=health,
    )


def rest_for(failures: int) -> timedelta | None:
    """How long a board unread `failures` runs in a row rests: none below
    REST_AFTER, then REST_FIRST, doubling each miss up to REST_LONGEST."""
    if failures < REST_AFTER:
        return None
    return min(REST_FIRST * 2 ** (failures - REST_AFTER), REST_LONGEST)


def fingerprint(external_ids: Iterable[str]) -> str:
    """8-char hex CRC32 of the sorted strings in `external_ids`, joined with ``\\0``."""
    joined = "\0".join(sorted(external_ids))
    return f"{zlib.crc32(joined.encode()) & 0xFFFFFFFF:08x}"


def fingerprint_rest(unchanged_reads: int) -> timedelta | None:
    """How long a board unchanged `unchanged_reads` times rests: none on the
    first read (nothing to compare), then FINGERPRINT_FIRST, doubling each
    unchanged read up to FINGERPRINT_LONGEST."""
    if unchanged_reads < 1:
        return None
    return min(FINGERPRINT_FIRST * 2 ** (unchanged_reads - 1), FINGERPRINT_LONGEST)


def reread_missing_logos(run: Store, version: int) -> Store:
    """`run` with the boards stored as having no logo forgotten, so they are read
    again, when a newer `logos.VERSION` may find what the older one missed. Found
    logos stay: True Anomaly's null outlived the reader that would have found it."""
    if run.logos_version >= version:
        return run
    found = {key: url for key, url in run.logos.items() if url is not None}
    return replace(run, logos=found, logos_version=version)


def carry(job: Job, before: dict[str, Job]) -> Job:
    """A freshly listed posting with the page its stored self already had.

    A Greenhouse, Workable or BambooHR listing has no page; the one read before
    stands until a newer PAGE_VERSION reads it again. Ashby, Lever and Recruitee
    bring a fresh page every read, which always wins -- facts an employer changed
    must not linger. A BambooHR listing has no date either: its page gave it one.

    A Workday or Oracle listing's date is the reverse (`Provider.page_date`): it
    has one, but only roughly -- Workday's counted back from "Posted 3 Days Ago",
    a day out either way and gone at "30+ Days Ago", Oracle's a bare day -- while
    its page gave the exact one. So a bare listing keeps the stored date; one
    whose page was just read brings that page's date. Without it every Oracle
    role went back to midnight on its second run.
    """
    old = before.get(job.key)
    if not old:
        return job
    if job.shortlist_tags is not None:
        # The inline reader just evaluated the whole text, including rejection.
        # Never resurrect its old page, but keep a date the new list omitted.
        return replace(job, posted_at=job.posted_at or old.posted_at)
    provider = PROVIDERS.get(job.ats)
    if provider and provider.page_title and job.page is None and old.page is not None:
        # An iCIMS listing's title is its URL's slug; its page gave the real one.
        job = replace(job, title=old.title)
    if provider and provider.page_date and job.page is None:
        return replace(job, page=old.page, posted_at=old.posted_at or job.posted_at)
    return replace(job, page=job.page or old.page, posted_at=job.posted_at or old.posted_at)


def load(path: Path) -> Store | None:
    if not path.exists():
        return None
    payload = json.loads(path.read_text(encoding="utf-8"))
    return Store(
        scraped_at=payload["scraped_at"],
        stats=_known(RunStats, payload["stats"]),
        jobs=[Job.from_row(row) for row in payload["jobs"]],
        boards={key: _known(BoardReads, reads) for key, reads in payload["boards"].items()},
        logos=payload.get("logos", {}),
        logos_version=payload.get("logos_version", 1),
        health={key: _known(BoardHealth, row) for key, row in payload.get("health", {}).items()},
    )


def _known(cls, row: dict):
    """`cls(**row)` with only the fields `cls` has, so a store written by newer
    code still loads after a revert to this code or later. Code from before
    `prior_read_at` does not filter: a revert past it must delete the
    `scraper-store-*` Actions cache, or that code fails to load jobs.json."""
    names = {f.name for f in fields(cls)}
    return cls(**{key: value for key, value in row.items() if key in names})


def save(store: Store, path: Path) -> None:
    payload = {
        "scraped_at": store.scraped_at,
        "stats": asdict(store.stats),
        "boards": {key: asdict(reads) for key, reads in store.boards.items()},
        "logos": store.logos,
        "logos_version": store.logos_version,
        "health": {key: asdict(health) for key, health in store.health.items()},
        "jobs": [job.to_row() for job in sorted(store.jobs, key=lambda job: job.key)],
    }
    path.write_text(json.dumps(payload, indent=1, sort_keys=True) + "\n", encoding="utf-8")
