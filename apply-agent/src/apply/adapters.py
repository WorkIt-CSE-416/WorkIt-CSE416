"""Interfaces to every outside system. Live implementations talk to the real
thing; tests pass fakes (apply/tests/fakes.py)."""

from collections.abc import Callable
from contextlib import AbstractContextManager
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import TYPE_CHECKING, Protocol

from playwright.sync_api import Page

from apply import already_applied
from apply.answer_bank import AnswerBank
from apply.dashboard import Board, NoBoard
from apply.keychain import InMemoryKeychain
from apply.model import Posting
from apply.notify import RecordingNotifier
from apply.records import InMemoryRecords, Record
from apply.repair import RepairRequests

if TYPE_CHECKING:
    from apply.gmail import MailedCode
    from apply.tracker import AnswerRow, EmployerAccount, Row


class Feed(Protocol):
    """The public list of internship Postings that every run reads from."""

    def postings(self) -> list[Posting]: ...


class Tracker(Protocol):
    """One row per Application, keyed by Application ID. Only the Orchestrator
    writes it, and never Lisul's columns (see Row)."""

    def add(self, row: "Row") -> None:
        """Add a new row. ValueError if the Application ID already has one."""
        ...

    def update(self, application_id: str, **fields) -> None:
        """Write the given Row fields. KeyError for an unknown Application ID,
        ValueError for a field Lisul owns."""
        ...

    def answer(self, application_id: str, text: str) -> None:
        """Lisul's answer to his Application's Missing fact, typed in the Apply
        window, in his own Answer cell: as if he typed it in the Sheet. The
        only one of his cells Apply writes, and only for him. KeyError for an unknown ID."""
        ...

    def approve(self, application_id: str, essay: str | None = None) -> None:
        """Lisul approves his Hold in the Apply window (KAN-544): Approve, and
        `essay`, his edit of its essays, when he edited them there. The retired
        Tracker Sheet (sheet.SheetTracker) takes no approval (ADR 0007).
        KeyError for an unknown ID."""
        ...

    def get(self, application_id: str) -> "Row | None": ...

    def rows(self) -> list["Row"]: ...

    def requests(self) -> list[str]:
        """Posting links Lisul pasted into the Requests tab, in order."""
        ...

    def remove_request(self, url: str) -> None:
        """Take a link off the Requests tab once its Application has a row."""
        ...

    def add_request(self, url: str) -> None:
        """Put a link at the end of the Requests tab, as `apply add` does."""
        ...

    def add_employer_account(self, account: "EmployerAccount") -> None: ...

    def employer_accounts(self) -> list["EmployerAccount"]: ...

    def add_answer(self, row: "AnswerRow") -> None:
        """List an Answer bank entry in the Answers tab."""
        ...

    def answers(self) -> list["AnswerRow"]:
        """The Answers tab's rows, as Lisul left them."""
        ...


class JobSite(Protocol):
    """The job systems' servers, and the Worker's browser that opens their forms."""

    def fetch(self, url: str, body: bytes | None = None) -> bytes:
        """A read-only request, such as a Question set API: a GET, or with
        `body` a JSON POST that only reads, such as Ashby's GraphQL query."""
        ...

    def open(self, url: str, worker: int = 0) -> AbstractContextManager[Page]:
        """Open a Posting's form in a page of Worker `worker`'s own browser
        (its Worker profile), closed on exit."""
        ...


@dataclass(frozen=True)
class Drive:
    """What one capped session of Claude driving a browser gave back: its
    structured answer (None when it was stopped at its cap), and what it cost."""

    output: dict | None
    turns: int
    tokens: int
    capped: bool = False


class Claude(Protocol):
    """Lean `claude -p` calls on Lisul's Max login: a replaced system prompt, no
    settings, no tools, structured JSON output. Called only for answers no
    stored fact covers, for the Pre-submit review, and to drive the forms of
    job systems with no Filler."""

    def ask(self, *, model: str, system: str, prompt: str, schema: dict) -> dict:
        """The structured answer. Raises UsageLimitHit when the Max limit is hit."""
        ...

    def drive(self, *, page: Page, model: str, system: str, prompt: str, schema: dict, files: list[Path],
              max_turns: int, max_tokens: int, hook: tuple[str, ...] = ()) -> Drive:
        """Claude works the open `page` step by step (Playwright MCP, its only
        tools) until it gives the structured answer. It is stopped, capped,
        once it passes `max_turns` turns or `max_tokens` tokens. `files` are
        the only files it can attach, by name. `hook` is the send_click hook's
        flags (Ask Claude's). Raises UsageLimitHit when the Max limit is hit."""
        ...

    def research(self, *, model: str, system: str, prompt: str, schema: dict, max_turns: int,
                 max_tokens: int) -> Drive:
        """Claude searches and reads the web (its only tools) until it gives
        the structured answer, capped as `drive` is. Raises UsageLimitHit when
        the Max limit is hit."""
        ...

    def spent(self) -> int:
        """Tokens (cache reads and writes included) the calls made on this
        thread have used so far. A Worker carries one Application at a time
        on its thread, so the difference across an Application is its cost."""
        ...


