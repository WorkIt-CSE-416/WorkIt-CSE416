"""A tile shows its own Worker's window and its own form's tab, never another's (KAN-717): two fake
Workers (NVIDIA's and Bank of America's Chrome) and a fake ScreenCaptureKit helper in place of
Chrome and macOS. No browser, no Screen Recording."""

import base64
import json
import sys
import threading
import time
import urllib.request

import pytest

from apply.dashboard import Dashboard
from apply.plain import tile, window_capture
from apply.plain.tile import PortFrames

NVIDIA = b"\xff\xd8\xff\xe0 nvidia sign in"
BOFA = b"\xff\xd8\xff\xe0 bank of america log in"
CHROMES = {101: 1000, 201: 2000}  # each native host's PID -> its parent, the Worker's Chrome
WINDOWS = {  # what macOS lists: each Worker Chrome's window, its title and what it shows
    "bofa": {"pid": 2000, "title": "Log in - Bank of America", "data": base64.b64encode(BOFA).decode()},
    "nvidia": {"pid": 1000, "title": "Sign In", "data": base64.b64encode(NVIDIA).decode()},
}


class Worker:
    """One plain Worker's Connection, faked: its extension sends `tile.shown` (native) or `tile.frame`s
    of its shown tab, `frames[tab]`, the way worker-extension/ops/tile.js does."""

    def __init__(self, host_pid: int, title: str, frames: dict[int, bytes], tab: int):
        self.hello, self.relay, self.stale = {"type": "hello", "protocol": 1}, {"host_pid": host_pid}, False
        self.title, self.frames, self.tab = title, frames, tab
        self.closed = threading.Event()
        self.started: list[dict] = []
        self.inputs: list[dict] = []
        self._handlers: dict[str, list] = {}

    def on(self, event, handler):
        self._handlers.setdefault(event, []).append(handler)

    def send(self, event, **message):
        for handler in self._handlers.get(event, []):
            handler({"event": event, **message})

    def call(self, op, timeout=None, **params):
        if op == "tile.start":
            self.started.append(params)
            threading.Thread(target=self._stream, args=(len(self.started), params.get("native")), daemon=True).start()
        if op == "tile.input":
            self.inputs.append(params)
            return {}

    def _stream(self, mine: int, native: bool):
        n = 0
        while not self.closed.is_set() and len(self.started) == mine:
            n += 1
            if native:
                self.send("tile.shown", tab=self.tab, url="", title=self.title,
                          window={"left": 0, "top": 33, "width": 1280, "height": 900, "state": "normal"},
                          viewport={"width": 1280, "height": 813 + n % 2})  # changes: aimed again each turn
            else:
                self.send("tile.frame", tab=self.tab, data=base64.b64encode(self.frames[self.tab]).decode())
            time.sleep(0.1)


HELPER = '''import json, os, struct, sys
windows = json.loads(os.environ["FAKE_WINDOWS"])
pid = int(sys.argv[sys.argv.index("--pid") + 1])
for line in sys.stdin:
    title = line.rstrip("\\n").split(" ", 6)[6]
    if os.environ.get("FAKE_HELPER") == "confused":  # films a window of another Chrome: the bug KAN-717 guards against
        found = windows["bofa"]
    else:
        found = next((w for w in windows.values() if w["pid"] == pid and w["title"] == title), None)
    if found is None:
        print(json.dumps({"mismatch": "no window of pid %d titled as its tab" % pid, "pid": pid}), file=sys.stderr, flush=True)
        continue
    print(json.dumps({"window": 7, "pid": found["pid"], "title": found["title"]}), file=sys.stderr, flush=True)
    frame = __import__("base64").b64decode(found["data"])
    for _ in range(3):
        sys.stdout.buffer.write(struct.pack(">I", len(frame)) + frame)
    sys.stdout.buffer.flush()
'''


@pytest.fixture
def helper(tmp_path, monkeypatch):
    """The ScreenCaptureKit helper, faked by a script that films the window macOS lists for its --pid
    and the aimed title (or, `FAKE_HELPER=confused`, Bank of America's whatever it is asked)."""
    script = tmp_path / "window-capture"
    script.write_text(f"#!{sys.executable}\n{HELPER}")
    script.chmod(0o700)
    monkeypatch.setenv("FAKE_WINDOWS", json.dumps(WINDOWS))
    monkeypatch.setattr(window_capture, "helper", lambda: script)
    monkeypatch.setattr(window_capture, "allowed", lambda: True)
    monkeypatch.setattr(window_capture, "chrome_of", lambda host_pid: CHROMES.get(host_pid))
    return monkeypatch


