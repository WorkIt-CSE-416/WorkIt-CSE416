"""Where Apply keeps data: the applicant's own files in one data folder, its code's inputs in the checkout.

HOME is $APPLY_HOME, else ~/.config/apply. It holds everything personal (the
Applicant profile, Answer bank, Story bank, voice, policies override, company
briefs) and everything Apply writes (Traces, rehearsals, Repairs, Worker
profiles). Every data path derives from it, read once at import.

CODE is Apply's folder in the checkout (apply-agent/): only generic inputs live there (the
answering guides, the default policies, the profile template, and SAMPLE, the
Test Person data a first run starts from).
"""

import os
import shutil
import tempfile
from pathlib import Path

HOME = Path(os.environ.get("APPLY_HOME") or "~/.config/apply").expanduser()
CODE = Path(__file__).resolve().parents[2]
# The Story bank, read by essays, gates, stock answers and the story map: one path, so a test moves all of them.
STORY_BANK = HOME / "story-bank.md"
# The Test Person sample data: copied into a data folder that has no Applicant profile yet, never written to.
SAMPLE = CODE / "sample"
# Where a reboot wipes what lives there: held forms, notes and signed-in Worker profiles went this way on 2026-11-05.
TEMP_FOLDERS = ("/tmp", "/private/tmp", "/var/folders", "/private/var/folders")
# A test run's own switch: its data folder is a temp one on purpose.
TEMP_OK = "APPLY_TEST_TEMP_OK"


def in_temp(path: Path) -> bool:
    """Whether a folder is under a temp path, by its name and by where its links lead (/tmp is /private/tmp)."""
    path = Path(path).expanduser()
    return any(p == t or p.startswith(t + "/") for p in (str(path), str(path.resolve())) for t in (*TEMP_FOLDERS, tempfile.gettempdir()))


def temp_state(profiles: Path) -> str | None:
    """Why this data folder or profiles folder can't hold live state, in one line; None when it can."""
    if os.environ.get(TEMP_OK):
        return None
    named = next(((name, f) for name, f in (("APPLY_HOME", HOME), ("the profiles folder (APPLY_PROFILES)", profiles)) if in_temp(f)), None)
    if not named:
        return None
    return (f"{named[0]} is {named[1]}, a temp folder, and a reboot wipes it: held forms, sign-ins and Records would be lost. "
            "Set APPLY_HOME and APPLY_PROFILES to a lasting folder, such as ~/.config/apply, or unset them.")


def fill_from_sample() -> bool:
    """On the first run (no Applicant profile in HOME), copy the sample into HOME, beside anything
    already there, and say so; True when it did."""
    if (HOME / "applicant-profile.yaml").exists():
        return False
    shutil.copytree(SAMPLE, HOME, dirs_exist_ok=True,
                    ignore=lambda folder, names: [n for n in names if (HOME / Path(folder).relative_to(SAMPLE) / n).is_file()])
    return True
