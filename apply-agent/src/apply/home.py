"""Where Apply keeps data: the applicant's own files in one data folder, its code's inputs in the checkout.

HOME is $APPLY_HOME, else ~/.config/apply. It holds everything personal (the
Applicant profile, Answer bank, Story bank, voice, policies override, company
briefs) and everything Apply writes (Traces, rehearsals, Repairs, Worker
profiles). Every data path derives from it, read once at import.

CODE is the apply/ folder of the checkout: only generic inputs live there (the
answering guides, the default policies, the profile template, and SAMPLE, the
Test Person data a first run starts from).
"""

import os
import shutil
from pathlib import Path

HOME = Path(os.environ.get("APPLY_HOME") or "~/.config/apply").expanduser()
CODE = Path(__file__).resolve().parents[2]
# The Story bank, read by essays, gates, stock answers and the story map: one path, so a test moves all of them.
STORY_BANK = HOME / "story-bank.md"
# The Test Person sample data: copied into a data folder that has no Applicant profile yet, never written to.
SAMPLE = CODE / "sample"


def fill_from_sample() -> bool:
    """On the first run (no Applicant profile in HOME), copy the sample into HOME, beside anything
    already there, and say so; True when it did."""
    if (HOME / "applicant-profile.yaml").exists():
        return False
    shutil.copytree(SAMPLE, HOME, dirs_exist_ok=True,
                    ignore=lambda folder, names: [n for n in names if (HOME / Path(folder).relative_to(SAMPLE) / n).is_file()])
    return True
