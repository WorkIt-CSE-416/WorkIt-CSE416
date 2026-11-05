"""S7's port features live (KAN-613): frame locators, locator handlers, request and response
events, and a window.open the pop-up blocker refused, on the run's one plain Worker
(tests/plain_fakes.py). Skips without Chrome for Testing (CI)."""

import time
from urllib.parse import urlsplit

import pytest
from plain_fakes import fake_page, have_chrome_for_testing

from apply.plain.page import PortError, PortPage

pytestmark = pytest.mark.skipif(not have_chrome_for_testing(), reason="needs Chrome for Testing (uv run playwright install chromium)")

PAGES = {
    "/frames": '<!doctype html><title>Frames</title><iframe id="f" src="https://other.example/inner"></iframe>',
    "/inner": '<!doctype html><label>Inner <input id="inner"></label>',
    "/banner": """<!doctype html><title>Banner</title>
<div id="cookie" style="position:fixed;inset:0;background:#fff">We use cookies
  <button id="accept" onclick="setTimeout(() => document.getElementById('cookie').remove(), 300)">Accept</button></div>
<button id="go" onclick="window.went = true">Go</button>""",
    "/popup": """<!doctype html><title>Opener</title>
<button id="open" onclick="window.open('/opened')">Open</button>""",
    "/opened": "<!doctype html><title>Opened</title>",
    "/plain": "<!doctype html><title>Plain</title>",
}


def answer(route):
    path = urlsplit(route.request.url).path
    if path == "/api":
        return route.fulfill(json={"method": route.request.method, "sent": route.request.post_data})
    route.fulfill(content_type="text/html", body=PAGES.get(path, "<title>none</title>"))


def until(check, seconds: float = 5):
    deadline = time.monotonic() + seconds
    while not (found := check()):
        if time.monotonic() > deadline:
            return found
        time.sleep(0.1)
    return found


def test_frame_locators_reach_a_frame_on_another_origin():
    with fake_page(answer, url="https://acme.example/frames") as page:
        page.frame_locator("#f").locator("#inner").fill("hello")
        assert page.locator("#f").content_frame.get_by_label("Inner").input_value() == "hello"


def test_a_locator_handler_clears_the_overlay_before_the_click():
    with fake_page(answer, url="https://acme.example/banner") as page:
        ran = []
        page.add_locator_handler(page.locator("#cookie"), lambda: (ran.append(1), page.locator("#accept").click()))
        page.locator("#go").click()
        assert ran == [1] and page.evaluate("() => window.went") is True
        assert page.locator("#cookie").count() == 0


def test_requests_and_responses_with_the_body_of_a_post():
    with fake_page(answer, url="https://acme.example/plain") as page:
        requests, responses = [], []
        page.on("request", requests.append)
        page.on("response", responses.append)
        page.evaluate("""async () => {
            await fetch('/api', {method: 'POST', body: '{"email":"a@b.c"}'});
            await fetch('/api');
        }""")
        posts = until(lambda: [r for r in responses if r.url.endswith("/api") and r.request.method == "POST"])
        assert posts and posts[0].status == 200
        assert posts[0].json() == {"method": "POST", "sent": '{"email":"a@b.c"}'}
        assert any(r.url.endswith("/api") and r.method == "POST" for r in requests)
        gets = until(lambda: [r for r in responses if r.url.endswith("/api") and r.request.method == "GET"])
        assert gets
        with pytest.raises(PortError):
            gets[0].text()


def test_a_blocked_window_open_still_gives_a_popup():
    with fake_page(answer, url="https://acme.example/popup") as page:
        popups = []
        page.on("popup", popups.append)
        page.locator("#open").click()  # synthetic: no user activation, so Chrome blocks window.open
        assert until(lambda: popups)
        popup = popups[0]
        assert isinstance(popup, PortPage)
        popup.wait_for_load_state()
        assert popup.url == "https://acme.example/opened" and popup.title() == "Opened"
