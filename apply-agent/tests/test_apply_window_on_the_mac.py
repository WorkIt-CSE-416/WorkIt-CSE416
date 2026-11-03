"""The Apply window on the Mac: opened as the Apply app in the Dock, one
Chrome per window profile, and gone from the Dock once its window closes.
The Mac here is a fake: Chrome processes are entries in a table."""

import threading
import time
import urllib.error
import urllib.request
from contextlib import contextmanager

import pytest
from playwright.sync_api import sync_playwright

from apply import dashboard, dock_app
from apply.dashboard import Dashboard, NoFrames

CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"


class _Done:
    def __init__(self, stdout: str = ""):
        self.stdout, self.returncode = stdout, 0


class FakeMac:
    """Answers pgrep, osascript (window counts, frontmost), open and kill as the Mac would."""

    def __init__(self, app):
        self.app = app
        self.chromes: dict[int, dict] = {}  # pid -> {"args": [...], "windows": n}
        self.launched: list[list[str]] = []
        self.raised: list[int] = []
        self.quit: list[int] = []
        self._next = 4242

    def chrome(self, url: str, profile, windows: int = 1) -> int:
        pid, self._next = self._next, self._next + 1
        self.chromes[pid] = {"args": [f"--app={url}", f"--user-data-dir={profile}"], "windows": windows}
        return pid

    def run(self, cmd, **kwargs):
        if cmd[0] == "pgrep":
            profile = cmd[-1].split("--user-data-dir=")[1]
            return _Done("".join(f"{pid} {CHROME} {' '.join(c['args'])}\n" for pid, c in self.chromes.items()
                                 if c["args"][1] == f"--user-data-dir={profile}"))
        if cmd[0] == "osascript":
            pid = int(cmd[-1].split("unix id is ")[1].split(")")[0])
            if pid not in self.chromes:
                return _Done("")
            if "set frontmost" in cmd[-1]:
                self.raised.append(pid)
                return _Done("true\n")
            return _Done(f"{self.chromes[pid]['windows']}\n")
        if cmd[0] == "open":
            assert cmd[:3] == ["open", "-na", str(self.app)] and cmd[3] == "--args"
            assert not any(c["args"][1] == cmd[5] for c in self.chromes.values()), "a second Chrome on one profile"
            self.launched.append(cmd)
            self.chrome(cmd[4].removeprefix("--app="), cmd[5].removeprefix("--user-data-dir="))
            return _Done()
        raise AssertionError(f"unexpected command {cmd}")

    def kill(self, pid, signal):
        if pid not in self.chromes:
            raise ProcessLookupError(pid)
        if signal:  # 0 only asks whether it still runs
            self.quit.append(pid)
            self.chromes.pop(pid)


@pytest.fixture
def mac(monkeypatch, tmp_path) -> FakeMac:
    monkeypatch.setattr(dock_app, "APP", tmp_path / "Applications" / "Apply.app")
    monkeypatch.setattr(dock_app, "bundle_for", lambda profiles: dock_app.APP)
    fake = FakeMac(tmp_path / "Applications" / "Apply.app")
    monkeypatch.setattr(dashboard.subprocess, "run", fake.run)
    monkeypatch.setattr(dashboard.os, "kill", fake.kill)
    monkeypatch.setattr(dashboard.time, "sleep", lambda s: None)
    monkeypatch.setattr(dashboard, "CLOSE_GRACE", 0.2)
    return fake


def _closed(board: Dashboard, token: str) -> int:
    """What the window sends as it closes."""
    request = urllib.request.Request(board.url + "/closed", data=token.encode(), method="POST")
    try:
        with urllib.request.urlopen(request) as response:
            return response.status
    except urllib.error.HTTPError as refused:
        return refused.code


def _eventually(check, timeout: float = 5.0) -> bool:
    deadline = time.monotonic() + timeout
    while not check():
        if time.monotonic() > deadline:
            return False
        _pause(0.02)
    return True


def _pause(seconds: float) -> None:
    threading.Event().wait(seconds)  # time.sleep is stubbed out for open_window's waits


def test_the_window_opens_as_the_apply_app_and_comes_to_the_front(mac, tmp_path):
    profile = tmp_path / "profiles" / "dashboard"

    dashboard.open_window("http://127.0.0.1:61234", profile)

    assert mac.launched == [["open", "-na", str(mac.app), "--args", "--app=http://127.0.0.1:61234",
                             f"--user-data-dir={profile}", "--remote-debugging-port=0"]]
    assert (mac.app / "Contents" / "Info.plist").exists()  # the bundle the Dock names Apply
    assert mac.raised == list(mac.chromes)


