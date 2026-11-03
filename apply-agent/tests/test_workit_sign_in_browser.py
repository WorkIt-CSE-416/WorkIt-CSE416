"""`apply login`'s browser: a Chrome started as a plain process, read through its DevTools port.

Needs Playwright's Chromium (not in CI's list). The fake WorkIt's sign-in page
sets the session cookie at once, as the web app does after a sign-in."""

from fake_workit import FakeWorkIt
from playwright.sync_api import sync_playwright

from apply import workit
from apply.workit import WorkIt


def chromium() -> str:
    with sync_playwright() as playwright:
        return playwright.chromium.executable_path


def test_login_reads_the_session_from_the_sign_in_browser(tmp_path):
    with FakeWorkIt() as fake:
        client = WorkIt(fake.site, tmp_path / "workit-login.json")

        def browser(url, accept):
            return workit.chrome_sign_in(url, accept, chrome=chromium(), args=("--headless=new",), timeout=30)

        assert workit.login(client, browser).email == "test.person@example.com"
        assert WorkIt(fake.site, tmp_path / "workit-login.json").me().email == "test.person@example.com"
