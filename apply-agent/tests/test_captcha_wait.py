"""Waiting for Lisul to do a captcha (KAN-527): the Worker's page stays open,
his phone gets one push, the Apply window shows the captcha with Resume, and
the wait ends by itself once the challenge is gone, or on his Resume. Opens
Chromium: run it on your Mac."""

import threading

import pytest
from playwright.sync_api import sync_playwright
from test_dashboard import NoFrames
from test_resume import post_resume

from apply.captcha import Waiter
from apply.dashboard import Dashboard, verdict
from apply.notify import RecordingNotifier

CAPTION = {"company": "LinkedIn", "role": "Software Engineer Intern",
           "posting_url": "https://jobs.smartrecruiters.com/LinkedIn3/744000158394370",
           "application_id": "request-1", "job_system": "other"}
WHY = "Claude fill can't finish this form: a \"Verification Required\" slider challenge in an iframe"
# DataDome's slider frame, gone `solved` ms after it shows (as when Lisul slides it), or never (None).
SLIDER = """(solved) => {
  const frame = document.createElement('iframe');
  frame.src = 'https://geo.captcha-delivery.com/captcha/?initialCid=fake';
  frame.style.cssText = 'width:400px;height:400px';
  document.body.appendChild(frame);
  if (solved !== null) setTimeout(() => frame.remove(), solved);
}"""


class Profile:
    def __init__(self, **policies):
        self._policies = {"phone_push": True, "captcha_wait_minutes": 1} | policies

    def policy(self, key):
        return self._policies.get(key)


@pytest.fixture
def page():
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch()
        try:
            page = browser.new_page()
            page.route("**/*captcha-delivery.com/**", lambda route: route.fulfill(body="<p>Slide right</p>"))
            yield page
        finally:
            browser.close()


def test_the_window_shows_a_captcha_as_lisuls_to_do_with_resume():
    shown = verdict(CAPTION | {"status": "handoff", "why": WHY, "captcha": True, "resume": {"ok": True}})

    assert (shown["tone"], shown["kind"], shown["do"]) == ("needs", "captcha", "Do the captcha")
    assert "goes on by itself" in shown["then"] and "Resume" in shown["then"]
    assert shown["resume"] == {"ok": True, "why": ""}


def test_the_wait_ends_by_itself_once_lisul_did_the_captcha(page):
    phone = RecordingNotifier()
    page.evaluate(SLIDER, 1500)
    with Dashboard(1, NoFrames()) as board:
        board.update(0, **CAPTION, status="filling")
        waits = Waiter(board, 0, phone, Profile(), lambda: CAPTION)

        assert waits(WHY, page, "LinkedIn")

        [tile] = board.state()["tiles"]
    assert phone.sent == [("Apply: do the captcha", "Do the captcha on LinkedIn. Apply goes on by itself once it's done.")]
    assert tile["tone"] == "filling" and "resume" not in tile


def test_resume_in_the_window_ends_the_wait(page):
    page.evaluate(SLIDER, None)  # a challenge Apply can't see go, say
    with Dashboard(1, NoFrames()) as board:
        board.update(0, **CAPTION, status="filling")
        waits = Waiter(board, 0, None, Profile(), lambda: CAPTION)
        pressed = threading.Timer(1.0, lambda: post_resume(board, "tile-0"))
        pressed.start()

        assert waits(WHY, page, "LinkedIn")
        pressed.join()


def test_a_captcha_not_done_in_time_ends_the_wait_and_pushes_once(page):
    phone = RecordingNotifier()
    page.evaluate(SLIDER, None)
    with Dashboard(1, NoFrames()) as board:
        board.update(0, **CAPTION, status="filling")
        waits = Waiter(board, 0, phone, Profile(captcha_wait_minutes=0.02), lambda: CAPTION)

        assert not waits(WHY, page, "LinkedIn")
        assert not waits(WHY, page, "LinkedIn")  # the same form's captcha again: no second push

    assert len(phone.sent) == 1


# DataDome's frame, as SmartRecruiters showed it: its own POST form, which Lisul sends when he does the captcha.
DATADOME_FRAME = """<form id="human-contact-form" method="post" action="/contact-human"><button>Send</button></form>
<script>document.forms[0].submit()</script>"""


@pytest.mark.parametrize("guarded", ["drive", "rehearsal"])
def test_neither_guard_stops_lisul_doing_the_captcha_in_its_frame(guarded):
    from apply.submit_guard import DriveGuard, guard

    posted = []
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch()
        try:
            page = browser.new_page()

            def captcha_site(route):
                if route.request.method == "POST":
                    posted.append(route.request.url)
                    return route.fulfill(body="<p>Thanks</p>")
                return route.fulfill(content_type="text/html", body=DATADOME_FRAME)
            page.route("**/*captcha-delivery.com/**", captcha_site)
            page.route("https://jobs.example.com/**", lambda route: route.fulfill(content_type="text/html", body="<p>Form</p>"))
            page.goto("https://jobs.example.com/apply")
            drive = DriveGuard(page) if guarded == "drive" else guard(page)
            page.evaluate("""() => { const f = document.createElement('iframe');
                f.src = 'https://geo.captcha-delivery.com/captcha/?initialCid=fake'; document.body.appendChild(f); }""")
            page.wait_for_timeout(1500)
            blocked = drive.blocked() if guarded == "drive" else []
        finally:
            browser.close()

    assert posted == ["https://geo.captcha-delivery.com/contact-human"]
    assert blocked == []
