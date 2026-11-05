"""The Tracker: one row per Application.

Apply keeps it in the data folder (`FileTracker`, KAN-544). It is Apply's own
working state: Holds to approve, Missing facts to answer, Requests, Employer
accounts and the Answers list. The record of where each application stands
is WorkIt's Applications Tracker (../docs/adr/0007)."""

import dataclasses
import fcntl
import json
import os
import sys
from collections.abc import Callable
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import date
from pathlib import Path

from apply.home import HOME
from apply.model import Outcome, Posting, Status
from apply.workit import Stage, Write


@dataclass
class Row:
    """One Application's Tracker row, found by Application ID, never by position.

    The Orchestrator writes every field but Lisul's: approve, outcome, answer,
    and the essay once the row is held. It only reads those. `apply mail`
    writes the Suggested outcome beside Lisul's Outcome, never the Outcome."""

    application_id: str
    company: str
    role: str
    posting_url: str
    job_system: str
    status: Status
    date_applied: date | None = None
    reason: str = ""
    record: str = ""  # link to the Application's Record
    missing_fact: str = ""  # the question no Applicant profile entry answers
    missing_fact_options: str = ""  # what its form offers to pick from, one a line (options_cell)
    bot_signals: str = ""  # how a filled form's Chrome ran, and its Bot signals: "headless: captcha"
    essay: str = ""  # a held Application's High-stakes essay, which Lisul may edit
    answer: str = ""  # Lisul's answer to the Missing fact
    approve: bool = False  # Lisul releases a Hold
    outcome: Outcome | None = None
    suggested_outcome: Outcome | None = None  # what the employer's latest mail says, for Lisul to confirm
    confirmation_received: date | None = None  # the day an employer's mail showed the Application arrived

    def posting(self) -> Posting:
        """The Posting this row's Application is for, rebuilt from the row."""
        return Posting(id=self.application_id, company=self.company, title=self.role, url=self.posting_url)


@dataclass(frozen=True)
class EmployerAccount:
    """A login Apply created on one employer's careers site. Its password lives
    only in macOS Keychain, never in the Tracker."""

    company: str
    site: str
    login: str
    created: date


@dataclass(frozen=True)
class AnswerRow:
    """One Answer bank entry in the Tracker's Answers tab. Apply adds a row
    for each answer Claude drafts and never writes it again; Lisul edits its
    answer or ticks it reviewed, and the next run copies that into the bank."""

    question: str
    answer: str  # Lisul's to edit; a select-all-that-apply's options are joined by "; "
    reviewed: bool = False  # Lisul's
    drafted: str = ""  # the answer as Apply listed it, so an edit shows
    options: tuple[str, ...] = ()
    company: str = ""  # where it was first asked
    first_seen: date | None = None


# Heads a Missing fact options cell whose question takes any number of the options.
ANY_OF = "Any of:"


def options_cell(choices: dict | None) -> str:
    """A Missing fact's choices (worker.choices) as its Tracker cell: one option a
    line, under ANY_OF when it takes several; "" for one answered in words."""
    if not choices:
        return ""
    return "\n".join(([ANY_OF] if choices["kind"] == "multi_select" else []) + choices["options"])


def cell_options(cell: str) -> dict | None:
    """A Missing fact options cell back as its choices, None if it is empty."""
    lines = [line.strip() for line in cell.splitlines() if line.strip()]
    many = bool(lines) and lines[0] == ANY_OF
    options = lines[1:] if many else lines
    return {"kind": "multi_select" if many else "select", "options": options} if options else None


# Row fields only Lisul writes.
LISULS = {"approve", "outcome", "answer"}


def check_writable(row: Row, fields: dict) -> None:
    """Raise ValueError if `fields` would overwrite anything Lisul owns in `row`."""
    for field in fields:
        if field in LISULS or (field == "essay" and row.status == Status.HELD):
            raise ValueError(f"{field} on {row.application_id} is the applicant's; the Orchestrator only reads it")


def check_new(row: Row) -> None:
    """Raise ValueError if a new row sets anything only Lisul writes."""
    check_writable(row, {field: value for field in LISULS if (value := getattr(row, field))})


