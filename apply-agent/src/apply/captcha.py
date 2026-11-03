"""Captchas and bot blocks: how Apply tells them, in one place.

A captcha is a challenge a person solves: a picture puzzle, a slider. Apply
never solves one. A bot block is a page that refuses the browser outright
(Tesla's "Access Denied"): there is nothing to solve, so it is a Handoff."""

import re
import sys
import time
from collections.abc import Callable
from contextlib import contextmanager
from contextvars import ContextVar
from urllib.parse import urlsplit

from playwright.sync_api import Page

# A captcha's challenge, once shown on the page. Each one goes away when it is solved.
CHALLENGES = (
    "iframe[src*='recaptcha/api2/bframe']",  # reCAPTCHA's picture challenge
    "iframe[src*='recaptcha/enterprise/bframe']",
    "iframe[src*='hcaptcha.com'][src*='frame=challenge']",  # hCaptcha's picture challenge
    "iframe[src*='captcha-delivery.com']",  # DataDome's slider (SmartRecruiters: "Verification Required")
    "iframe[src*='arkoselabs.com']",  # Arkose Labs' puzzle
    '[data-testid="TurnstileContainer"]',  # Rippling's Cloudflare Turnstile, shown only when it wants a challenge solved
)
CHALLENGE = ", ".join(CHALLENGES)

# How Claude fill's Claude says it stopped at one (claude_fill.py's prompt tells it to).
SAYS_CAPTCHA = re.compile(r"captcha|not a robot|turnstile|cloudflare|verify (that )?you are (a )?human"
                          r"|verification required|slide (right|to)", re.IGNORECASE)

# How a page that blocks the browser words it, as Claude fill's Claude reads it: no challenge to solve.
SAYS_BLOCKED = re.compile(r"access denied|you don'?t have permission to access", re.IGNORECASE)


def shows(page: Page) -> bool:
    """Whether the page shows a captcha's challenge now. A page that is gone shows none."""
    try:
        challenge = page.locator(CHALLENGE)
        return any(challenge.nth(i).is_visible() for i in range(challenge.count()))
    except Exception:
        return False


# A bot block's Handoff: plain words, as Lisul asked for Tesla's.
BLOCKED = "{} blocked the browser; apply in your own Chrome"
# Parts of a host that name no company.
_NO_NAME = {"www", "careers", "jobs", "apply", "boards", "job-boards"}


def blocked(company: str, url: str) -> str:
    """The Handoff's reason for a page that blocks the browser: the company,
    else the name in the link's host (www.tesla.com: Tesla)."""
    labels = [part for part in urlsplit(url).hostname.split(".") if part not in _NO_NAME] if url else []
    return BLOCKED.format(company or (labels[0].capitalize() if labels else "The job site"))


# The submit's wait for a captcha that shows once the form is sent (at_submit); none outside it.
_AT_SUBMIT: ContextVar[Callable[[Page], bool]] = ContextVar("at_submit", default=lambda page: False)
# The reason the window shows for one.
AT_SUBMIT = "A captcha came up after the submit click, so the form waits to be sent"


@contextmanager
def at_submit(wait: Callable[[Page], bool]):
    """While a Filler's submit runs in this block, a captcha after its click
    goes to `wait(page)` (apply.confirmation): True, Lisul did it, and the
    submit waits for the job system's confirmation again."""
    token = _AT_SUBMIT.set(wait)
    try:
        yield
    finally:
        _AT_SUBMIT.reset(token)


def done_at_submit(page: Page) -> bool:
    """Whether Lisul did the captcha that came up after the submit click."""
    return _AT_SUBMIT.get()(page)


# How long Apply waits for Lisul to do a captcha before the Application is the
# usual Handoff (policies.yaml: captcha_wait_minutes).
WAIT_MINUTES = 15
# How often the waiting page is read for the challenge, in milliseconds.
POLL_MS = 1000
# The push to his phone: the same ntfy path as `apply push-test`.
PUSH_TITLE = "Apply: do the captcha"
PUSH = "Do the captcha on {}. Apply goes on by itself once it's done."


def wait(page: Page, pressed: Callable[[], bool], minutes: float, poll_ms: int = POLL_MS) -> bool:
    """Wait on `page` for Lisul to do its captcha. True once the challenge
    that showed is gone, or he pressed Resume (`pressed()`); False after
    `minutes`, or once the page is closed. It never touches the page."""
    seen = shows(page)  # a challenge only Claude saw, perhaps in a frame no selector names: Resume alone ends it
    deadline = time.monotonic() + minutes * 60
    while time.monotonic() < deadline:
        try:
            if page.is_closed():
                return False
            if pressed() or (seen and not shows(page)):
                try:
                    page.wait_for_load_state(timeout=15_000)  # a solved DataDome slider loads the page again
                except Exception:
                    pass
                return True
            page.wait_for_timeout(poll_ms)
        except Exception:
            return False  # its browser was quit
    return False


class Waiter:
    """Waits on one Worker's page while Lisul does a captcha. Its tile shows it
    as a Handoff with the captcha reason and Resume; his phone gets one push.
    `caption()` gives the tile's company, role and posting again for the fill
    that goes on. `phone` is None while no ntfy topic is set up."""

    def __init__(self, board, worker: int, phone, profile, caption: Callable[[], dict]):
        self._board, self._worker, self._phone, self._caption = board, worker, phone, caption
        self._push = profile.policy("phone_push") is True
        minutes = profile.policy("captcha_wait_minutes")
        self.minutes = WAIT_MINUTES if minutes is None else float(minutes)
        self._pushed = False

    def __call__(self, why: str, page: Page, company: str = "") -> bool:
        """True once Lisul did the captcha on `page` of `company`'s form: the fill goes on there."""
        if self.minutes <= 0:
            return False
        board, n = self._board, self._worker
        board.update(n, status="handoff", why=why, captcha=True, resume={"ok": True})
        self._tell(company or self._caption().get("company") or "")
        done = wait(page, lambda: board.resumed(n), self.minutes)
        if done:  # filling again, which clears the tile: its caption anew, as a fill's start gives it
            board.update(n, **self._caption(), status="filling")
        else:
            board.update(n, captcha=False)
        return done

    def _tell(self, company: str) -> None:
        """One push per Application: a second challenge on the same form pushes nothing more."""
        if self._pushed or not self._push or self._phone is None:
            return
        self._pushed = True
        company = company or "a form"
        try:
            self._phone.notify(PUSH_TITLE, PUSH.format(company))
        except Exception as failed:
            print(f"Couldn't push the captcha on {company} to your phone ({failed}); "
                  "the Apply window shows it.", file=sys.stderr)
