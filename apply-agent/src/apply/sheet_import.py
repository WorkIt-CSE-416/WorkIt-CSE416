"""`apply import-sheet`: put each submitted row of Apply's Tracker Sheet into WorkIt's
Applications Tracker, one time (KAN-545, spec KAN-541, ADR 0007).

For each row with status submitted, the import finds or adds the job posting by its
link (an added job when WorkIt does not list it), sets the stage from
the row's Outcome, sets the applied date from Date applied, and keeps the
Application's resume from the sent folder as its Sent resume when there is one.

It first makes a dry run that writes nothing: it reads the Sheet and asks WorkIt
only reads (`POST /jobs/listed-by-link` writes nothing). It lists each add, each
skip and each row it cannot place fully. It writes only when the student types
yes. It never changes an application that is applied or later in WorkIt, so it
can run again: a second run adds nothing.
"""

import re
import sys
from collections.abc import Callable
from dataclasses import dataclass
from datetime import date
from pathlib import Path
from typing import TextIO
from urllib.parse import parse_qs, urlsplit

from apply.attach import COVER, RESUME
from apply.model import Outcome, Status
from apply.workit import APPLIED_STAGES, Stage, Unreachable, WorkIt, WorkItError

# The stage each Outcome sets. Every other Outcome, and a blank one, is applied. The import never changes an
# application at applied or later (workit.APPLIED_STAGES).
STAGE_OF = {Outcome.INTERVIEW: Stage.INTERVIEWING, Outcome.OFFER: Stage.OFFER, Outcome.REJECTED: Stage.REJECTED}
KNOWN_OUTCOMES = {outcome.value.lower() for outcome in Outcome}


@dataclass(frozen=True)
class SheetRow:
    """One Applications row of the Tracker Sheet, as text. `number` is its row number in the Sheet."""

    number: int
    application_id: str
    company: str
    role: str
    posting: str
    status: str
    date_applied: str
    outcome: str


@dataclass(frozen=True)
class Step:
    """What the import does with one row."""

    row: SheetRow
    action: str  # "add" or "skip"
    why: str  # for an add: where the job is in WorkIt; for a skip: the reason
    stage: str = ""
    applied_on: date | None = None
    resume: Path | None = None
    checks: tuple[str, ...] = ()  # what the Sheet did not say, for an add the student must check


def sheet_rows(cells: list[list[str]]) -> list[SheetRow]:
    """The Applications tab's rows with an Application ID, from its values (the header row first). A Sheet laid
    out before a column existed has no such column: its cells are blank."""
    headers, *values = cells
    rows = []
    for number, row in enumerate(values, 2):
        cell = dict(zip(headers, row))
        text = {header: cell.get(header, "").strip() for header in
                ("Application ID", "Company", "Role", "Posting", "Status", "Date applied", "Outcome")}
        if text["Application ID"]:
            rows.append(SheetRow(number, *text.values()))
    return rows


def plan(rows: list[SheetRow], client: WorkIt, sent: Path) -> list[Step]:
    """The dry run: what the import would do with each row. It reads WorkIt and writes nothing."""
    me = client.me().id
    tracker = [(a["job"]["apply_url"], a["stage"]) for a in client.applications(me)]
    steps, seen = [], {}
    for row in rows:
        if row.status != Status.SUBMITTED:
            steps.append(Step(row, "skip", f"not submitted ({row.status or 'no status'})"))
            continue
        if not row.posting.startswith(("http://", "https://")):
            steps.append(Step(row, "skip", "no Posting link: WorkIt finds a job by its link. Add it by hand"))
            continue
        key = job_key(row.posting)
        if key in seen:
            steps.append(Step(row, "skip", f"the same job as row {seen[key]}"))
            continue
        seen[key] = row.number
        listed = client.listed_by_link(row.posting)
        stage = listed[1] if listed else next((s for url, s in tracker if job_key(url) == key), None)
        if stage in APPLIED_STAGES:
            steps.append(Step(row, "skip", f"already in WorkIt at {stage}: the import does not change it"))
            continue
        where = "listed" if listed else "not listed: WorkIt keeps it as an added job"
        if stage:
            where += f", on your tracker at {stage}"
        steps.append(_add(row, where, sent))
    return steps


def _add(row: SheetRow, where: str, sent: Path) -> Step:
    checks = []
    outcome = row.outcome.lower()
    if outcome and outcome not in KNOWN_OUTCOMES:
        checks.append(f'Outcome "{row.outcome}" is not one the import knows: it goes in as applied')
    stage = next((s for o, s in STAGE_OF.items() if o.value.lower() == outcome), Stage.APPLIED)
    try:
        applied_on = date.fromisoformat(row.date_applied)
    except ValueError:
        applied_on = None
        checks.append(f'Date applied "{row.date_applied}" is not a date: WorkIt dates it today'
                      if row.date_applied else "no Date applied: WorkIt dates it today")
    return Step(row, "add", where, stage, applied_on, sent_resume(sent, row.application_id, applied_on),
                tuple(checks))