class InMemoryTracker:
    """The Tracker fake for whole-run tests, with Lisul's edits made by hand."""

    def __init__(self):
        self._rows: dict[str, Row] = {}
        self._requests: list[str] = []
        self._accounts: list[EmployerAccount] = []
        self._answers: list[AnswerRow] = []

    def add(self, row: Row) -> None:
        check_new(row)
        if row.application_id in self._rows:
            raise ValueError(f"{row.application_id} already has a row")
        self._rows[row.application_id] = row

    def update(self, application_id: str, **fields) -> None:
        row = self._rows[application_id]
        check_writable(row, fields)
        self._rows[application_id] = dataclasses.replace(row, **fields)

    def answer(self, application_id: str, text: str) -> None:
        self._rows[application_id] = dataclasses.replace(self._rows[application_id], answer=text)

    def approve(self, application_id: str, essay: str | None = None) -> None:
        """Lisul approves a Hold in the Apply window: the next check sends it,
        with `essay` (his edit of its essays) in place of the row's when given."""
        edits = {"approve": True} | ({"essay": essay} if essay is not None else {})
        self._rows[application_id] = dataclasses.replace(self._rows[application_id], **edits)

    def get(self, application_id: str) -> Row | None:
        return self._rows.get(application_id)

    def rows(self) -> list[Row]:
        return list(self._rows.values())

    def edit_as_lisul(self, application_id: str, **fields) -> None:
        """Lisul ticks Approve, picks an Outcome, edits an essay or answers a Missing fact."""
        self._rows[application_id] = dataclasses.replace(self._rows[application_id], **fields)

    def requests(self) -> list[str]:
        return list(self._requests)

    def remove_request(self, url: str) -> None:
        if url in self._requests:
            self._requests.remove(url)

    def add_request(self, url: str) -> None:
        self._requests.append(url.strip())

    def add_employer_account(self, account: EmployerAccount) -> None:
        self._accounts.append(account)

    def employer_accounts(self) -> list[EmployerAccount]:
        return list(self._accounts)

    def add_answer(self, row: AnswerRow) -> None:
        self._answers.append(row)

    def answers(self) -> list[AnswerRow]:
        return list(self._answers)

    def edit_answer_as_lisul(self, question: str, **fields) -> None:
        """Lisul edits an answer in the Answers tab, or ticks it reviewed."""
        [n] = [n for n, row in enumerate(self._answers) if row.question == question]
        self._answers[n] = dataclasses.replace(self._answers[n], **fields)

    def paste_request(self, url: str) -> None:
        """Lisul pastes a Posting link into the Requests tab."""
        self._requests.append(url.strip())


# The Tracker file in the data folder.
TRACKER = HOME / "tracker.json"

# FileTracker's methods that change the file; every other one only reads it.
_WRITES = ("add", "update", "answer", "approve", "edit_as_lisul", "remove_request", "add_request", "paste_request",
           "add_employer_account", "add_answer", "edit_answer_as_lisul")
_READS = ("get", "rows", "requests", "employer_accounts", "answers")


class FileTracker(InMemoryTracker):
    """The Tracker as one JSON file in the data folder (KAN-544). Each call
    reads the file, and each write saves it again (atomically), under a lock
    file: several processes (a run, the window, `apply mail`) share it."""

    def __init__(self, path: Path = TRACKER):
        super().__init__()
        self.path = path

    @contextmanager
    def _held(self, write: bool):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with open(self.path.with_suffix(".lock"), "a") as lock:
            fcntl.flock(lock, fcntl.LOCK_EX)
            self._load()
            yield
            if write:
                self._save()

    def fill(self, rows: list[Row], requests: list[str]) -> None:
        """Put rows and Requests in as they are, Lisul's cells too: the one-time copy of the Sheet."""
        with self._held(write=True):
            for row in rows:
                self._rows.setdefault(row.application_id, row)
            self._requests += [url for url in requests if url not in self._requests]

    def _load(self) -> None:
        try:
            saved = json.loads(self.path.read_text())
        except FileNotFoundError:
            saved = {}
        self._rows = {row["application_id"]: _row(row) for row in saved.get("applications", [])}
        self._requests = list(saved.get("requests", []))
        self._accounts = [EmployerAccount(**{**a, "created": date.fromisoformat(a["created"])})
                          for a in saved.get("employer_accounts", [])]
        self._answers = [AnswerRow(**{**a, "options": tuple(a["options"]),
                                      "first_seen": date.fromisoformat(a["first_seen"]) if a["first_seen"] else None})
                         for a in saved.get("answers", [])]

    def _save(self) -> None:
        saved = {"applications": [dataclasses.asdict(row) for row in self._rows.values()],
                 "requests": self._requests,
                 "employer_accounts": [dataclasses.asdict(a) for a in self._accounts],
                 "answers": [dataclasses.asdict(a) for a in self._answers]}
        part = self.path.with_suffix(".part")
        part.write_text(json.dumps(saved, indent=1, default=_plain))
        os.replace(part, self.path)


