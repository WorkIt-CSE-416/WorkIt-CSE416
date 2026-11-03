"""The Apply window's own app bundle: what makes the Dock show it as Apply,
not as a second Google Chrome. The bundles here are scratch copies; their
launcher runs against a stand-in Chrome and a stand-in `apply`."""

import http.server
import json
import os
import plistlib
import subprocess
import sys
import threading
import time
from pathlib import Path

import pytest

from apply import dock_app


def _recorder(path: Path, out: Path) -> Path:
    """A stand-in program that writes its arguments, and $APPLY_PROFILES, to `out`."""
    path.write_text(f'#!/bin/sh\nprintf "%s\\n" "$@" "profiles=$APPLY_PROFILES" > "{out}"\n')
    path.chmod(0o755)
    return path


@pytest.fixture
def app(tmp_path) -> Path:
    return dock_app.install(tmp_path / "profiles", tmp_path / "Applications" / "Apply.app",
                            chrome=_recorder(tmp_path / "chrome", tmp_path / "chrome.out"),
                            python=_recorder(tmp_path / "python", tmp_path / "apply.out"))


def _launch(app: Path, *args: str) -> None:
    info = plistlib.loads((app / "Contents" / "Info.plist").read_bytes())
    subprocess.run([app / "Contents" / "MacOS" / info["CFBundleExecutable"], *args], check=True, timeout=10)


def _written(path: Path) -> list[str]:
    deadline = time.monotonic() + 10
    while not path.exists() or not path.read_text().endswith("\n"):
        assert time.monotonic() < deadline, f"{path.name} never written"
        time.sleep(0.05)
    return path.read_text().splitlines()


def test_the_dock_names_the_bundle_apply_with_its_own_icon(app):
    info = plistlib.loads((app / "Contents" / "Info.plist").read_bytes())
    assert info["CFBundleName"] == info["CFBundleDisplayName"] == "Apply"
    assert info["CFBundleIdentifier"] == dock_app.BUNDLE_ID != "com.google.Chrome"
    assert info["CFBundlePackageType"] == "APPL"
    # A script bundle launches under Rosetta unless it asks for arm64, and Chrome then hangs translating.
    assert info["LSArchitecturePriority"][0] == "arm64"
    icon = app / "Contents" / "Resources" / f"{info['CFBundleIconFile']}.icns"
    assert icon.read_bytes()[:4] == b"icns"


def test_opened_on_a_window_the_bundle_becomes_that_chrome(app, tmp_path):
    _launch(app, "--app=http://127.0.0.1:61234", f"--user-data-dir={tmp_path / 'profiles' / 'dashboard'}")

    assert _written(tmp_path / "chrome.out") == [
        "--app=http://127.0.0.1:61234", f"--user-data-dir={tmp_path / 'profiles' / 'dashboard'}", f"profiles={tmp_path / 'profiles'}",
    ]
    assert _written(tmp_path / "apply.out")[:2] == ["-m", "apply.dock_app"]  # the window's keeper, not `apply watch`


# Each click on Apply in the Dock left a Chrome tab: the New Tab closer was a thread of the
# process that opened the window, and `apply watch` (the Apply icon pressed with no window
# open) exits a moment after it opens one. The keeper now starts with the window's Chrome.
def test_the_window_starts_with_its_keeper_on_its_own_chrome(tmp_path):
    chrome = tmp_path / "chrome"
    chrome.write_text(f'#!/bin/sh\necho "$$" > "{tmp_path / "chrome.pid"}"\n')
    chrome.chmod(0o755)
    app = dock_app.install(tmp_path / "profiles", tmp_path / "Apply.app", chrome=chrome,
                           python=_recorder(tmp_path / "python", tmp_path / "keeper.out"))
    profile = tmp_path / "profiles" / "dashboard"

    _launch(app, "--app=http://127.0.0.1:61234", f"--user-data-dir={profile}", "--remote-debugging-port=0")

    [pid] = _written(tmp_path / "chrome.pid")  # the launcher's own pid: it became Chrome
    assert _written(tmp_path / "keeper.out")[:4] == ["-m", "apply.dock_app", pid, str(profile)]


