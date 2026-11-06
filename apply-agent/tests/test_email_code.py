"""The emailed code after Lisul's own Submit on a held rehearsal page: Apply
reads it from Gmail and types it in, and presses nothing after it. A fake
Greenhouse page shows the code step when Submit is pressed; FakeMailbox
holds the mail."""

import re
import threading
from datetime import datetime, timedelta
from pathlib import Path

import pytest
from fake_greenhouse import BOXES, CODE, ONE_BOX
from fakes import FakeClock, FakeMailbox
from test_rehearse import OnePage

from apply import email_code, rehearsal
from apply.dashboard import verdict
from apply.email_code import EmailCode, search_for
from apply.greenhouse import SECURITY_CODE_SEARCH

NOW = datetime(2026, 11, 2, 10, 0)


@pytest.fixture(autouse=True)
def no_lookups_or_codes_left_over():
    """Every test starts with no lookup going and no code typed: they share CODE."""
    email_code._GOING.clear()
    email_code._TYPED.clear()
    yield
    email_code._GOING.clear()
    email_code._TYPED.clear()
URL = "https://job-boards.greenhouse.io/acme/jobs/4012345"
SENDER = "us.greenhouse-mail.io"

# The form's last part, its own postal code box filled, and the code step that
# Submit shows. Every button click is counted in the page; with `sends_itself`
# the page clicks its own Submit once the last box is full, as some do.
PAGE = """<!doctype html><title>Acme</title>
<form onsubmit="return false">
  <label for="zip">Postal code</label><input id="zip" name="postal_code" value="12345">
  <label for="promo">Referral code</label><input id="promo" name="referral_code">
  <button type="button" id="submit">Submit application</button>
  <div id="security" hidden>
    <p>A verification code was sent to your email. Copy and paste it below to confirm your application.</p>
    {boxes}
    <button type="button" id="resend">Resend code</button>
  </div>
</form>
<script>
  window.clicks = []; window.sent = false;
  document.addEventListener('click', e => {{ const b = e.target.closest('button'); if (b) window.clicks.push(b.textContent); }}, true);
  let asked = false;
  const code = () => [...document.querySelectorAll('#security input')].map(i => i.value).join('');
  const send = () => {{
    if (!asked) {{ asked = true; document.getElementById('security').hidden = false; return; }}
    if (code() === '{code}') {{ window.sent = true; document.body.insertAdjacentHTML('beforeend', '<p>Sent</p>'); }}
  }};
  document.getElementById('submit').onclick = send;
  if ({sends_itself}) document.getElementById('security').addEventListener('input', () => {{
    if (code().length === {length}) document.getElementById('submit').click();
  }});
</script>"""


def page(boxes=BOXES, sends_itself=False) -> str:
    return PAGE.format(boxes=boxes, code=CODE, sends_itself="true" if sends_itself else "false", length=len(CODE))


def lisul_presses(monkeypatch, *buttons):
    """Once Apply hands the page to Lisul, he presses `buttons`."""
    real = rehearsal.lift

    def lift(page, **heard):
        real(page, **heard)
        for name in buttons:
            page.get_by_role("button", name=name).click()
    monkeypatch.setattr(rehearsal, "lift", lift)


def hold(html: str, mailbox: FakeMailbox, clock: FakeClock | None = None, quiet_for: float = 0):
    """Hold the page as a rehearsal does, until Apply tells Lisul something
    (or, with `quiet_for`, that many seconds of nothing). Returns what it
    told, the page's clicks, whether it sent, and its code boxes' values."""
    told, release = [], threading.Event()

    def tell(status, why):
        told.append((status, why))
        release.set()
    watchdog = threading.Timer(quiet_for or 30, release.set)
    watchdog.start()
    site = rehearsal._Kept(OnePage(html), 0)
    try:
        with site.open(URL) as opened:
            site.hold(release, "greenhouse", code=EmailCode(mailbox, clock or FakeClock(NOW), "greenhouse", tell))
            seen = opened.evaluate("[window.clicks, window.sent, [...document.querySelectorAll('#security input')].map(i => i.value)]")
    finally:
        watchdog.cancel()
    return told, *seen


@pytest.mark.parametrize("boxes, typed", [(BOXES, list(CODE)), (ONE_BOX, [CODE])])
def test_the_code_greenhouse_emails_after_lisuls_submit_is_typed_in_and_nothing_is_pressed(monkeypatch, boxes, typed):
    lisul_presses(monkeypatch, "Submit application")
    mailbox = FakeMailbox()
    mailbox.deliver(SECURITY_CODE_SEARCH, code=CODE, sender=SENDER)

    told, clicks, sent, values = hold(page(boxes), mailbox)

    assert values == typed
    assert clicks == ["Submit application"]  # his press only: no Submit, Verify or Resend after it
    assert not sent
    assert told == [("code filled", f"Code filled from an email from {SENDER}. Check it and press Submit yourself")]
    assert CODE not in told[0][1]  # what Apply says never names the code


def test_a_page_that_sends_itself_once_the_code_is_in_sends_nothing(monkeypatch):
    lisul_presses(monkeypatch, "Submit application")
    mailbox = FakeMailbox()
    mailbox.deliver(SECURITY_CODE_SEARCH, code=CODE, sender=SENDER)

    told, clicks, sent, values = hold(page(sends_itself=True), mailbox)

    assert values == list(CODE) and told[0][0] == "code filled"
    assert not sent  # the submit guard was on while Apply typed
    assert clicks == ["Submit application"]


