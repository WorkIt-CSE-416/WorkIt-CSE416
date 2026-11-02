"""Waiting, after a Filler's submit click, for the job system to confirm.

A captcha that only shows its picture challenge once the form is sent (an
invisible reCAPTCHA or hCaptcha deciding the browser looks like a bot) holds
the form back until someone solves it, which a Worker never does: that is a
Handoff, not a wait that ends in a timeout. So is a job system's own refusal
of the form (Ashby's, when it takes the browser for a bot), named as it
words it."""

import time
from collections.abc import Callable

from playwright.sync_api import Page

from apply import bot_signals
from apply.model import Handoff

# A captcha's picture challenge, once shown.
CHALLENGE = (
    "iframe[src*='recaptcha/api2/bframe'], iframe[src*='recaptcha/enterprise/bframe'],"
    " iframe[src*='hcaptcha.com'][src*='frame=challenge']"
)
CAPTCHA = (
    "A captcha challenge came up at the submit click, so the form was not sent. "
    "Apply yourself from the posting link; the Record has every answer"
)
REFUSED = "{}. Apply yourself from the posting link; the Record has every answer"


def wait_for_confirmation(page: Page, confirmed: Callable[[], bool], timeout: float = 30,
                          refused: Callable[[], str] = lambda: "") -> None:
    """Return once `confirmed()` is true. Raises Handoff if a captcha
    challenge shows first, or `refused()` says why the job system refused the
    form, and TimeoutError after `timeout` seconds."""
    challenge = page.locator(CHALLENGE)
    deadline = time.monotonic() + timeout
    while not confirmed():
        if any(challenge.nth(i).is_visible() for i in range(challenge.count())):
            raise Handoff(CAPTCHA, bot_signal=bot_signals.CAPTCHA)
        if why := refused():
            raise Handoff(REFUSED.format(why.rstrip(".")))
        if time.monotonic() > deadline:
            raise TimeoutError(f"no confirmation within {timeout:.0f} s of the submit click")
        page.wait_for_timeout(250)
