"""`apply clean-tracker`: delete the saved and queued applications on WorkIt's Applications Tracker of jobs that
the student did not apply to (KAN-546, spec KAN-541).

A job is applied when the student has an application at applied or later on it in WorkIt (also on another
posting of the same job), or when Apply's Tracker Sheet has it as submitted (not imported yet). It also keeps
a job that Apply's own Tracker (tracker.json) holds or waits on the student for: Apply writes a Hold, a Missing
fact or a Handoff as needs_you (KAN-544), and that write can still wait in the queue. The cleanup
never deletes or changes an application at applied, interviewing, offer or rejected, nor one at needs_you or
skipped: it deletes only saved and queued ones, and WorkIt's delete routes refuse every other stage too.

It first makes a dry run that only reads. It deletes only when the student types yes. Then it reads the tracker
again and says if an applied application is gone.
"""

import sys
from collections.abc import Callable, Iterable
from typing import TextIO

from apply.model import Status
from apply.sheet_import import job_key, sheet_rows
from apply.tracker import STAGES
from apply.workit import APPLIED_STAGES, Stage, Unreachable, WorkIt, WorkItError

DELETED = (Stage.SAVED, Stage.QUEUED)


def plan(applications: list[dict], cells: list[list[str]] | None, keep: Iterable[str] = (),
         apply_rows: Iterable = ()) -> tuple[list, list]:
    """The deletes and the keeps (each an application and why it stays), from the tracker's applications, the
    Tracker Sheet's cells (None when there is no Sheet), the job ids or links the student keeps and the rows of
    Apply's own Tracker (tracker.Row)."""
    applied = {job_key(a["job"]["apply_url"]): f"{_name(a)}, at {a['stage']}"
               for a in applications if a["stage"] in APPLIED_STAGES}
    submitted = {job_key(r.posting): f"Tracker Sheet row {r.number}" for r in sheet_rows(cells or [[]])
                 if r.status == Status.SUBMITTED and r.posting.startswith(("http://", "https://"))}
    kept = set(keep) | {job_key(k) for k in keep}
    unfinished = {job_key(r.posting_url): f"Apply is waiting for you on it ({r.status})" for r in apply_rows
                  if STAGES.get(r.status) == Stage.NEEDS_YOU and r.posting_url}
    deletes, keeps = [], []
    for a in applications:
        key = job_key(a["job"]["apply_url"])
        if a["stage"] in APPLIED_STAGES:
            why = ""
        elif a["stage"] not in DELETED:
            why = "only saved and queued applications are deleted"
        elif key in applied:
            why = f"you applied to this job ({applied[key]})"
        elif key in submitted:
            why = f"you applied to this job ({submitted[key]}). Run `uv run apply import-sheet` first"
        elif key in unfinished:
            why = unfinished[key]
        elif a["job"]["id"] in kept or key in kept:
            why = "you asked to keep it"
        else:
            deletes.append(a)
            continue
        keeps.append((a, why))
    return deletes, keeps


def show(applications: list[dict], deletes: list[dict], keeps: list, out: TextIO) -> None:
    """The dry run, for the student to read and approve."""
    print(f"Dry run: nothing is deleted yet. {len(applications)} applications on your Applications Tracker.",
          file=out)
    print(f"\nDelete ({len(deletes)}): saved or queued, and you did not apply:", file=out)
    for a in deletes:
        print(f"  {_name(a)} | {a['stage']} | {a['job']['apply_url']}", file=out)
    print(f"\nKeep ({len(keeps)}):", file=out)
    for a, why in keeps:
        print(f"  {_name(a)} | {a['stage']}{': ' + why if why else ''}", file=out)


def delete(deletes: list[dict], client: WorkIt, me: str, out: TextIO) -> tuple[int, int]:
    """Delete each application of an approved dry run: how many were deleted and how many WorkIt refused (one
    that is past saved or queued by now stays). WorkIt not answering stops the cleanup; run it again later."""
    deleted = failed = 0
    for a in deletes:
        try:
            if a["stage"] == Stage.SAVED:
                client.unsave(a["job"]["id"])
            else:
                client.dequeue(me, a["job"]["id"])
        except Unreachable:
            raise
        except WorkItError as error:
            failed += 1
            print(f"  {_name(a)}: FAILED: {error}", file=out)
            continue
        deleted += 1
        print(f"  {_name(a)}: deleted", file=out)
    return deleted, failed


def run(client: WorkIt, cells: list[list[str]] | None, keep: Iterable[str] = (), apply_rows: Iterable = (),
        approve: Callable[[str], str] = input, out: TextIO = sys.stdout, dry_run: bool = False) -> int:
    """The command: the dry run, then, when the student types yes, the deletes and the check. Its exit status."""
    me = client.me().id
    applications = client.applications(me)
    deletes, keeps = plan(applications, cells, keep, apply_rows)
    show(applications, deletes, keeps, out)
    if dry_run:
        return 0
    if not deletes:
        print("Nothing to delete.", file=out)
        return 0
    if approve(f"\nDelete these {len(deletes)} from your Applications Tracker? Type yes to delete: "
               ).strip().lower() != "yes":
        print("Nothing deleted.", file=out)
        return 0
    deleted, failed = delete(deletes, client, me, out)
    print(f"Done: {deleted} deleted, {failed} failed.", file=out)
    before = [a for a in applications if a["stage"] in APPLIED_STAGES]
    now = {a["job"]["id"] for a in client.applications(me) if a["stage"] in APPLIED_STAGES}
    lost = [a for a in before if a["job"]["id"] not in now]
    print(f"Applied applications: {len(before)} before, {len(now)} after.", end=" ", file=out)
    if not lost:
        print("None is lost.", file=out)
        return 1 if failed else 0
    print("NOT FOUND after the deletes:", file=out)
    for a in lost:
        print(f"  {_name(a)} | {a['stage']} | {a['job']['apply_url']}", file=out)
    return 1


def _name(application: dict) -> str:
    return f"{application['job']['company'].strip()} | {application['job']['title']}"
