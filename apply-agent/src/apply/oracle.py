"""Signing in to Oracle Recruiting Cloud, which has no Filler: plain code, zero
tokens, before Claude fill reads the form.

Oracle has no passwords: the candidate gives an email address (ticking the
site's legal disclaimer, never its honeypot box), a returning candidate
confirms their last name, and Oracle may mail a one-time code, read here from
Gmail. A code sent by text message is a Handoff, and so is a code that
doesn't come after one "Send New Code" and about 2 minutes, a code Oracle
refuses (it allows 4 tries, then locks for 30 minutes), or an identity
question other than the last name.

Real up to the email step (saved 2026-10-15). The steps after it follow
Oracle's documentation and are unverified: the code page's wording,
its boxes, its buttons and the mail's sender and subject.
"""

import re
import time

from playwright.sync_api import Page
from playwright.sync_api import TimeoutError as PlaywrightTimeout

from apply.accounts import Accounts
from apply.model import Handoff

# Gmail search for Oracle's code mail. The sender is the employer's own
# address, so the subject is searched; only mail since the request counts.
MAIL_SEARCH = 'subject:(code OR verification OR verify OR "confirm your identity")'
TIMEOUT = 30.0
TERMS_WAIT = 3.0
SMS = re.compile(r"text message|\bsms\b|sent .{0,40}to your (mobile|phone)", re.IGNORECASE)
CODE_PAGE = re.compile(r"verification code|one-time code|enter the code", re.IGNORECASE)
WRONG_CODE = re.compile(r"(code|pin) (is )?(incorrect|invalid|expired|wrong)|incorrect code|invalid code", re.IGNORECASE)



def sign_in(page: Page, accounts: Accounts, last_name: str, agree_to_terms: bool) -> None:
    """From the open posting to its application form. `agree_to_terms` is
    Lisul's policy on privacy and terms boxes (tick_consent_when_true)."""
    email = page.locator("input[type=email]").first
    _until(page, lambda: email.is_visible() or _apply_button(page).is_visible())
    if not email.is_visible():
        _apply_button(page).click()
    email.wait_for(timeout=TIMEOUT * 1000)
    email.fill(accounts.login)
    disclaimer = page.locator("#legal-disclaimer-checkbox")
    if disclaimer.count() and not disclaimer.is_checked():
        if not agree_to_terms:
            raise Handoff("Oracle asks you to agree to the site's terms before applying, which your policies leave to you.")
        _agree(page, disclaimer)
    since = accounts.clock.now()
    page.get_by_role("button", name=re.compile(r"^\s*next\s*$", re.IGNORECASE)).click()
    _until(page, lambda: not email.is_visible() or _error(page))
    if email.is_visible():
        raise Handoff(f"Oracle didn't take the email address: {_error(page)}")
    asked_last_name = False
    while True:
        page.wait_for_load_state("networkidle")
        text = page.locator("body").inner_text()
        if SMS.search(text):
            raise Handoff("Oracle sent its code by text message to your phone: finish signing in yourself.")
        last = page.get_by_label(re.compile(r"last name", re.IGNORECASE))
        if re.search(r"confirm (your|it'?s you)", text, re.IGNORECASE) and last.count() and not asked_last_name:
            asked_last_name = True
            last.first.fill(last_name)
            page.get_by_role("button", name=re.compile(r"^\s*(next|continue)\s*$", re.IGNORECASE)).click()
            _until(page, lambda: not last.count() or _error(page))
            if _error(page):
                raise Handoff(f"Oracle didn't accept your last name to confirm it's you: {_error(page)}")
            continue
        if re.search(r"date of birth|birth ?date", text, re.IGNORECASE) and CODE_PAGE.search(text) is None:
            raise Handoff("Oracle asks your date of birth to confirm it's you, which Apply doesn't hold: apply yourself.")
        if CODE_PAGE.search(text):
            resend = page.get_by_role("button", name=re.compile(r"send new code|resend", re.IGNORECASE))
            code = accounts.code(MAIL_SEARCH, since, lambda: resend.first.click())
            _type_code(page, code)
            page.get_by_role("button", name=re.compile(r"^\s*(verify|submit|next|continue)\s*$", re.IGNORECASE)).click()
            _until(page, lambda: not CODE_PAGE.search(page.locator("body").inner_text()) or WRONG_CODE.search(_error(page)))
            if WRONG_CODE.search(_error(page)):
                raise Handoff(f"Oracle refused the code from Gmail ({_error(page)}): sign in yourself.")
            continue
        return


def _agree(page: Page, box) -> None:
    """Tick the legal disclaimer. The box sits at the start of its label, whose
    text links the terms (clicking those opens them in a dialog, as on Macy's
    site), so click the box's corner, and agree in any terms dialog that opens."""
    agree = page.get_by_role("button", name=re.compile(r"^\s*agree\s*$", re.IGNORECASE)).first
    label = page.locator("label[for=legal-disclaimer-checkbox]")
    for _ in range(3):
        if not box.is_checked():
            label.click(position={"x": 4, "y": 4})
        try:  # a dialog may open a moment later
            agree.wait_for(timeout=TERMS_WAIT * 1000)
            agree.click()
            agree.wait_for(state="hidden", timeout=TIMEOUT * 1000)
        except PlaywrightTimeout:
            pass
        if box.is_checked() and not agree.is_visible():
            return
    raise Handoff("Oracle's legal disclaimer wouldn't stay ticked: finish the application yourself.")


def _apply_button(page: Page):
    return page.get_by_role("button", name=re.compile(r"^\s*apply( now)?\s*$", re.IGNORECASE)).first


def _type_code(page: Page, code: str) -> None:
    """Into one code box, or one digit per box."""
    boxes = page.locator("input.pin-code-input, input[autocomplete=one-time-code], input[aria-label*=code i]")
    if boxes.count() >= len(code):
        for box, digit in zip(boxes.all(), code):
            box.fill(digit)
    else:
        boxes.first.fill(code)


def _error(page: Page) -> str:
    alerts = page.locator("[role=alert]:visible, .input-row__error:visible")
    return alerts.first.inner_text().strip() if alerts.count() else ""


def _until(page: Page, done, timeout: float = TIMEOUT):
    end = time.monotonic() + timeout
    while True:
        try:
            if result := done():
                return result
        except Exception:
            pass  # the page navigated mid-check
        if time.monotonic() > end:
            raise TimeoutError(f"Oracle page didn't get there in {timeout:.0f} s: {page.url}")
        page.wait_for_timeout(200)
