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
import tempfile
import time
from contextlib import contextmanager
from pathlib import Path

from apply.home import HOME

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
