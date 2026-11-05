"""Already applied (KAN-621): whether the student sent an application to a
Posting before, so a rehearsal or a run does not open and fill its form again.

Astranis, 2026-11-04: a rehearsal filled a form that Lisul had applied to
(the Applications Tracker had it at applied, Gmail had the confirmation) and
held it with Submit live, and he sent it a second time.

The check reads, once per run or rehearsal:

- the student's Applications Tracker on WorkIt (`WorkIt.applications`): an
  application at applied or later (`workit.APPLIED_STAGES`) whose job link
  is the same job (`sheet_import.job_key`, WorkIt's link rule);
- Apply's own Tracker (`tracker.json`): a submitted row with the same
  Application ID or job;
- the Records: a rehearsal's or a run's Record of the same Application with
  `after-submit.png` (only a submit saves one).

A WorkIt that can't be read (no login, an expired login, no answer) is no
pass: `problem()` says why, for the window and the terminal, and the local
checks still run.
"""

import threading
from dataclasses import dataclass
from datetime import date
from pathlib import Path

from apply.home import HOME
from apply.model import Posting, Status
from apply.sheet_import import job_key
from apply.tracker import TRACKER, FileTracker
from apply.workit import APPLIED_STAGES, LoginExpired, NotLoggedIn, Unreachable, WorkIt

# What the window and the terminal say when WorkIt could not be checked.
UNCHECKED = ("Couldn't check your Applications Tracker on WorkIt for jobs you already applied to: {}. "
             "Apply checked only its own Tracker and Records")

# Where Records live: a rehearsal's (cli.REHEARSALS) and a live run's clone (records.CLONE).
RECORDS = (HOME / "rehearsals", HOME / "apply-records")


@dataclass(frozen=True)
class Applied:
    """An application the student already sent to the Posting."""

    on: date | None  # the day it was sent; None when the source has no date
    where: str  # what said so: "your Applications Tracker on WorkIt (applied)", say

    def said(self) -> str:
        return f"Already applied on {self.on.isoformat() if self.on else 'an unknown day'} ({self.where})"

    def day(self) -> str:
        return self.on.isoformat() if self.on else "an earlier day"


class NoCheck:
    """No check: what a test that doesn't look at it gets."""

    def of(self, posting: Posting, *links: str) -> Applied | None:
        return None

    def problem(self) -> str:
        return ""


class Check:
    """The check of every Posting of one run or rehearsal. WorkIt is read the first time it is needed, once."""

    def __init__(self, client: WorkIt | None = None, tracker: Path = TRACKER, records: tuple[Path, ...] = RECORDS):
        self._client = client
        self._tracker = tracker
        self._records = records
        self._lock = threading.Lock()
        self._applied: dict[str, Applied] | None = None  # WorkIt's, by job key
        self._problem = ""

    def of(self, posting: Posting, *links: str) -> Applied | None:
        """The student's earlier application to `posting` (or the job at any of `links`), or None."""
        keys = {job_key(u) for u in (posting.url, *links) if u}
        found = next((a for k, a in self._workit().items() if k in keys), None)
        return found or self._in_tracker(posting.id, keys) or self._in_records(posting.id)

    def problem(self) -> str:
        """Why the Applications Tracker on WorkIt could not be checked ("" when it was). Reads it, if not yet."""
        self._workit()
        with self._lock:
            return self._problem

    def _workit(self) -> dict[str, Applied]:
        with self._lock:
            if self._applied is None:
                self._applied = {}
                try:
                    client = self._client or WorkIt()
                    for a in client.applications(client.applicant_id()):
                        if a.get("stage") in APPLIED_STAGES and (a.get("job") or {}).get("apply_url"):
                            on = _day(a.get("applied_at"))
                            self._applied[job_key(a["job"]["apply_url"])] = Applied(
                                on, f"your Applications Tracker on WorkIt: {a['stage']}")
                except NotLoggedIn:
                    self._problem = "you are not signed in to WorkIt (run `uv run apply login`)"
                except LoginExpired:
                    self._problem = "your WorkIt login expired (run `uv run apply login`)"
                except Unreachable as error:
                    self._problem = f"WorkIt did not answer ({error})"
                except Exception as error:
                    self._problem = f"{type(error).__name__}: {error}"
            return self._applied

    def _in_tracker(self, application_id: str, keys: set[str]) -> Applied | None:
        if not self._tracker.exists():
            return None
        try:
            rows = FileTracker(self._tracker).rows()
        except Exception:
            return None  # an unreadable file: WorkIt and the Records still say
        for row in rows:
            if row.status == Status.SUBMITTED and (row.application_id == application_id
                                                   or (row.posting_url and job_key(row.posting_url) in keys)):
                return Applied(row.date_applied, "Apply's Tracker: submitted")
        return None

    def _in_records(self, application_id: str) -> Applied | None:
        if not application_id:
            return None
        for root in self._records:
            for sent in sorted(root.glob(f"*/*-{application_id}/after-submit.png"), reverse=True):
                return Applied(_day(sent.parent.parent.name), f"its Record says submitted: {sent.parent}")
        return None


def _day(text: object) -> date | None:
    try:
        return date.fromisoformat(str(text)[:10])
    except ValueError:
        return None
