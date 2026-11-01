"""Read one complete board with shared robots, pacing, and failure semantics.

No printing or persistence: scheduled scraping and discovery format the result
for their own reports. Empty success remains different from a missing board.
"""

from __future__ import annotations

import re
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


#: A name that is a careers page, a program or one board of several, not a company.
#: Greenhouse gave 25 of 242 sampled boards one (2026-11-01): "Careers at KKR",
#: "C3 AI Ascend Internship Program: Summer 2027", "Referrals Only". It rejects 14
#: of the 4,777 curated names, half of them such names too ("Lytx Careers") and
#: half with a part after a dash ("University of Texas - Austin"): a rejected board
#: only waits for a person to name it, and a wrong name goes on every job card.
NOT_A_COMPANY = re.compile(
    r"\b(?:careers?|jobs?|job boards?|join|talent community|hiring|recruit\w*|referrals?"
    r"|interns?|internships?|programs?|programmes?|campus|new grads?"
    r"|summer (?:associate|analyst|intern)\w*|invitation only|external|internal"
    r"|not advertised)\b"
    # Not as the first word: "Handshake" and "2020 Companies" are companies.
    r"|(?<=.)\b(?:handshake|20\d\d)\b"
    # A part after a separator: "ACLU - Internships", "SanMar- External".
    r"|\s[-–:]|[-–:]\s",
    re.I,
)


def reported_name(board: Board, robots: Robots) -> str | None:
    """The company name the hiring system itself gives a board (`Provider.name_url`).
    None when it gives none, gives a careers page or program (`NOT_A_COMPANY`),
    robots.txt forbids the page, or the page cannot be read: the board then stays
    unnamed (`needs_company`), never named by a guess."""
    provider = providers.PROVIDERS.get(board.ats)
    if provider is None or provider.read_name is None:
        return None
    url = providers.name_url(board.ats, board.token)
    if not robots.allows(url):
        return None
    robots.pace(url)
    try:
        name = provider.read_name(providers.fetch._get_text(url))
    except Exception:  # A lost name leaves the board unproposed, nothing worse.
        return None
    return None if name is None or NOT_A_COMPANY.search(name) else name
