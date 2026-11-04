"""Captchas and bot blocks: how Apply tells them, in one place.

A captcha is a challenge a person solves: a picture puzzle, a slider. Apply
never solves one. A bot block is a page that refuses the browser outright
(Tesla's "Access Denied"): there is nothing to solve, so it is a Handoff."""

import re
import subprocess
import sys
import time
from collections.abc import Callable
from contextlib import contextmanager
from contextvars import ContextVar
from urllib.parse import urlsplit

from playwright.sync_api import Page

from apply.model import Blocked, Handoff

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
# The hosts that serve those challenges' frames. Apply's guards leave a page of these alone, so Lisul can do
# the captcha there: DataDome's frame posts its own form.
HOSTS = ("captcha-delivery.com", "hcaptcha.com", "arkoselabs.com", "funcaptcha.com", "challenges.cloudflare.com",
         "recaptcha.net")
# reCAPTCHA's frames are on www.google.com, by path.
PATHS = ("/recaptcha/",)

# How Claude fill's Claude says it stopped at one (claude_fill.py's prompt tells it to).
SAYS_CAPTCHA = re.compile(r"captcha|not a robot|turnstile|cloudflare|verify (that )?you are (a )?human"
                          r"|verification required|slide (right|to)", re.IGNORECASE)

# Bot blocks: how each page that refuses Apply's Chrome words it. Nothing on it is Lisul's to solve, so it is
# a Handoff at once, to his own Chrome, and never a wait or a retry (KAN-590).
BLOCKS = (
    # DataDome's block, in its captcha-delivery frame (LinkedIn's SmartRecruiters form, 2026-11-03).
    r"we detected unusual activity from your device or network",
    # Lever, when its invisible hCaptcha turns the sent form down (Simbe Robotics, 2026-11-03).
    r"there was an error verifying your application",
    # Akamai's "Access Denied" (Tesla, 2026-11-03).
    r"you don'?t have permission to access",
)
BLOCK = re.compile("|".join(BLOCKS), re.IGNORECASE)
# How Claude fill's Claude words a bot block: the pages' own words, or Tesla's title.
SAYS_BLOCKED = re.compile("|".join((*BLOCKS, r"access denied", r"unusual activity")), re.IGNORECASE)


def shows(page: Page) -> bool:
    """Whether the page shows a captcha's challenge now. A page that is gone
    shows none, and a bot block (DataDome's, in the same frame) is none."""
    try:
        challenge = page.locator(CHALLENGE)
        return any(challenge.nth(i).is_visible() for i in range(challenge.count())) and not blocks(page)
    except Exception:
        return False


def blocks(page: Page) -> str:
    """The words of a bot block that the page or one of its frames shows, else ""."""
    for frame in page.frames:
        try:
            if found := BLOCK.search(frame.locator("body").inner_text(timeout=1000)):
                return found[0]
        except Exception:
            continue  # a frame loading, or gone
    return ""


# A bot block's Handoff: plain words, as Lisul asked for Tesla's. The page's own words go in the brackets.
BLOCKED = "{} blocked Apply's Chrome as a bot{}. "
# What the Apply window and the push tell him to do: the extension fills the form in his own Chrome.
FINISH = "Finish {} in your Chrome: the extension fills it"
FINISH_TITLE = "Apply: finish it in your Chrome"
# Parts of a host that name no company.
_NO_NAME = {"www", "careers", "jobs", "apply", "boards", "job-boards"}


def company_of(company: str, url: str) -> str:
    """The company, else the name in the link's host (www.tesla.com: Tesla)."""
    labels = [part for part in (urlsplit(url).hostname or "").split(".") if part not in _NO_NAME] if url else []
    return company or (labels[0].capitalize() if labels else "the job site")


def blocked(company: str, url: str, said: str = "") -> Blocked:
    """The Handoff of a page that blocks the browser, for `company`'s posting at `url`."""
    who = company_of(company, url)
    return Blocked(BLOCKED.format(who[:1].upper() + who[1:], f' ("{said}")' if said else "") + FINISH.format(who),
                   who, url, said)


def as_block(handoff: Handoff, page: Page | None, company: str, url: str) -> Handoff:
    """`handoff` as a Blocked, named for `company`'s posting, when it is one or its page shows a bot block."""
    if isinstance(handoff, Blocked):
        return handoff if handoff.company else blocked(company, url, handoff.said)
    said = blocks(page) if page is not None else ""
    return blocked(company, url, said) if said else handoff


def to_everyday_chrome(url: str) -> None:
    """Open `url` in the student's everyday Chrome, as a click in the Dock would: never over DevTools, and never
    in a Worker profile, so the job system sees their own browser. The extension fills the form there."""
    subprocess.run(["open", "-a", "Google Chrome", url], check=False)


# The submit's wait for a captcha that shows once the form is sent (at_submit); none outside it.
_AT_SUBMIT: ContextVar[Callable[[Page], bool]] = ContextVar("at_submit", default=lambda page: False)
# The reason the window shows for one.
AT_SUBMIT = "A captcha came up after the submit click, so the form waits to be sent"
# A rehearsal's, after Lisul's own Submit: his to do, as the Submit was.
AFTER_HIS_SUBMIT = "A captcha came up after your Submit: do the captcha, and the form goes in"


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
        self.tell(company or self._caption().get("company") or "")
        done = wait(page, lambda: board.resumed(n), self.minutes)
        if done:  # filling again, which clears the tile: its caption anew, as a fill's start gives it
            board.update(n, **self._caption(), status="filling")
        else:
            board.update(n, captcha=False)
        return done

    def tell(self, company: str) -> None:
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
