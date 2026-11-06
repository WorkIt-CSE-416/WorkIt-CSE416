"""Adversarial review of PR 480 (KAN-717). Each test states the SAFE behaviour, so a failure is a live hole."""

import json
import shutil
import tempfile
import threading
import time
import urllib.error
import urllib.request
from contextlib import contextmanager
from pathlib import Path

import pytest

from apply.dashboard import Dashboard
from apply.plain import window_capture
from apply.plain.tile import PortFrames
from apply.submit_guard import guard, lift

HOST = "https://jobs.example.com"
FINAL = "/acme/jobs/123/apply"
FORM = "/acme/jobs/123/form"
HOSTILE = "/evil/start"
# A real SOF0 JPEG header: 1280x800, as to_page_event needs a frame's size.
JPEG = b"\xff\xd8\xff\xc0\x00\x11\x08\x03\x20\x05\x00\x03\x01\x22\x00\x02\x11\x01\x03\x11\x01 and the rest"


class Worker:
    def __init__(self, host_pid=101):
        self.hello, self.relay, self.stale = {"type": "hello", "protocol": 1}, {"host_pid": host_pid}, False
        self.closed = threading.Event()
        self.inputs, self.started, self.calls, self._h = [], [], [], {}

    def on(self, event, handler):
        self._h.setdefault(event, []).append(handler)

    def send(self, event, **m):
        for handler in self._h.get(event, []):
            handler({"event": event, **m})

    def call(self, op, timeout=None, **params):
        self.calls.append((op, params))
        if op == "tile.start":
            self.started.append(params)
        if op == "tile.input":
            self.inputs.append(params)
            return params.pop("reply", {})


def post(url, body, **headers):
    request = urllib.request.Request(url, data=json.dumps(body).encode(), method="POST", headers=headers)
    with urllib.request.urlopen(request) as response:
        return response.status


def window(board):
    """The headers the Apply window's own page sends with a press (dashboard_page's `send`)."""
    return {"X-Apply-Token": board.token, "Origin": board.url}


def started(frames, worker):
    until = time.monotonic() + 3
    while not worker.started and time.monotonic() < until:
        time.sleep(0.02)
    assert worker.started


CLICK = {"button": "left", "clicks": 1, "x": 10, "y": 10, "w": 1280, "h": 800}


# --- 1. the tile server's input endpoint

def test_another_sites_page_cant_post_a_press_to_the_tile_server():
    worker = Worker()
    with PortFrames(1, lambda k: worker, capture="extension") as frames, Dashboard(1, frames) as board:
        started(frames, worker)
        worker.send("tile.frame", tab=1, data=__import__("base64").b64encode(JPEG).decode())
        board.showing(0, 1)
        for kind in ("down", "up"):
            try:
                post(f"{board.url}/input/0", {"type": kind, **CLICK}, Origin="https://evil.example",
                     **{"Content-Type": "text/plain"})
            except urllib.error.HTTPError:
                pass
    assert worker.inputs == []  # no token, another site's Origin


def _plain_or_skip():
    from plain_fakes import have_chrome_for_testing
    if not have_chrome_for_testing():
        pytest.skip("needs Chrome for Testing")


class Site:
    def __init__(self, pages, headers=None):
        self.pages, self.sent, self.headers = pages, [], headers or {}

    def handle(self, route):
        request = route.request
        path = request.url.split("example.com", 1)[-1].split("?")[0] if "example.com" in request.url else request.url
        if request.method not in ("GET", "HEAD", "OPTIONS"):
            self.sent.append(path)
        extra = self.headers.get(path, {})
        route.fulfill(body=self.pages.get(path, "<title>Thanks</title><p>Thank you</p>"), content_type="text/html",
                      headers=extra) if extra else route.fulfill(body=self.pages.get(path, "<title>Thanks</title><p>Thank you</p>"), content_type="text/html")


HELD_FORM = f"""<title>Held form</title><h1>Acme</h1><form method=post action="{FINAL}">
<input name=first value=Lisul><p style="height:200px"></p>
<button style="width:320px;height:90px">Submit application</button></form>"""
# What a hostile page runs: a grid of forged presses over the whole tile, blind to where Submit is.
GRID = """async (input) => {
  let tried = 0;
  for (let y = 40; y < 800; y += 70) for (let x = 40; x < 1280; x += 120) {
    for (const type of ['down', 'up']) {
      await fetch(input, {method: 'POST', mode: 'no-cors', headers: {'Content-Type': 'text/plain'},
                          body: JSON.stringify({type, x, y, w: 1280, h: 800, button: 'left', clicks: 1})});
    }
    tried++;
    if (window.__stop) return tried;
  }
  return tried;
}"""


@contextmanager
def real_worker(site):
    """A plain Worker like plain_fakes.fake_page's, but 127.0.0.1 is left alone, so the tile server is reachable."""
    _plain_or_skip()
    from plain_fakes import https_fake

    from apply.plain.bridge import Bridge
    from apply.plain.launcher import PlainWorkers
    from apply.plain.page import PortContext, PortPage

    folder = Path(tempfile.mkdtemp(prefix="apw-r-", dir="/tmp"))
    with https_fake(site.handle, list) as port:
        flags = (f"--host-resolver-rules=MAP * 127.0.0.1:{port},EXCLUDE 127.0.0.1", "--ignore-certificate-errors", "--disable-quic")
        workers = PlainWorkers(folder, kind="testing", bridge=Bridge(folder / "w.sock"), test_flags=flags)
        try:
            connection = workers.launch(0).connection
            PortPage.first(connection)
            yield PortContext(connection)
        finally:
            workers.stop_all()
            shutil.rmtree(folder, ignore_errors=True)


