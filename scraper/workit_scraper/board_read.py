"""Read one complete board with shared robots, pacing, and failure semantics.

No printing or persistence: scheduled scraping and discovery format the result
for their own reports. Empty success remains different from a missing board.
"""

from __future__ import annotations

import urllib.error
from dataclasses import dataclass, field
from enum import Enum, auto

from workit_scraper import providers
from workit_scraper.polite import Robots
from workit_scraper.providers import Board, Job


class ReadStatus(Enum):
    OK = auto()
    MISSING = auto()
    SKIPPED = auto()
    FAILED = auto()


@dataclass(frozen=True)
class BoardRead:
    status: ReadStatus
    jobs: list[Job] = field(default_factory=list)
    reason: str | None = None
    error: Exception | None = None


def failure_reason(error: Exception) -> str:
    """Stable, actionable failure labels shared by discovery and scrape metrics."""
    if isinstance(error, urllib.error.HTTPError):
        return "redirect" if 300 <= error.code < 400 else str(error.code)
    if isinstance(error, TimeoutError) or (
        isinstance(error, urllib.error.URLError) and isinstance(error.reason, TimeoutError)
    ):
        return "timeout"
    if isinstance(error, urllib.error.URLError | ConnectionError):
        return "connection"
    if isinstance(error, providers.Incomplete):
        return "incomplete"
    if isinstance(error, ValueError | AssertionError):
        return "unreadable answer"
    return type(error).__name__


def read_board(board: Board, robots: Robots) -> BoardRead:
    """Read a whole board, or explain why no complete read was possible."""
    provider = providers.PROVIDERS.get(board.ats)
    if provider is None:
        return BoardRead(ReadStatus.SKIPPED, reason="no reader")
    try:
        urls = providers.robots_urls(board.ats, board.token)
        if not all(robots.allows(url) for url in urls):
            return BoardRead(ReadStatus.SKIPPED, reason="robots.txt")
        robots.pace(urls[0])
        kwargs = {"pace": robots.pace} if provider.paged else {}
        jobs = provider.read(board.token, board.company, **kwargs)
        return BoardRead(ReadStatus.OK, jobs=jobs)
    except providers.BoardNotFound as error:
        return BoardRead(ReadStatus.MISSING, reason="no such board", error=error)
    except providers.TooLarge as error:
        return BoardRead(ReadStatus.SKIPPED, reason="too large", error=error)
    except Exception as error:  # One unread board must not end a run.
        return BoardRead(ReadStatus.FAILED, reason=failure_reason(error), error=error)