def test_a_held_page_looks_for_its_code_for_at_least_10_minutes():
    assert email_code.WAIT >= timedelta(minutes=10)


def test_a_code_mailed_before_lisuls_press_is_not_used_and_he_is_told(monkeypatch):
    lisul_presses(monkeypatch, "Submit application")
    mailbox = FakeMailbox(clock=FakeClock(NOW - timedelta(minutes=10)))
    mailbox.deliver(SECURITY_CODE_SEARCH, code=CODE, sender=SENDER)  # an older application's code
    clock = FakeClock(NOW)

    told, clicks, sent, values = hold(page(), mailbox, clock)

    assert values == [""] * len(CODE)
    [(status, why)] = told
    assert status == "needs code" and "greenhouse-mail.io" in why and "yourself" in why
    assert clock.now() >= NOW + email_code.WAIT  # it looked for the whole wait
    assert clicks == ["Submit application"] and not sent  # it never asks for another code: that is a button


def test_a_code_that_does_not_fit_the_boxes_is_not_typed(monkeypatch):
    lisul_presses(monkeypatch, "Submit application")
    mailbox = FakeMailbox()
    mailbox.deliver(SECURITY_CODE_SEARCH, code="482913", sender=SENDER)  # six characters, eight boxes

    told, clicks, sent, values = hold(page(), mailbox)

    assert values == [""] * len(CODE)
    assert told[0][0] == "needs code" and SENDER in told[0][1] and "482913" not in told[0][1]
    assert clicks == ["Submit application"] and not sent


def test_without_gmail_lisul_is_told_to_type_the_code(monkeypatch):
    lisul_presses(monkeypatch, "Submit application")

    told, clicks, sent, values = hold(page(), FakeMailbox(set_up=False))

    assert told[0][0] == "needs code" and "Gmail isn't set up" in told[0][1]
    assert values == [""] * len(CODE)
    assert clicks == ["Submit application"] and not sent


def test_with_no_code_step_after_his_press_no_mail_is_looked_for(monkeypatch):
    lisul_presses(monkeypatch)  # he presses nothing; the form's own postal and referral boxes are no code step
    mailbox = FakeMailbox()

    told, clicks, sent, values = hold(page(), mailbox, quiet_for=3)

    assert told == [] and mailbox.looks == 0
    assert clicks == [] and not sent and values == [""] * len(CODE)


def test_two_pages_looking_on_the_same_senders_at_once_type_neither_code():
    # Greenhouse mails every company's code from one sender: neither page can tell whose mail is whose.
    def watcher():
        return EmailCode(FakeMailbox(), FakeClock(NOW), "greenhouse", lambda status, why: None)
    first, second = watcher(), watcher()
    first._join(SECURITY_CODE_SEARCH)
    second._join(SECURITY_CODE_SEARCH)
    assert first._crossed and second._crossed

    first._leave()
    second._leave()
    later = watcher()
    later._join(SECURITY_CODE_SEARCH)  # once both are done, a new lookup is on its own
    assert not later._crossed
    other = watcher()
    other._join("from:(icims.com)")  # another job system's senders never cross it
    assert not other._crossed


def test_a_code_typed_into_one_page_is_never_found_for_another():
    clock = FakeClock(NOW)
    mailbox = FakeMailbox(clock=clock)
    mailbox.deliver(SECURITY_CODE_SEARCH, code=CODE, sender=SENDER)
    email_code._TYPED.add(CODE)  # typed into another held page
    watcher = EmailCode(mailbox, clock, "greenhouse", lambda status, why: None)
    watcher._search = SECURITY_CODE_SEARCH

    watcher._look(NOW - email_code.SLACK)

    assert watcher._found == []
    assert clock.now() >= NOW + email_code.WAIT  # it kept looking for its own code


def test_apply_presses_nothing_on_the_code_step():
    # The hard rule in the code itself: the module that types the code never clicks, presses a key or submits.
    source = Path(email_code.__file__).read_text()
    assert not re.search(r"\.(click|dblclick|tap|press|press_sequentially|check|dispatch_event|select_option|submit)\(|"
                         r"requestSubmit|keyboard|\.type\(", source)


def test_the_code_is_looked_for_from_the_job_systems_own_senders():
    assert search_for("greenhouse", URL) == SECURITY_CODE_SEARCH
    assert search_for("other", "https://job-boards.greenhouse.io/embed/job_app?for=acme") == SECURITY_CODE_SEARCH
    assert "myworkday.com" in search_for("workday", "https://acme.wd5.myworkdayjobs.com/x")
    assert search_for("other", "https://careers-acme.icims.com/jobs/1/apply") == "from:(icims.com)"


def test_the_apply_window_shows_a_code_to_type_under_needs_you_and_a_filled_one_as_not_sent():
    needs = verdict({"status": "needs code", "why": "No code email came"})
    assert (needs["tone"], needs["kind"]) == ("needs", "needs code") and "press Submit yourself" in needs["then"]
    filled = verdict({"status": "code filled", "why": f"Code filled from an email from {SENDER}"})
    assert filled["tone"] == "ready" and filled["label"] == "Code filled, not sent"
