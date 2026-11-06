"""The batch's open forms, kept on disk as Apply goes (KAN-719), so a restart of the Mac loses none.

APPLY_HOME/open-forms.json lists each form a rehearsal opened and has not seen sent: its link, Application
ID, job system, profiles folder and Worker (so its sign-in, which lives in that Worker's profile), status,
what is left for Lisul, and its Record. A form leaves the list once Lisul submits it from its held page
(`sent`) and the job system confirms it went in, or once Apply finds he applied already. A form he closed,
or one held when Apply or the Mac stopped, stays: `apply reopen` brings it back (KAN-720).

Every process on the data folder writes through one lock (`open-forms.lock`), and each write replaces the
file whole, so a crash mid-write leaves the last good list. The file holds links and Apply's statuses,
never an answer.
"""

import fcntl
import json
import os
import re
import tempfile
import time
from contextlib import contextmanager
from dataclasses import dataclass, field
from pathlib import Path

from apply.home import HOME
from apply.send_click import ATTEST

PATH = HOME / "open-forms.json"
SENT = "sent"  # Lisul pressed the held form's Submit: not confirmed yet, so it stays, and reopen leaves it to him


@contextmanager
def _locked(path: Path):
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path.with_suffix(".lock"), "a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        try:
            yield
        finally:
            fcntl.flock(lock, fcntl.LOCK_UN)


def _read(path: Path) -> dict[str, dict]:
    try:
        forms = json.loads(path.read_text())
    except (OSError, ValueError):
        return {}
    return {f["link"]: f for f in forms if isinstance(f, dict) and f.get("link")} if isinstance(forms, list) else {}


def _write(path: Path, forms: dict[str, dict]) -> None:
    handle, temporary = tempfile.mkstemp(prefix=".open-forms-", dir=path.parent)
    with os.fdopen(handle, "w") as out:
        json.dump(list(forms.values()), out, indent=1)
        out.write("\n")
    os.chmod(temporary, 0o600)
    os.replace(temporary, path)


def forms(path: Path | None = None) -> list[dict]:
    """Every open form, oldest first."""
    return list(_read(path or PATH).values())


def note(link: str, path: Path | None = None, **fields) -> None:
    """Keep or update the open form of `link` (the link the rehearsal was given): its fields as they are now."""
    path = path or PATH
    with _locked(path):
        kept = _read(path)
        entry = kept.setdefault(link, {"link": link, "opened": time.strftime("%Y-%m-%d %H:%M")})
        entry.update({k: v for k, v in fields.items() if v is not None}, updated=time.strftime("%Y-%m-%d %H:%M"))
        _write(path, kept)


def done(link: str, path: Path | None = None) -> None:
    """The form of `link` went in (or was sent before): it leaves the list."""
    path = path or PATH
    with _locked(path):
        kept = _read(path)
        if kept.pop(link, None) is not None:
            _write(path, kept)


# --- Reopening the list after a restart (`apply reopen`, KAN-720)

# A Record's answer that is no value to fill again: a secret (records.REDACTED) or a file's name.
NOT_REFILLED = ("(secret, not recorded)",)
FILE_NAME = re.compile(r"\.(pdf|docx?|rtf|txt|png|jpe?g)$", re.IGNORECASE)


@dataclass
class Plan:
    """What `apply reopen` does with the list, for one profiles folder."""

    firsts: list[str] = field(default_factory=list)  # one link per Worker, in Worker order
    workers: list[int] = field(default_factory=list)  # the Worker of each first link
    later: dict[int, list[str]] = field(default_factory=dict)  # the rest of each Worker's links, in the order opened
    sent: list[dict] = field(default_factory=list)  # forms Lisul pressed Submit on: his to check, never reopened
    elsewhere: dict[str, list[dict]] = field(default_factory=dict)  # forms of other profiles folders, by folder

    @property
    def count(self) -> int:
        return len(self.firsts) + sum(map(len, self.later.values()))


def plan(kept: list[dict], profiles: Path) -> Plan:
    """The reopen plan for `profiles`: each plain Worker's forms go back to that Worker, whose profile holds their
    sign-ins, the first at once and the rest in turn. A CDP Worker's form (one browser per form) gets a Worker
    number of its own, after the plain ones."""
    ours, done = str(Path(profiles).expanduser().resolve()), Plan()
    by_worker: dict[int, list[str]] = {}
    cdp: list[str] = []
    for form in sorted(kept, key=lambda f: str(f.get("opened") or "")):
        folder = str(form.get("profiles") or ours)
        if folder != ours:
            done.elsewhere.setdefault(folder, []).append(form)
        elif form.get("status") == SENT:
            done.sent.append(form)
        elif form.get("plain") is False:
            cdp.append(form["link"])
        else:
            by_worker.setdefault(int(form.get("worker") or 0), []).append(form["link"])
    for worker in sorted(by_worker):
        first, *rest = by_worker[worker]
        done.firsts.append(first)
        done.workers.append(worker)
        if rest:
            done.later[worker] = rest
    free = max(by_worker, default=-1) + 1
    for k, link in enumerate(cdp):
        done.firsts.append(link)
        done.workers.append(free + k)
    return done


def draft(form: dict) -> dict[str, tuple[str, object]]:
    """What a form held when its Record was last saved, by field name, with its question: each answer the page
    showed, never one only planned, a file, a secret, or an attestation, consent or signature (those stay Lisul's
    to tick or sign, send_click.ATTEST). {} when it has no Record. `worker.apply_to` keeps one only where the
    field asks the same question now: Claude fill numbers its fields, and a number may name another field."""
    try:
        rows = json.loads((Path(form["record"]) / "answers.json").read_text())
    except (KeyError, TypeError, OSError, ValueError):
        return {}
    held = {}
    for row in rows if isinstance(rows, list) else []:
        value, question = row.get("on_page"), str(row.get("question") or "")
        if not row.get("field") or value in (None, "", []) or value in NOT_REFILLED or row.get("kind") == "file" \
                or ATTEST.search(question):
            continue
        if "kind" not in row and isinstance(value, str) and FILE_NAME.search(value):
            continue  # a Record from before rows named their kind: a file is told by its name
        held[row["field"]] = (" ".join(question.split()), value)
    labels = [label for label, _ in held.values()]
    return {name: (label, value) for name, (label, value) in held.items() if labels.count(label) == 1}


def lines(done: Plan) -> list[str]:
    """What `apply reopen --list` prints: the plan, one line a form."""
    if not (done.count or done.sent or done.elsewhere):
        return ["No open form on the list: nothing to reopen."]
    out = [f"{done.count} open form{'s' * (done.count != 1)} to reopen here, no timed waits:"]
    for first, worker in zip(done.firsts, done.workers, strict=True):
        out.append(f"  Browser {worker + 1}: {first}")
        out += [f"  Browser {worker + 1}, once the one before has stopped: {link}" for link in done.later.get(worker, [])]
    if done.sent:
        out.append("You pressed Submit on these, so Apply leaves them to you (check your email for each one's confirmation):")
        out += [f"  {f.get('company') or f['link']}: {f['link']}" for f in done.sent]
    for folder, kept in done.elsewhere.items():
        out.append(f"{len(kept)} open in another profiles folder; reopen them with: APPLY_PROFILES={folder} uv run apply reopen")
    return out
