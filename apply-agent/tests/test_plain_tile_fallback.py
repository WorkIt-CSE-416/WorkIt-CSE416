"""A filmed plain Worker tile never stays blank (KAN-643), with a fake extension and a fake
ScreenCaptureKit helper in place of Chrome: no browser, no Screen Recording."""

import base64
import threading
import time

import pytest

from apply.plain import tile, window_capture
from apply.plain.tile import PortFrames

JPEG = b"\xff\xd8\xff\xe0fake jpeg"


class OldExtension:
    """A Worker's Connection whose extension is from before KAN-635: tile.start streams
    `tile.frame`s whatever `native` says, and it never sends `tile.shown`."""

    def __init__(self):
        self.hello, self.relay = {"type": "hello", "protocol": 1}, {"host_pid": 1}
        self.closed = threading.Event()
        self.started: list[dict] = []
        self._handlers: dict[str, list] = {}

    def on(self, event, handler):
        self._handlers.setdefault(event, []).append(handler)

    def call(self, op, timeout=None, **params):
        if op == "tile.start":
            self.started.append(params)
            threading.Thread(target=self._stream, args=(len(self.started),), daemon=True).start()

    def _stream(self, mine: int):
        n = 0
        while not self.closed.is_set() and len(self.started) == mine:
            n += 1
            for handler in self._handlers.get("tile.frame", []):
                handler({"event": "tile.frame", "tab": 7, "data": base64.b64encode(JPEG + bytes([n % 250])).decode()})
            time.sleep(0.1)


class NeverAimed:
    """The helper, running, but never aimed (no `tile.shown`): no frame ever comes."""

    def __init__(self, pid, on_frame, **_):
        self.status, self.alive = {}, True

    def aim(self, window, viewport):
        raise AssertionError("aimed without a tile.shown")

    def close(self):
        self.alive = False


@pytest.fixture
def filmable(monkeypatch):
    monkeypatch.setattr(window_capture, "allowed", lambda: True)
    monkeypatch.setattr(window_capture, "chrome_of", lambda pid: 4242)
    monkeypatch.setattr(window_capture, "WindowStream", NeverAimed)


def test_a_filmed_tile_whose_extension_never_sends_tile_shown_shows_the_extensions_frames(filmable):
    extension = OldExtension()
    with PortFrames(1, lambda k: extension, capture="native") as frames:
        time.sleep(1)
        filmed = frames.native, frames.wait(0, 0, 0)[1]  # filmed, so the extension's frames are dropped
        frame, seen = frames.wait(0, 0, tile.FIRST_FRAME + 3)

        assert filmed == ({0: True}, 0)
        assert frame.startswith(JPEG) and seen > 0
        assert frames.native == {} and extension.started[-1]["native"] is False