class DevTools(http.server.BaseHTTPRequestHandler):
    """A window Chrome's DevTools: its Apply page, and the New Tab a Dock click opened beside it."""
    browser = "/devtools/browser/ours"
    pages: list[dict] = []
    asked: list[str] = []

    def do_GET(self):
        DevTools.asked.append(self.path)
        if self.path.startswith("/json/close/"):
            DevTools.pages = [p for p in DevTools.pages if p["id"] != self.path.rsplit("/", 1)[1]]
        found = {"webSocketDebuggerUrl": f"ws://127.0.0.1{DevTools.browser}"} if self.path == "/json/version" \
            else DevTools.pages
        self.send_response(200)
        self.end_headers()
        self.wfile.write(json.dumps(found).encode())

    def log_message(self, *args):
        pass


@pytest.fixture
def keeper(tmp_path):
    DevTools.pages = [{"id": "apply", "type": "page", "url": "http://127.0.0.1:61234/"},
                      {"id": "tab", "type": "page", "url": "chrome://newtab/"}]
    DevTools.asked = []
    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), DevTools)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    profile = tmp_path / "dashboard"
    profile.mkdir()
    (profile / "DevToolsActivePort").write_text(f"{server.server_port}\n/devtools/browser/ours\n")
    chrome = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(60)"])  # the window's Chrome
    keeper = threading.Thread(target=dock_app.keep, args=(chrome.pid, profile, 0.01), daemon=True)
    yield keeper
    chrome.kill()
    chrome.wait()
    keeper.join(5)
    assert not keeper.is_alive()  # the keeper ends with its Chrome
    server.shutdown()


def _eventually(check) -> bool:
    deadline = time.monotonic() + 5
    while not check():
        if time.monotonic() > deadline:
            return False
        time.sleep(0.01)
    return True


def test_a_new_tab_a_dock_click_opens_is_closed_and_the_window_brought_forward(keeper):
    keeper.start()

    assert _eventually(lambda: "/json/activate/apply" in DevTools.asked)
    assert "/json/close/tab" in DevTools.asked and [p["id"] for p in DevTools.pages] == ["apply"]


def test_a_port_another_chrome_took_since_is_left_alone(keeper):
    DevTools.browser = "/devtools/browser/another"
    try:
        keeper.start()
        assert _eventually(lambda: DevTools.asked.count("/json/version") >= 2)
        assert [p["id"] for p in DevTools.pages] == ["apply", "tab"]
    finally:
        DevTools.browser = "/devtools/browser/ours"


def test_opened_from_the_dock_with_no_window_it_runs_apply_watch(app, tmp_path):
    _launch(app)  # what a click on the Apply icon kept in the Dock, or a Spotlight search, does

    assert _written(tmp_path / "apply.out") == ["-m", "apply.cli", "watch", f"profiles={tmp_path / 'profiles'}"]
    assert not (tmp_path / "chrome.out").exists()


def test_installing_again_leaves_an_unchanged_bundle_alone(app, tmp_path):
    before = os.stat(app / "Contents" / "Info.plist").st_mtime_ns
    time.sleep(0.01)
    again = dock_app.install(tmp_path / "profiles", app, chrome=tmp_path / "chrome", python=tmp_path / "python")
    assert again == app and os.stat(app / "Contents" / "Info.plist").st_mtime_ns == before


def test_installing_from_another_checkout_points_the_bundle_there(app, tmp_path):
    other = _recorder(tmp_path / "other-python", tmp_path / "other.out")
    dock_app.install(tmp_path / "profiles", app, chrome=tmp_path / "chrome", python=other)
    _launch(app)
    assert _written(tmp_path / "other.out")[:3] == ["-m", "apply.cli", "watch"]


def _git(*args, cwd: Path) -> None:
    subprocess.run(["git", *args], cwd=cwd, check=True, capture_output=True)


def test_only_the_main_checkout_owns_the_dock_app(tmp_path):
    # A scratch worktree that opened the window took over ~/Applications/Apply.app, whose
    # icon then pointed at a folder about to be deleted.
    main = tmp_path / "repo"
    main.mkdir()
    _git("init", "-q", cwd=main)
    _git("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", "start", cwd=main)
    _git("worktree", "add", "-q", "--detach", str(tmp_path / "scratch"), cwd=main)

    assert dock_app.bundle_for(main / "apply" / "profiles", checkout=main) == dock_app.APP
    scratch = tmp_path / "scratch" / "apply" / "profiles"
    assert dock_app.bundle_for(scratch, checkout=tmp_path / "scratch") == scratch / "Apply.app"