class RecordingKeeper:
    def __init__(self):
        self.watched: dict[int, float | None] = {}

    @contextmanager
    def launching(self):
        yield

    def watch(self, pid: int, seconds: float | None = None) -> None:
        self.watched[pid] = seconds


def test_a_runs_window_opens_behind_lisuls_app_and_is_kept_there_while_chrome_starts(mac, tmp_path, monkeypatch):
    keeper = RecordingKeeper()
    monkeypatch.setattr(dashboard, "KEEPER", keeper)
    profile = tmp_path / "profiles" / "dashboard"

    dashboard.open_window("http://127.0.0.1:61234", profile, front=False)

    assert len(mac.launched) == 1
    assert mac.raised == []
    assert keeper.watched == {pid: dashboard.BEHIND_FOR for pid in mac.chromes}


def test_a_runs_window_already_open_is_left_where_it_is(mac, tmp_path):
    profile = tmp_path / "profiles" / "dashboard"
    mac.chrome("http://127.0.0.1:61234", profile)

    dashboard.open_window("http://127.0.0.1:61234", profile, front=False)

    assert mac.launched == [] and mac.raised == []


def test_a_window_already_open_on_this_server_is_brought_forward_not_launched_again(mac, tmp_path):
    profile = tmp_path / "profiles" / "dashboard"
    showing = mac.chrome("http://127.0.0.1:61234", profile)

    dashboard.open_window("http://127.0.0.1:61234/#answers", profile)  # `apply answers` while the run goes

    assert mac.launched == [] and mac.quit == []
    assert mac.raised == [showing]


def test_a_window_left_on_a_finished_runs_server_is_quit_before_the_new_one_opens(mac, tmp_path):
    profile = tmp_path / "profiles" / "dashboard"
    stale = mac.chrome("http://127.0.0.1:50000", profile)
    elsewhere = mac.chrome("http://127.0.0.1:50000", tmp_path / "profiles" / "answers")

    dashboard.open_window("http://127.0.0.1:61234", profile)

    assert mac.quit == [stale] and elsewhere in mac.chromes  # never another profile's window
    [(fresh, opened)] = [(pid, c) for pid, c in mac.chromes.items() if c["args"][1] == f"--user-data-dir={profile}"]
    assert opened["args"][0] == "--app=http://127.0.0.1:61234" and mac.raised == [fresh]


# A Mac app outlives its last window, so closing the window left its Chrome
# running: Apply's icon stayed in the Dock, a click on it opened a blank
# Chrome window, and `apply answers` waited on forever.
def test_closing_the_window_quits_its_chrome_so_apply_leaves_the_dock(mac, tmp_path):
    profile = tmp_path / "profiles" / "answers"
    with Dashboard(0, NoFrames()) as board:
        dashboard.open_window(board.url, profile)
        [pid] = mac.chromes

        assert _closed(board, board.token) == 204

        assert _eventually(lambda: mac.quit == [pid])
        assert not dashboard.window_open(profile)


# Apply's run ended, but its window stayed open on a page with no server.
def test_the_window_quits_when_its_run_ends_and_leaves_other_windows_alone(mac, tmp_path):
    profile = tmp_path / "profiles" / "dashboard"
    other = mac.chrome("http://127.0.0.1:50000", tmp_path / "profiles" / "answers")
    with Dashboard(0, NoFrames()) as board:
        dashboard.open_window(board.url, profile)
        [pid] = [p for p in mac.chromes if p != other]

    assert mac.quit == [pid] and other in mac.chromes


def test_reloading_the_window_keeps_it(mac, tmp_path):
    profile = tmp_path / "profiles" / "answers"
    with Dashboard(0, NoFrames()) as board:
        dashboard.open_window(board.url, profile)
        _closed(board, board.token)  # the page going away as it reloads...
        urllib.request.urlopen(board.url).read()  # ...and coming straight back
        _pause(dashboard.CLOSE_GRACE * 2)
        assert mac.quit == []


def test_only_the_window_itself_can_say_it_closed(mac, tmp_path):
    profile = tmp_path / "profiles" / "answers"
    with Dashboard(0, NoFrames()) as board:
        dashboard.open_window(board.url, profile)
        assert _closed(board, "a guess") == 403
        _pause(dashboard.CLOSE_GRACE * 2)
        assert mac.quit == []


def test_the_page_says_so_as_its_window_closes(mac, tmp_path):
    profile = tmp_path / "profiles" / "answers"
    with Dashboard(0, NoFrames()) as board, sync_playwright() as playwright:
        dashboard.open_window(board.url, profile)
        browser = playwright.chromium.launch()
        try:
            page = browser.new_page()
            page.goto(board.url)
            page.goto("about:blank")  # the page goes away as it does when its window closes

            assert _eventually(lambda: len(mac.quit) == 1)
        finally:
            browser.close()
