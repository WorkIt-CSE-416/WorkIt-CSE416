"""Captchas and bot blocks: how Apply tells them, in one place.

A captcha is a challenge a person solves: a picture puzzle, a slider. Apply
never solves one. A bot block is a page that refuses the browser outright
(Tesla's "Access Denied"): there is nothing to solve, so it is a Handoff."""

import re

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