def two_workers(nvidia_host: int = 101):
    nvidia = Worker(nvidia_host, "Sign In", {5: b"\xff\xd8\xff\xe0 nvidia from its extension"}, tab=5)
    bofa = Worker(201, "Log in - Bank of America", {9: BOFA}, tab=9)
    return nvidia, bofa


def seen(frames: PortFrames, worker: int, seconds: float) -> list[bytes]:
    """Every frame Worker `worker`'s tile shows for `seconds`."""
    shown, number, deadline = [], 0, time.monotonic() + seconds
    while time.monotonic() < deadline:
        frame, number = frames.wait(worker, number, 0.2)
        if frame is not None and (not shown or shown[-1] != frame):
            shown.append(frame)
    return shown


def test_each_workers_tile_films_its_own_chromes_window(helper):
    nvidia, bofa = two_workers()
    with PortFrames(2, [nvidia, bofa].__getitem__, capture="native", chrome={0: 1000, 1: 2000}.get) as frames:
        tiles = seen(frames, 0, 2), seen(frames, 1, 0.1)

    assert tiles == ([NVIDIA], [BOFA])


def test_a_helper_that_films_another_workers_window_never_shows_it(helper):
    helper.setenv("FAKE_HELPER", "confused")
    nvidia, bofa = two_workers()
    with PortFrames(2, [nvidia, bofa].__getitem__, capture="native", chrome={0: 1000, 1: 2000}.get) as frames:
        nvidia_tile = seen(frames, 0, tile.FIRST_FRAME + 2)

    assert BOFA not in nvidia_tile  # its frames were dropped: the window is pid 2000's, not 1000's
    assert nvidia_tile == [nvidia.frames[5]]  # then the extension's frames, from NVIDIA's own Chrome
    assert nvidia.started[-1]["native"] is False


def test_a_window_titled_as_another_tab_is_not_filmed_and_the_extension_frames_show(helper):
    nvidia, _ = two_workers()
    nvidia.title = "Log in - Bank of America"  # NVIDIA's Chrome lists no window with this title
    with PortFrames(1, [nvidia].__getitem__, capture="native", chrome={0: 1000}.get) as frames:
        nvidia_tile = seen(frames, 0, 2)

    assert nvidia_tile == [nvidia.frames[5]] and nvidia.started[-1]["native"] is False


def test_a_connection_from_another_workers_chrome_shows_nothing_on_the_tile(helper):
    _, bofa = two_workers()
    with PortFrames(1, [bofa].__getitem__, capture="native", chrome={0: 1000}.get) as frames:
        time.sleep(1.5)
        shown, reply = frames.frame(0), frames.input(0, {"type": "down", "x": 1, "y": 1})

        assert shown is None and reply is None and bofa.started == [] and bofa.inputs == []
        assert frames.notice(0) == tile.FOREIGN


def test_a_connection_whose_chrome_is_told_later_is_set_up_then(helper):
    """Its Chrome's PID unknown at first: nothing until it is known and is this Worker's, then its frames."""
    known = threading.Event()
    helper.setattr(window_capture, "chrome_of", lambda host_pid: CHROMES.get(host_pid) if known.is_set() else None)
    nvidia, _ = two_workers()
    with PortFrames(1, [nvidia].__getitem__, capture="extension", chrome={0: 1000}.get) as frames:
        time.sleep(1)
        before = frames.frame(0), list(nvidia.started)
        known.set()
        after = seen(frames, 0, 1.5)

    assert before == (None, []) and after == [nvidia.frames[5]] and frames.notice(0) == ""


def get(url: str) -> bytes:
    with urllib.request.urlopen(url) as response:
        return response.read() if response.status == 200 else b""