def _frame_of(frames, tab, seconds=8):
    until = time.monotonic() + seconds
    while time.monotonic() < until:
        if frames.frame(0, tab):
            return True
        time.sleep(0.1)
    return False


def test_a_hostile_tab_cant_press_the_held_forms_submit_through_the_tile_server():
    """End to end on a real plain Worker: form A is held (lifted). Hostile tab B, still GUARDED, POSTs forged
    presses to tile A's /input from page script, in B's own world. Lisul touches nothing."""
    site = Site({FORM: HELD_FORM, HOSTILE: "<title>Evil</title><p>Nothing to see</p>"})
    with real_worker(site) as context:
        held = context.new_page()
        held.goto(HOST + FORM)
        guard(held)
        lift(held)
        held.bring_to_front()
        with PortFrames(1, lambda k: context.worker, capture="extension") as frames, Dashboard(1, frames) as board:
            board.showing(0, held.tab)
            assert _frame_of(frames, held.tab), "no frame of the held form"
            hostile = context.new_page()  # the `--into` form's tab: guarded, and the active one
            guard(hostile)
            hostile.goto(HOST + HOSTILE)
            tried = hostile.evaluate(f"({GRID})({json.dumps(board.url + '/input/0')})")
            print("forged presses tried:", tried, "sent:", site.sent)
            time.sleep(1.5)
    assert [p for p in site.sent if FINAL in p] == []


# --- 2. a tile with no `showing` yet (its form's page still loading)

B64 = __import__("base64").b64encode(JPEG).decode()


def test_after_showing_a_press_never_lands_on_the_new_active_tab():
    """The other side, which HOLDS: once `showing` said, a tab switch at the moment of the press changes nothing."""
    worker = Worker()
    with PortFrames(1, lambda k: worker, capture="extension") as frames, Dashboard(1, frames) as board:
        started(frames, worker)
        worker.send("tile.frame", tab=1, data=B64)
        board.showing(0, 1)
        worker.send("tile.frame", tab=2, data=B64)  # the page forced a switch to tab 2
        post(f"{board.url}/input/0", {"type": "down", **CLICK}, **window(board))
        worker.send("tile.frame", tab=3, data=B64)
        post(f"{board.url}/input/0", {"type": "up", **CLICK}, **window(board))
    assert [i["tab"] for i in worker.inputs] == [1, 1]


# --- 4. the title check

@pytest.mark.parametrize(("window", "tab"), [
    ("S…", "Submit application for Software Engineering"),  # a page's own title with a "…" in it: any tab starting S
    ("…g", "Submit application for Software Engineering"),
    ("Submit application - Google Chrome anything the page likes", "Submit application"),
])
def test_a_page_chosen_window_title_doesnt_pass_for_another_tabs(window, tab):
    assert window_capture.title_matches(window, tab) is False


# --- 5. PortFrames's PID check when a PID is unknown

@pytest.mark.parametrize(("chrome", "host"), [(lambda k: 1000, None), (lambda k: None, 2000)])
def test_a_connection_whose_chrome_cant_be_told_takes_no_input(monkeypatch, chrome, host):
    monkeypatch.setattr(window_capture, "chrome_of", lambda host_pid: host)
    worker = Worker()
    with PortFrames(1, lambda k: worker, capture="extension", chrome=chrome) as frames:
        time.sleep(0.8)
        worker.send("tile.frame", tab=1, data=B64)
        frames.input(0, {"type": "down", "x": 1, "y": 1})
    assert worker.started == [] and worker.inputs == []


# --- 7. on a real plain Worker: what a page at a PUBLIC address can do (Chrome's Local Network Access applies)

PUBLIC = {"Content-Security-Policy": "treat-as-public-address"}
FORGE = """([action, event]) => {
  const form = document.createElement('form');
  form.method = 'POST'; form.enctype = 'text/plain'; form.action = action;
  const field = document.createElement('input');
  field.type = 'hidden';  // hidden fields only, before any press: the guard's sign-in relay lets it through
  field.name = JSON.stringify(event).slice(0, -1) + ',"_":"'; field.value = '"}';
  form.append(field); document.body.append(form); form.submit();
}"""


def test_a_public_guarded_page_that_knows_the_port_cant_press_the_held_forms_submit():
    """The same as above with fetch stopped by Local Network Access: a page's own form POST, which LNA doesn't
    gate, which the guard passes as a relay, and whose 204 leaves the page where it is. Port given: see the report."""
    site = Site({FORM: HELD_FORM, HOSTILE: "<title>Evil</title><p>x</p>"}, headers={HOSTILE: PUBLIC})
    with real_worker(site) as context:
        held = context.new_page()
        held.goto(HOST + FORM)
        guard(held)
        lift(held)
        held.bring_to_front()
        box = held.get_by_role("button", name="Submit application").bounding_box()
        inner = held.evaluate("() => [innerWidth, innerHeight]")
        with PortFrames(1, lambda k: context.worker, capture="extension") as frames, Dashboard(1, frames) as board:
            board.showing(0, held.tab)
            assert _frame_of(frames, held.tab)
            hostile = context.new_page()
            guard(hostile)
            hostile.goto(HOST + HOSTILE)
            for kind in ("down", "up"):
                hostile.goto(HOST + HOSTILE)  # a new document: its relay form is untouched either way
                at = {"type": kind, "x": box["x"] + box["width"] / 2, "y": box["y"] + box["height"] / 2,
                      "w": inner[0], "h": inner[1], "button": "left", "clicks": 1}
                hostile.evaluate(FORGE, [board.url + "/input/0", at])
                time.sleep(1)
            time.sleep(1)
    assert [p for p in site.sent if FINAL in p] == []