def sent_resume(sent: Path, application_id: str, day: date | None) -> Path | None:
    """The resume Apply gave the Application's form: from its folder under `sent` (worker.sent_folder), the file
    named as a resume and not as a cover letter. The folder of the day it was applied comes first, then the newest.
    None when no folder has one."""
    suffix = "-" + re.sub(r"[^A-Za-z0-9_-]+", "-", application_id)
    folders = sorted((f for f in sent.glob("*/*") if f.is_dir() and f.name.endswith(suffix)),
                     key=lambda f: (f.parent.name == (day.isoformat() if day else ""), f.parent.name), reverse=True)
    for folder in folders:
        resumes = sorted((f for f in folder.iterdir() if f.is_file() and re.search(RESUME, f.name, re.IGNORECASE)
                          and not re.search(COVER, f.name, re.IGNORECASE)), key=lambda f: f.stat().st_mtime, reverse=True)
        if resumes:
            return resumes[0]
    return None


def job_key(url: str) -> str:
    """One job's key, as WorkIt matches links (KAN-542): the Greenhouse job ID, else the link without its
    scheme, www., query, fragment and trailing slash, lower case."""
    parts = urlsplit(url)
    query = parse_qs(parts.query)
    if (parts.hostname or "").lower().endswith("greenhouse.io"):
        if m := re.match(r"/[\w-]+/jobs/(\d+)(?:/|$)", parts.path):
            return f"greenhouse:{m[1]}"
        if parts.path.startswith("/embed/job_app") and query.get("token", [""])[0].isdigit():
            return f"greenhouse:{query['token'][0]}"
    if query.get("gh_jid", [""])[0].isdigit():
        return f"greenhouse:{query['gh_jid'][0]}"
    return re.sub(r"^[a-z][a-z0-9+.-]*://(www\.)?", "", url, flags=re.IGNORECASE).split("#")[0].split("?")[0].rstrip("/").lower()


def show(steps: list[Step], out: TextIO) -> None:
    """The dry run, for the student to read and approve."""
    adds = [s for s in steps if s.action == "add"]
    checks = [(s, check) for s in adds for check in s.checks]
    skips = [s for s in steps if s.action == "skip"]
    print(f"Dry run: nothing is written yet. {len(steps)} rows in the Tracker Sheet.", file=out)
    print(f"\nAdd to the Applications Tracker ({len(adds)}):", file=out)
    for s in adds:
        day = s.applied_on.isoformat() if s.applied_on else "today"
        print(f"  row {s.row.number}: {s.row.company} | {s.row.role} | {s.stage} | {day} | "
              f"resume: {'yes' if s.resume else 'no'} | {s.why} | {s.row.posting}", file=out)
    if checks:
        print(f"\nCheck these ({len(checks)}): added, but the Sheet did not say everything:", file=out)
        for s, check in checks:
            print(f"  row {s.row.number}: {s.row.company} | {s.row.role} | {check}", file=out)
    print(f"\nSkip ({len(skips)}):", file=out)
    for s in skips:
        print(f"  row {s.row.number}: {s.row.company} | {s.row.role} | {s.why}", file=out)


def write(steps: list[Step], client: WorkIt, out: TextIO) -> tuple[int, int]:
    """Make each add of an approved dry run. Answers how many were added and how many failed. An application that is applied or later
    by the time of its add is left as it is. WorkIt not answering stops the import; run it again later."""
    added = failed = 0
    for s in (s for s in steps if s.action == "add"):
        name = f"row {s.row.number}: {s.row.company} | {s.row.role}"
        try:
            stage = client.record_applied(s.row.posting, s.row.company, s.row.role, s.resume, s.stage, s.applied_on)
            if stage:
                print(f"  {name}: already in WorkIt at {stage}, left as it is", file=out)
                continue
        except Unreachable:
            raise
        except WorkItError as error:
            failed += 1
            print(f"  {name}: FAILED: {error}", file=out)
            continue
        added += 1
        print(f"  {name}: added at {s.stage}{' with its resume' if s.resume else ''}", file=out)
    return added, failed


def run(cells: list[list[str]], client: WorkIt, sent: Path, approve: Callable[[str], str] = input,
        out: TextIO = sys.stdout, dry_run: bool = False) -> int:
    """The command: the dry run, then, when the student types yes, the writes. Its exit status."""
    steps = plan(sheet_rows(cells), client, sent)
    show(steps, out)
    adds = sum(s.action == "add" for s in steps)
    if dry_run or not adds:
        return 0
    if approve(f"\nWrite these {adds} to your Applications Tracker? Type yes to write: ").strip().lower() != "yes":
        print("Nothing written.", file=out)
        return 0
    added, failed = write(steps, client, out)
    print(f"Done: {added} added, {failed} failed. Run it again to retry: it skips what is in WorkIt.",
          file=out)
    return 1 if failed else 0