def test_each_into_tile_shows_and_takes_input_on_its_own_tab_only():
    """Three forms in one Worker (`apply rehearse --into`): each tile is its form's tab, whichever is active."""
    forms = {1: b"\xff\xd8 form one", 2: b"\xff\xd8 form two", 3: b"\xff\xd8 form three"}
    worker = Worker(101, "", forms, tab=1)
    with PortFrames(1, lambda k: worker, capture="extension") as frames, Dashboard(1, frames) as board:
        board.add_tile(0), board.add_tile(0)
        for tile_number, tab in enumerate(forms):
            board.showing(tile_number, tab)
        for tab in forms:  # Lisul switches through the Worker's tabs
            worker.tab = tab
            frames.wait(0, frames.wait(0, 0, 0)[1], 2)
            time.sleep(0.3)
        worker.tab = 2
        time.sleep(0.3)
        served = [get(f"{board.url}/frame/{k}") for k in range(3)]
        board._frames.input(0, {"type": "down", "x": 1, "y": 1})

    assert served == [forms[1], forms[2], forms[3]]
    assert worker.inputs[-1]["tab"] == 1  # tile 0's click went to tile 0's form, though tab 2 is shown


def test_a_forms_own_popup_shows_and_takes_input_on_its_tile_but_another_tab_doesnt():
    forms = {1: b"\xff\xd8 form", 2: b"\xff\xd8 its pop-up", 3: b"\xff\xd8 another form"}
    worker = Worker(101, "", forms, tab=1)

    def shows(tab: int) -> bytes | None:
        worker.tab = tab
        time.sleep(0.35)
        return frames.frame(0, tab=1)

    with PortFrames(1, lambda k: worker, capture="extension") as frames:
        time.sleep(0.8)
        worker.send("tab.created", tab=2, opener=1)
        shown = [shows(1), shows(2)]
        frames.input(0, {"type": "down", "x": 1, "y": 1}, tab=1)
        shown.append(shows(3))  # a tab no page of this form opened: not this tile's
        frames.input(0, {"type": "down", "x": 1, "y": 1}, tab=1)
        worker.send("tab.removed", tab=2)
        shown.append(shows(1))

    assert shown == [forms[1], forms[2], forms[2], forms[1]]
    assert [i["tab"] for i in worker.inputs] == [2, 2]


class Filmed:
    """The helper, faked in place of WindowStream, its frames pushed by the test."""

    def __init__(self, pid, on_frame, **_):
        self.status, self.alive, self.push = {}, True, on_frame

    def aim(self, window, viewport, title=""):
        pass

    def close(self):
        self.alive = False


def test_filmed_frames_from_around_a_tab_switch_go_to_neither_tab(helper):
    films = []
    helper.setattr(window_capture, "WindowStream", lambda pid, on_frame, **_: films.append(Filmed(pid, on_frame)) or films[-1])
    worker = Worker(101, "Sign In", {}, tab=1)
    worker.call = lambda op, timeout=None, **params: None  # no events of its own: the test sends them
    with PortFrames(1, lambda k: worker, capture="native", chrome={0: 1000}.get) as frames:
        until = time.monotonic() + 3
        while not films and time.monotonic() < until:
            time.sleep(0.05)
        shown = {"url": "", "title": "Sign In", "window": {"left": 0, "top": 0, "width": 9, "height": 9},
                 "viewport": {"width": 9, "height": 9}}
        worker.send("tile.shown", tab=1, **shown)
        films[0].push(b"\xff\xd8 tab one")
        time.sleep(tile.SETTLE + 0.1)
        films[0].push(b"\xff\xd8 tab two, before its tile.shown")
        worker.send("tile.shown", tab=2, **shown)
        films[0].push(b"\xff\xd8 tab two, settling")
        time.sleep(tile.SETTLE + 0.05)
        films[0].push(b"\xff\xd8 tab two")

        assert frames.frame(0, tab=1) == b"\xff\xd8 tab one"
        assert frames.frame(0, tab=2) == b"\xff\xd8 tab two"


@pytest.mark.parametrize(("window", "tab", "same"), [
    ("Sign In", "Sign In", True),
    ("Log in - Bank of America", "Sign In", False),
    ("Submit application for Software …iences Internship Opportunities",
     "Submit application for Software Engineering at Sciences Internship Opportunities", True),
    ("Submit application for Software …iences Internship Opportunities", "Submit application for Hardware", False),
    ("Sign In - Google Chrome - Worker", "Sign In", True),
    ("", "", False),
])
def test_a_window_title_matches_its_tab_as_macos_lists_it(window, tab, same):
    assert window_capture.title_matches(window, tab) is same
