"""Waiting, after a Filler's submit click, for the job system to confirm.

A captcha that only shows its picture challenge once the form is sent (an
invisible reCAPTCHA or hCaptcha deciding the browser looks like a bot) holds
the form back until someone solves it, which a Worker never does. In a live
run Lisul does it (captcha.at_submit): the wait for the confirmation then goes
on. When he does not, it is a Handoff, not a wait that ends in a timeout. So is a job system's own refusal
of the form (Ashby's, when it takes the browser for a bot), named as it
words it."""

import time
from collections.abc import Callable

from playwright.sync_api import Page

from apply import bot_signals, captcha
from apply.model import Blocked, Handoff

CAPTCHA = (
    "A captcha challenge came up at the submit click, so the form was not sent. "
    "Apply yourself from the posting link; the Record has every answer"
)
REFUSED = "{}. Apply yourself from the posting link; the Record has every answer"


def wait_for_confirmation(page: Page, confirmed: Callable[[], bool], timeout: float = 30,
                          refused: Callable[[], str] = lambda: "") -> None:
    """Return once `confirmed()` is true. Raises Handoff if a captcha
    challenge shows first, or `refused()` says why the job system refused the
    form; Blocked if the page shows a bot block (Lever's "error verifying");
    and TimeoutError after `timeout` seconds."""
    deadline = time.monotonic() + timeout
    while not confirmed():
        if captcha.shows(page):
            if not captcha.done_at_submit(page):  # Lisul did not do it in time, or no one waits for him
                raise Handoff(CAPTCHA, bot_signal=bot_signals.CAPTCHA)
            deadline = time.monotonic() + timeout  # he did it: the job system confirms from now
        if said := captcha.blocks(page):  # sending it again from this Chrome gets the same answer
            raise Blocked(said, said=said)
        if why := refused():
            raise Handoff(REFUSED.format(why.rstrip(".")))
        if time.monotonic() > deadline:
            raise TimeoutError(f"no confirmation within {timeout:.0f} s of the submit click")
        page.wait_for_timeout(250)
