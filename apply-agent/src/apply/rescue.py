"""Rescue: Claude fills the one field a Filler's own code couldn't, so the
Application goes on to the form's next step instead of failing there.

A Filler that drives a field and fails (a FillError, or a click Playwright
timed out on) hands that field to a Rescue: Haiku drives the same open page
(Playwright MCP) to put that one answer in, under a small cap and the drive
guard (apply.submit_guard.DriveGuard), so it can't send the form, sign in
elsewhere, pay, opt in or touch a captcha. The guard is lifted once Claude stops, so the
Filler's own clicks (Save and Continue, its submit) go through as before.
The Filler then reads the field back as it does every field, so the
Pre-submit check judges Claude's fill like its own. Each field rescued is
noted (`notes`), and the Worker files the note as a Repair request: the
Filler's code is still fixed, so the next form needs no rescue.

A rescue that hits its cap, or that Claude says it can't do, gives the
Filler's own error back; one the guard blocked is a Handoff.
"""

import json
from pathlib import Path

from playwright.sync_api import Page

from apply.adapters import Claude
from apply.claude_fill import BLOCKED, MODEL, REPORTED, RULES
from apply.model import Handoff, one_line
from apply.submit_guard import CAPTCHA_TRY, DriveGuard

# The cap on one field, and how many fields one Application may hand over.
MAX_TURNS = 15
MAX_TOKENS = 150_000
MAX_FIELDS = 6

SYSTEM = f"""You fill one field of the internship application form open in the browser's current tab: the field in <field>, with the answer in <answer>, exactly as given. Apply's own script tried it and failed with the error in <error>.
Work only on that field: leave every other field as it is, and never click a button that goes to another step or sends the application.
A select answer is the option to pick; a list answer, the options to tick; a file answer names a file in your working folder: attach that file.
Close any list or pop-up you opened once the answer is in. Then read the field back: `shown` is exactly the text, option or file name it shows now, with nothing added.
If the field isn't on the page, or won't take the answer after a few tries, stop: set `blocked` and say why in `why`.
{RULES}"""
# The field is on an earlier step of a form held on its last (KAN-686): Lisul answered it in the window after
# the fill went on. Claude goes back with the form's own controls, fills it, saves that step and comes back.
MAX_TURNS_ELSEWHERE = 30
SYSTEM_ELSEWHERE = f"""You fill one field of the internship application form open in the browser's current tab: the field in <field>, with the answer in <answer>, exactly as given. Apply's own script tried it and failed with the error in <error>.
The field is not on the step the form shows now, the one in <held>: it is on an earlier step of the same form.
Go back to it with the form's own controls: its Back button, or its list of steps (a progress tracker, a step's link). Never use the browser's back, never reload, never open another page or tab.
On that step, fill only that field: leave every other field as it is. Then save that step with the form's own button that saves it or goes on (Save and Continue, Save, Next). Never click a button that sends the application (Submit, Apply, Send, Finish).
Then go back the same way to the step in <held>, and stop there.
A select answer is the option to pick; a list answer, the options to tick; a file answer names a file in your working folder: attach that file.
Close any list or pop-up you opened once the answer is in. Before you save, read the field back: `shown` is exactly the text, option or file name it shows, with nothing added.
If the field is on no earlier step, or won't take the answer after a few tries, stop: set `blocked` and say why in `why`, and go back to the step in <held> if you can.
{RULES}"""
SCHEMA = {
    "type": "object",
    "properties": {**BLOCKED, "shown": {"type": "array", "items": {"type": "string"}}},
    "required": [*REPORTED, "shown"],
}


class Rescue:
    """Claude's fill of a field the Filler couldn't, for one Application."""

    def __init__(self, claude: Claude, sms_opt_in: bool = False, marketing_opt_in: bool = False,
                 max_turns: int = MAX_TURNS, max_tokens: int = MAX_TOKENS, max_fields: int = MAX_FIELDS):
        self._claude = claude
        self._opt_ins = {"sms_opt_in": sms_opt_in, "marketing_opt_in": marketing_opt_in}
        self._max_turns, self._max_tokens, self._max_fields = max_turns, max_tokens, max_fields
        self._guard: DriveGuard | None = None
        self._tried = 0
        self.notes: list[str] = []  # each field rescued, for its Repair request

    def field(self, page: Page, label: str, value, error: Exception, elsewhere: str = "") -> bool:
        """Whether Claude put `value` in the field labelled `label`, which the
        Filler failed on with `error`. `elsewhere` names the step a form is
        held on when the field is on an earlier one (KAN-686): Claude goes
        back to it with the form's own controls, saves it, and comes back."""
        if self._tried >= self._max_fields:
            return False
        self._tried += 1
        if self._guard is None:
            self._guard = DriveGuard(page, **self._opt_ins)
        was_blocked = len(self._guard.blocked())
        answer = value.name if isinstance(value, Path) else value
        prompt = (f"<field>{label}</field>\n<answer>{json.dumps(answer)}</answer>\n"
                  f"<error>{one_line(str(error))[:500]}</error>")
        if elsewhere:
            prompt += f"\n<held>{one_line(elsewhere)[:300]}</held>"
        self._guard.arm()
        try:
            drive = self._claude.drive(page=page, model=MODEL, system=SYSTEM_ELSEWHERE if elsewhere else SYSTEM,
                                       prompt=prompt, schema=SCHEMA, files=[value] if isinstance(value, Path) else [],
                                       max_turns=max(self._max_turns, MAX_TURNS_ELSEWHERE) if elsewhere else self._max_turns,
                                       max_tokens=self._max_tokens)
        finally:
            self._guard.lift()  # the Filler's own clicks go through again
        # A click or key Claude tried in a captcha was refused there, untouched: no Handoff of its own.
        if blocked := [b for b in self._guard.blocked()[was_blocked:] if b != CAPTCHA_TRY]:
            raise Handoff(f"Apply blocked {blocked[0]} while Claude filled {label!r}, so nothing it blocked was sent. "
                          "Check the form and finish it yourself.")
        if drive.capped or drive.output is None or drive.output.get("blocked") is True:
            return False
        self.notes.append(f"{label}: the Filler failed ({type(error).__name__}: {one_line(str(error))[:300]}), "
                          "and Claude filled it live")
        return True
