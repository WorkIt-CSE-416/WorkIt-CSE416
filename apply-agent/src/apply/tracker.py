"""The Tracker: one row per Application."""

import dataclasses
from dataclasses import dataclass
from datetime import date

from apply.model import Outcome, Posting, Status


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