def past_applications(posting_url: str = "", path: Path | None = None) -> tuple[list[str], list[str]]:
    """The companies the Tracker shows an Application submitted to, and those of them where Lisul's Outcome
    is an interview or an offer, but for `posting_url`'s own row (the Application being filled). Read
    without the lock: the file is saved whole (os.replace), and a plan may run while a write holds it."""
    try:
        saved = json.loads((path or TRACKER).read_text())
    except (OSError, ValueError):
        return [], []
    rows = [row for row in saved.get("applications", []) if row.get("company") and row.get("posting_url") != posting_url
            and row.get("status") == Status.SUBMITTED]
    interviewed = (Outcome.INTERVIEW, Outcome.OFFER)
    return (sorted({row["company"] for row in rows}),
            sorted({row["company"] for row in rows if row.get("outcome") in interviewed}))


def _plain(value):
    if isinstance(value, date):
        return value.isoformat()
    raise TypeError(type(value).__name__)


def _row(saved: dict) -> Row:
    day = lambda value: date.fromisoformat(value) if value else None
    return Row(**{**saved, "status": Status(saved["status"]), "date_applied": day(saved["date_applied"]),
                  "outcome": Outcome(saved["outcome"]) if saved["outcome"] else None,
                  "suggested_outcome": Outcome(saved["suggested_outcome"]) if saved["suggested_outcome"] else None,
                  "confirmation_received": day(saved["confirmation_received"])})


def _locked_call(name: str, write: bool):
    method = getattr(InMemoryTracker, name)

    def call(self, *args, **kwargs):
        with self._held(write):
            return method(self, *args, **kwargs)

    call.__name__, call.__doc__ = name, method.__doc__
    return call


for _name in _WRITES + _READS:
    setattr(FileTracker, _name, _locked_call(_name, _name in _WRITES))


# The Applications Tracker stage each Apply status writes (KAN-544). Other
# statuses (filling, queued, failed, closed...) write nothing. A Hold is
# needs_you, never queued: WorkIt's extension fills queued applications.
STAGES = {Status.SUBMITTED: Stage.APPLIED, Status.HANDOFF: Stage.NEEDS_YOU, Status.MISSING_FACT: Stage.NEEDS_YOU,
          Status.HELD: Stage.NEEDS_YOU}


class WorkItTracker:
    """A Tracker that also writes each Application's new status to the
    student's Applications Tracker (KAN-544), through workit.WaitingWrites:
    the row is kept in `inner` first, then the write goes, or waits in the
    queue. `resume_of(application_id)` is the file a
    submitted form was given as the resume ("" for none), kept as its Sent
    resume. A write that fails is said and never stops the run."""

    def __init__(self, inner, writes, resume_of: Callable[[str], str]):
        self.inner = inner
        self._writes = writes
        self._resume_of = resume_of

    def __getattr__(self, name):
        return getattr(self.inner, name)

    def add(self, row: Row) -> None:
        self.inner.add(row)
        self._record(row, None)

    def update(self, application_id: str, **fields) -> None:
        before = self.inner.get(application_id)
        self.inner.update(application_id, **fields)
        if "status" in fields:
            self._record(self.inner.get(application_id), before.status if before else None)

    def _record(self, row: Row, before: Status | None) -> None:
        stage = STAGES.get(row.status)
        if stage is None or row.status == before:
            return
        try:
            said = self._writes.send(Write(
                row.application_id, row.posting_url, row.company or "Unknown company", row.role or "Job", stage,
                self._resume_of(row.application_id) if stage == Stage.APPLIED else ""))
        except Exception as error:  # the run goes on: the row is in Apply's own Tracker
            said = f"not in your Applications Tracker ({type(error).__name__}: {error})"
        print(f"{row.company}, {row.role}: {said}", file=sys.stderr)
