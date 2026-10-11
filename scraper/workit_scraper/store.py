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
from dataclasses import asdict, dataclass, field, replace
from datetime import datetime, timedelta
from pathlib import Path

from workit_scraper.providers import Board, Job

NEW_WINDOW = timedelta(hours=24)
#: A quiet board -- read before, never a kept posting -- is read on one run in this
#: many, and always once this many days have passed since its last read.
QUIET_EVERY = 3


@dataclass(frozen=True, slots=True)
class RunStats:
    """What one scrape did. Counters, so an outcome that never happened is zero."""

    postings: int = 0
    kept: int = 0
    boards_ok: int = 0
    boards_missing: int = 0
    boards_skipped: int = 0
    boards_failed: int = 0


@dataclass(frozen=True, slots=True)
class BoardReads:
    """When we first and last read a board's complete listing."""

    first_read_at: str
    last_read_at: str


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

    def is_listed(self, job: Job) -> bool:
        """Whether the posting was on its board the last time we read that board.

        ponytail: nothing is ever closed -- a vanished posting stays in the file.
        It just stops being shown once a *complete* read of its board lacks it. A
        board we failed to read this run keeps its postings on the page, because a
        failed read is not evidence that anything went away.
        """
        board = self.boards.get(job.board_key)
        return board is None or job.last_seen_at == board.last_read_at

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

    def to_read(self, boards: list[Board], now: str) -> list[Board]:
        """The boards this run reads: every one, except quiet boards not due today.

        Most boards in boards.csv have never had a posting we keep -- 282 of 333 on
        Lever, whose one-second Crawl-delay made it most of a run. A quiet board is
        read on a third of runs, staggered by its key so each run takes its own
        third, and whenever QUIET_EVERY days have passed, so a missed day of runs
        does not leave one unread. A new posting on one can arrive two days late;
        `--full` reads everything.

        Skipping is safe for the rest of the store: a quiet board has nothing
        listed, and its `last_read_at` simply does not move.
        """
        at = _at(now)
        hot = {job.board_key for job in self.jobs}
        due = []
        for board in boards:
            reads = self.boards.get(board.key)
            if (
                reads is None
                or board.key in hot
                or at - _at(reads.last_read_at) >= timedelta(days=QUIET_EVERY)
                or zlib.crc32(board.key.encode()) % QUIET_EVERY == at.toordinal() % QUIET_EVERY
            ):
                due.append(board)
        return due

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
    previous: Store | None, fresh: list[Job], read: list[str], stats: RunStats, now: str
) -> Store:
    """Fold one scrape into the store.

    Stamps last_seen_at and carries first_seen_at forward, so first_seen_at is
    written once and never moves. A posting's `Page` is carried forward too when
    this read had none: Greenhouse's list never includes one, and each posting's
    own page is read only once (see `__main__.with_page`). `read` is the keys of the
    boards this run read completely; only those advance their `last_read_at`.
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
    for key in read:
        first = boards[key].first_read_at if key in boards else now
        boards[key] = BoardReads(first_read_at=first, last_read_at=now)
    logos = dict(previous.logos) if previous else {}
    return Store(scraped_at=now, stats=stats, jobs=merged, boards=boards, logos=logos)


def carry(job: Job, before: dict[str, Job]) -> Job:
    """A freshly listed posting with the page its stored self already had.

    A Greenhouse, Workable or BambooHR listing has no page; the one read before
    stands until a newer PAGE_VERSION reads it again. Ashby, Lever and Recruitee
    bring a fresh page every read, which always wins -- facts an employer changed
    must not linger. A BambooHR listing has no date either: its page gave it one.
    """
    old = before.get(job.key)
    if not old:
        return job
    return replace(job, page=job.page or old.page, posted_at=job.posted_at or old.posted_at)


def load(path: Path) -> Store | None:
    if not path.exists():
        return None
    payload = json.loads(path.read_text(encoding="utf-8"))
    return Store(
        scraped_at=payload["scraped_at"],
        stats=RunStats(**payload["stats"]),
        jobs=[Job.from_row(row) for row in payload["jobs"]],
        boards={key: BoardReads(**reads) for key, reads in payload["boards"].items()},
        logos=payload.get("logos", {}),
    )


def save(store: Store, path: Path) -> None:
    payload = {
        "scraped_at": store.scraped_at,
        "stats": asdict(store.stats),
        "boards": {key: asdict(reads) for key, reads in store.boards.items()},
        "logos": store.logos,
        "jobs": [job.to_row() for job in sorted(store.jobs, key=lambda job: job.key)],
    }
    path.write_text(json.dumps(payload, indent=1, sort_keys=True) + "\n", encoding="utf-8")
