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
from dataclasses import asdict, dataclass, replace
from datetime import datetime, timedelta
from pathlib import Path

from workit_scraper.providers import Job

NEW_WINDOW = timedelta(hours=24)


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
    written once and never moves. `read` is the keys of the boards this run read
    completely; only those advance their `last_read_at`.
    """
    before = {job.key: job for job in previous.jobs} if previous else {}
    merged = [
        replace(
            job,
            first_seen_at=(old.first_seen_at if (old := before.get(job.key)) else None) or now,
            last_seen_at=now,
        )
        for job in fresh
    ]
    seen = {job.key for job in fresh}
    merged += [job for key, job in before.items() if key not in seen]

    boards = dict(previous.boards) if previous else {}
    for key in read:
        first = boards[key].first_read_at if key in boards else now
        boards[key] = BoardReads(first_read_at=first, last_read_at=now)
    return Store(scraped_at=now, stats=stats, jobs=merged, boards=boards)


def load(path: Path) -> Store | None:
    if not path.exists():
        return None
    payload = json.loads(path.read_text(encoding="utf-8"))
    return Store(
        scraped_at=payload["scraped_at"],
        stats=RunStats(**payload["stats"]),
        jobs=[Job.from_row(row) for row in payload["jobs"]],
        boards={key: BoardReads(**reads) for key, reads in payload["boards"].items()},
    )


def save(store: Store, path: Path) -> None:
    payload = {
        "scraped_at": store.scraped_at,
        "stats": asdict(store.stats),
        "boards": {key: asdict(reads) for key, reads in store.boards.items()},
        "jobs": [job.to_row() for job in sorted(store.jobs, key=lambda job: job.key)],
    }
    path.write_text(json.dumps(payload, indent=1, sort_keys=True) + "\n", encoding="utf-8")