class Mailbox(Protocol):
    """Lisul's Gmail, read by script for verification codes and links. Zero
    tokens. `search` is Gmail search terms, such as "from:myworkday.com";
    only mail that arrived at or after `since` counts. One look each: no waiting."""

    def unavailable(self) -> str | None:
        """Why no mail can be read (Gmail isn't set up), or None."""
        ...

    def find_code(self, *, search: str, since: datetime) -> str | None: ...

    def find_mailed_code(self, *, search: str, since: datetime) -> "MailedCode | None":
        """Only a code the mail names as one, never a guess, with the sender's domain."""
        ...

    def find_link(self, *, search: str, since: datetime, hosts: tuple[str, ...]) -> str | None:
        """Only a link to one of `hosts` (or a host under one) counts."""
        ...


class Keychain(Protocol):
    """Lisul's macOS Keychain: one Employer account password per site."""

    def password(self, site: str) -> str | None: ...

    def save(self, site: str, password: str) -> None:
        """Save (or replace) the site's password."""
        ...

    def forget(self, site: str) -> None:
        """Remove the site's password, if it has one."""
        ...

    def sites(self) -> list[str]:
        """Each site with a password, never a password."""
        ...


@dataclass(frozen=True)
class UsageReading:
    """From the latest rate_limit_event: how much of each Max window is used
    (0 to 1), and when each resets. `limited` means the limit is hit: calls are
    rejected until `resets_at` (None if Claude didn't say when)."""

    five_hour: float = 0.0
    weekly: float = 0.0
    five_hour_resets_at: datetime | None = None
    weekly_resets_at: datetime | None = None
    limited: bool = False
    resets_at: datetime | None = None


class SetupError(Exception):
    """This Mac isn't set up for a call (the claude CLI missing or logged out, say): no
    Application can go on until the applicant fixes it, and no Repair could. Its message
    is one line that says how to fix it."""


class UsageLimitHit(Exception):
    """A Claude call was refused because Lisul's Max limit is hit."""

    def __init__(self, resets_at: datetime | None):
        super().__init__(f"Max usage limit hit; resets at {resets_at or 'an unknown time'}")
        self.resets_at = resets_at


class Usage(Protocol):
    """How much of Lisul's Max plan is used, across Apply and his own Claude work."""

    def reading(self) -> UsageReading: ...


class Records(Protocol):
    """Where each filled Application's Record is kept: the private Records repo."""

    def save(self, record: Record) -> str:
        """Keep the Record and return the link the Tracker row shows."""
        ...


class Notifier(Protocol):
    """A notification for Lisul: macOS Notification Center, or a push to his phone."""

    def notify(self, title: str, message: str) -> None: ...


class Clock(Protocol):
    def now(self) -> datetime: ...

    def sleep_until(self, when: datetime) -> None: ...


@dataclass
class Adapters:
    """Everything outside Apply that a run touches."""

    feed: Feed
    tracker: Tracker
    site: JobSite
    claude: Claude
    mailbox: Mailbox
    usage: Usage
    clock: Clock
    # Defaults keep a test that doesn't look at Records or notifications
    # light; live_adapters() must pass the real ones.
    records: Records = field(default_factory=InMemoryRecords)
    notifier: Notifier = field(default_factory=RecordingNotifier)
    # The push to Lisul's phone of what waits on him (ntfy); None while no topic is set up.
    phone: Notifier | None = None
    keychain: Keychain = field(default_factory=InMemoryKeychain)
    board: Board = field(default_factory=NoBoard)  # the dashboard's tile per Worker
    repairs: RepairRequests = field(default_factory=RepairRequests)  # what went wrong, for a Repair
    answer_bank: AnswerBank = field(default_factory=AnswerBank)  # live: answer-bank.yaml beside the profile
    # Sites Lisul signed the Worker profiles in to by hand (apply sign-in): their sign-in walls are no Handoff.
    signed_in: frozenset[str] = frozenset()
    # The student's tailored resume for a Posting (KAN-547), given to its form in place of the profile's resume.
    tailored: Callable[[Posting], bytes | None] = lambda posting: None
    # Opens a bot-blocked posting in the student's everyday Chrome (KAN-590); live: captcha.to_everyday_chrome.
    everyday: Callable[[str], None] = lambda url: None
    # Whether the student already applied to a Posting (KAN-621); live: already_applied.Check, over WorkIt.
    applied_before: "already_applied.Check | already_applied.NoCheck" = field(default_factory=lambda: already_applied.NoCheck())
