"""A plain Worker's extension reloaded in place (KAN-643): newer code on disk loads without
restarting its Chrome, and its tabs, sign-in, tile and filling carry on. Fake pages only.
Skips without Chrome for Testing (CI)."""

import http.server
import shutil
import tempfile
import threading
import time
from pathlib import Path

import pytest
from playwright.sync_api import sync_playwright

from apply.plain.bridge import FEATURES, Bridge
from apply.plain.extension import EXTENSION_DIR
from apply.plain.launcher import PlainWorkers, chrome_for_testing, developer_mode
from apply.plain.page import PortPage
from apply.plain.tile import PortFrames

try:
    chrome_for_testing()
    HAVE_CHROME = True
except FileNotFoundError:
    HAVE_CHROME = False

pytestmark = pytest.mark.skipif(not HAVE_CHROME, reason="needs Chrome for Testing (uv run playwright install chromium)")


class Site(http.server.BaseHTTPRequestHandler):
    """/sign-in sets a session cookie; /account says whether the request carried it."""

    def do_GET(self):
        signed_in = "session=lisul" in (self.headers.get("Cookie") or "")
        self.send_response(200)
        if self.path == "/sign-in":
            self.send_header("Set-Cookie", "session=lisul; Path=/; HttpOnly")
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.end_headers()
        body = ("<!doctype html><title>Account</title><h1 id=who>" + ("Signed in" if signed_in else "Signed out")
                + "</h1><input id=name style='font-size: 30px'>")
        self.wfile.write(body.encode())

    def log_message(self, *args):
        pass


def level(extension: Path, features: int) -> None:
    """Write the extension copy's feature level on disk, as a newer checkout would."""
    background = extension / "background.js"
    text = background.read_text()
    old = next(line for line in text.splitlines() if line.startswith("const FEATURES = "))
    background.write_text(text.replace(old, f"const FEATURES = {features};"))


def turn_on_developer_mode(profile: Path) -> None:
    """The seed's first step, in a fresh profile: a headless Chrome for Testing of the test's own
    (CDP, never a Worker) flips Developer mode as the Extensions page's switch does."""
    with sync_playwright() as playwright:
        context = playwright.chromium.launch_persistent_context(
            profile, headless=True, executable_path=str(chrome_for_testing()),
            ignore_default_args=["--use-mock-keychain"])  # the Worker's own keychain signs the protected pref
        try:
            page = context.new_page()
            page.goto("chrome://extensions")
            page.evaluate("() => new Promise(done => chrome.developerPrivate.updateProfileConfiguration({inDeveloperMode: true}, done))")
        finally:
            context.close()


@pytest.fixture
def setup():
    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Site)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    folder = Path(tempfile.mkdtemp(prefix="apw-reload-", dir="/tmp"))
    extension = folder / "extension"
    shutil.copytree(EXTENSION_DIR, extension, ignore=shutil.ignore_patterns("vendor"))
    workers = PlainWorkers(folder / "profiles", kind="testing", bridge=Bridge(folder / "t.sock"), extension_dir=extension)
    turn_on_developer_mode(workers.profile(0))
    assert developer_mode(workers.profile(0))
    try:
        yield workers, extension, f"http://127.0.0.1:{server.server_address[1]}"
    finally:
        workers.stop_all()
        server.shutdown()


def test_a_reloaded_extension_keeps_its_signed_in_page_its_tile_and_its_filling(setup):
    workers, extension, site = setup
    connection = workers.launch(0).connection
    page = PortPage.first(connection)
    page.goto(f"{site}/sign-in")
    page.goto(f"{site}/account")
    with PortFrames(1, workers.bridge.connection, capture="extension") as frames:
        seen = frames.wait(0, 0, 15)[1]

        level(extension, FEATURES + 1)  # a newer checkout on disk; the running code is still the old one
        workers.bridge.expects = FEATURES + 1
        fresh = workers.bridge.reload(0)
        tabs = fresh.call("tabs.query")
        again = PortPage.first(fresh)
        kept = again.evaluate("() => [location.pathname, document.getElementById('who').textContent]")
        again.fill("#name", "Filled after the reload")
        later = frames.wait(0, seen, 15)[1]

        assert fresh is not connection and fresh.hello["features"] == FEATURES + 1 and not fresh.stale
        assert [t["url"] for t in tabs] == [f"{site}/account"]  # the same tab, never reloaded
        assert kept == ["/account", "Signed in"]
        assert again.input_value("#name") == "Filled after the reload"
        assert later > seen  # the tile follows the new connection

        # An old one connecting (its port reopened): reloaded before its welcome, automatically.
        level(extension, FEATURES + 2)
        workers.bridge.expects = FEATURES + 2
        fresh.close()
        deadline = time.monotonic() + 30
        while ((now := workers.bridge.connection(0)) in (None, fresh) or now.hello.get("features") != FEATURES + 2) \
                and time.monotonic() < deadline:
            time.sleep(0.2)
        page = PortPage.first(now)
        page.goto(f"{site}/account")  # a navigation: the cookie still signs it in

        assert now.hello["features"] == FEATURES + 2 and not now.stale
        assert page.evaluate("() => document.getElementById('who').textContent") == "Signed in"
