"""The live tile and Fix from the window on plain Workers (S3, KAN-609).

PortFrames is the Apply window's frame source (dashboard.Frames) for plain Workers, as
CdpFrames is for CDP ones. With Screen Recording permission, Apply films each Worker's own
window with ScreenCaptureKit (apply.plain.window_capture, KAN-635): 30 frames a second at the
screen's pixel scale, the extension only saying which window and tab are shown (`tile.shown`).
Without it, each Worker's extension streams its shown tab as `tile.frame` events
(captureVisibleTab, about 2 frames a second, only when the picture changed), and the tile says
how to turn the permission on (`notice`). A tile's clicks, keys, wheel, pastes, <select> picks and files go back as `tile.input`, replayed
in the page as synthetic DOM events. No CDP anywhere.

Mouse is PortPage.mouse, and expect_file_chooser is PortPage.expect_file_chooser: a click
with no user activation opens no picker, so the extension marks the file input the page
asked for, and FileChooser.set_files gives it files through DataTransfer.
"""

import base64
import threading
import time
from collections.abc import Callable
from contextlib import contextmanager
from pathlib import Path
from typing import Self

from apply import stuck
from apply.dashboard import ERRORS_EVERY, jpeg_size
from apply.plain import window_capture
from apply.plain.bridge import Connection, PortError, PortTimeoutError
from apply.plain.page import POLL, PortPage, file_payloads

INPUT_WAIT = 5.0  # s a tile event may take on the page before the window gives up on it
WATCH_EVERY = 0.5  # s between looks for Workers that connected or went away


class PortFrames:
    """Each plain Worker's shown tab, streamed to its tile, and its tile's input replayed on it.
    `connection(k)` is Worker k's bridge Connection, None while it has none (launcher:
    `lambda k: workers.bridge.connection(k)`). Implements dashboard.Frames."""

    def __init__(self, workers: int, connection: Callable[[int], Connection | None], capture: str | None = None,
                 **settings):
        """`capture`: "native" (ScreenCaptureKit when allowed, else the extension's frames) or
        "extension" (default: window_capture.mode(), $APPLY_TILE_CAPTURE)."""
        self._workers = workers
        self._connection = connection
        self._capture = capture or window_capture.mode()
        self._allowed: bool | None = None  # Screen Recording permission, looked at once
        self._streams: dict[int, window_capture.WindowStream] = {}  # worker -> its window, filmed
        self._notes: dict[int, str] = {}  # worker -> the tile's line about its capture
        self._settings = settings  # tile.start's: interval ms, quality, maxWidth, maxHeight
        self._frames: dict[int, tuple[bytes, int]] = {}  # worker -> (latest frame, its number)
        self._tabs: dict[int, int] = {}  # worker -> the tab its latest frame shows
        self._watched: dict[int, Connection] = {}
        self._choosers: dict[int, dict] = {}  # worker -> {mode, tab, frame} of the file input its page asked for
        self._errors: dict[int, tuple[str, float]] = {}
        self._pages: dict[tuple[int, int], PortPage] = {}
        self._changed = threading.Condition()
        self._stop = threading.Event()
        self._thread = threading.Thread(target=self._run, name="plain-frames", daemon=True)

    def __enter__(self) -> Self:
        self._thread.start()
        return self

    def __exit__(self, *exc) -> None:
        self._stop.set()
        self._thread.join(5)
        for connection in list(self._watched.values()):
            try:
                connection.call("tile.stop", timeout=2)
            except PortError:
                pass
        for stream in list(self._streams.values()):
            stream.close()

    @property
    def native(self) -> dict[int, bool]:
        """Which Workers' tiles are filmed by ScreenCaptureKit right now."""
        return {worker: stream.alive for worker, stream in self._streams.items()}

    def notice(self, worker: int) -> str:
        """The tile's one line about how it is filmed: how to turn on Screen Recording, or ""."""
        return self._notes.get(worker, "")

    # --- dashboard.Frames

    def frame(self, worker: int) -> bytes | None:
        return self._frames.get(worker, (None, 0))[0]

    def wait(self, worker: int, after: int, timeout: float) -> tuple[bytes | None, int]:
        with self._changed:
            self._changed.wait_for(lambda: self._frames.get(worker, (None, 0))[1] > after, timeout)
            return self._frames.get(worker, (None, 0))

    def input(self, worker: int, event: dict) -> dict | None:
        connection = self._watched.get(worker)
        if connection is None or connection.closed.is_set():
            return None
        try:
            if event["type"] == "files":
                return self._give(connection, worker, event.get("paths") or [])
            size = jpeg_size(self.frame(worker) or b"") or (None, None)
            reply = connection.call("tile.input", timeout=INPUT_WAIT, tab=self._tabs.get(worker), event=event,
                                    width=size[0], height=size[1])
        except (PortError, OSError):
            return None  # the page went away under it
        if isinstance(reply, dict) and reply.get("chooser"):
            self._choosers[worker] = {"mode": reply["chooser"], "tab": reply.get("tab"), "frame": reply.get("frame", 0)}
            return None
        return reply if isinstance(reply, dict) and ("menu" in reply or "text" in reply) else None

    def chooser(self, worker: int) -> str | None:
        return self._choosers.get(worker, {}).get("mode")

    def forget_chooser(self, worker: int) -> None:
        """The file its page asked for was given another way (Claude set the input itself)."""
        self._choosers.pop(worker, None)

    def field_error(self, worker: int) -> str:
        return self._errors.get(worker, ("", 0.0))[0]

    # --- the frames thread

    def _give(self, connection: Connection, worker: int, paths: list[str]) -> None:
        """Answer the file input Worker `worker`'s page asked for with `paths` (none: let it go)."""
        chooser = self._choosers.pop(worker, None)
        if chooser:
            connection.call("chooser.set", timeout=60, tab=chooser["tab"], frame=chooser["frame"],
                            files=file_payloads([Path(p) for p in paths]))

    def _keep(self, worker: int, message: dict) -> None:
        if worker not in self._streams:  # a filmed tile's frames come from its window, not the extension
            self._store(worker, base64.b64decode(message.get("data") or ""), message.get("tab"))

    def _store(self, worker: int, frame: bytes, tab: int | None = None) -> None:
        if not frame.startswith(b"\xff\xd8"):
            return
        with self._changed:
            self._frames[worker] = (frame, self._frames.get(worker, (None, 0))[1] + 1)
            if tab is not None:
                self._tabs[worker] = tab
            self._changed.notify_all()

    def _aim(self, worker: int, message: dict) -> None:
        """The extension's `tile.shown`: film that window, cropped to that tab's viewport."""
        self._tabs[worker] = message.get("tab", self._tabs.get(worker))
        stream, window = self._streams.get(worker), message.get("window") or {}
        if stream and window.get("state") != "minimized" and message.get("viewport", {}).get("width"):
            stream.aim(window, message["viewport"])

    def _film(self, worker: int, connection: Connection) -> bool:
        """Start filming Worker `worker`'s window natively; False when it can't be (then the extension's frames)."""
        if self._capture != "native":
            return False
        if self._allowed is None:
            self._allowed = window_capture.allowed()
        if not self._allowed:
            self._notes[worker] = window_capture.permission_note()
            return False
        pid = window_capture.chrome_of(connection.relay.get("host_pid"))
        if pid is None:
            return False
        self._streams[worker] = window_capture.WindowStream(pid, lambda frame, worker=worker: self._store(worker, frame))
        self._notes.pop(worker, None)
        return True

    def _unfilm(self, worker: int) -> None:
        if stream := self._streams.pop(worker, None):
            stream.close()

    def _run(self) -> None:
        while not self._stop.is_set():
            for worker in range(self._workers):
                try:
                    self._follow(worker)
                    self._read_errors(worker)
                except Exception:
                    pass  # never end this thread: every tile would freeze for good
            self._stop.wait(WATCH_EVERY)

    def _follow(self, worker: int) -> None:
        """Stream Worker `worker` once it connects, again after it reconnects."""
        connection = self._connection(worker)
        if connection is not None and connection.closed.is_set():
            connection = None
        if connection is self._watched.get(worker):
            if connection is not None and (stream := self._streams.get(worker)) and not stream.alive:
                self._unfilm(worker)  # the helper ended: the extension's frames from now on
                connection.call("tile.start", timeout=5, **{**self._settings, "native": False})
            return
        self._unfilm(worker)
        self._watched.pop(worker, None)
        self._choosers.pop(worker, None)
        self._pages = {key: page for key, page in self._pages.items() if key[0] != worker}
        if connection is None:
            return
        connection.on("tile.frame", lambda message, worker=worker: self._keep(worker, message))
        connection.on("tile.shown", lambda message, worker=worker: self._aim(worker, message))
        connection.call("tile.start", timeout=5, **{**self._settings, "native": self._film(worker, connection)})
        self._watched[worker] = connection

    def _read_errors(self, worker: int) -> None:
        """The field error Worker `worker`'s shown page shows, every ERRORS_EVERY s (apply.stuck)."""
        connection, tab = self._watched.get(worker), self._tabs.get(worker)
        if connection is None or tab is None:
            self._errors.pop(worker, None)
            return
        if time.monotonic() - self._errors.get(worker, ("", -ERRORS_EVERY))[1] < ERRORS_EVERY:
            return
        page = self._pages.get((worker, tab)) or self._pages.setdefault((worker, tab), PortPage(connection, tab))
        self._errors[worker] = (stuck.field_error(page), time.monotonic())


class EitherFrames:
    """worker_mode `protected` (S8): Worker k's tile from `port` (PortFrames) while its form is on a
    plain Worker (`plain(k)`), else from `cdp` (CdpFrames). Implements dashboard.Frames."""

    def __init__(self, cdp, port: PortFrames, plain: Callable[[int], bool]):
        self._cdp, self._port, self._plain = cdp, port, plain

    def __enter__(self) -> Self:
        self._cdp.__enter__()
        self._port.__enter__()
        return self

    def __exit__(self, *exc) -> None:
        self._port.__exit__(*exc)
        self._cdp.__exit__(*exc)

    def _of(self, worker: int):
        return self._port if self._plain(worker) else self._cdp

    def frame(self, worker: int) -> bytes | None:
        return self._of(worker).frame(worker)

    def wait(self, worker: int, after: int, timeout: float) -> tuple[bytes | None, int]:
        return self._of(worker).wait(worker, after, timeout)

    def input(self, worker: int, event: dict) -> dict | None:
        return self._of(worker).input(worker, event)

    def chooser(self, worker: int) -> str | None:
        return self._of(worker).chooser(worker)

    def forget_chooser(self, worker: int) -> None:
        self._of(worker).forget_chooser(worker)

    def field_error(self, worker: int) -> str:
        return self._of(worker).field_error(worker)

    def notice(self, worker: int) -> str:
        return self._port.notice(worker) if self._plain(worker) else ""


class Mouse:
    """page.mouse on a plain Worker: synthetic pointer and mouse events at a point of the
    tab's viewport (CSS pixels), replayed as the tile's are (tile.input)."""

    def __init__(self, page: PortPage):
        self._page = page
        self._x = self._y = 0.0

    def _send(self, event: dict):
        return self._page.worker.call("tile.input", tab=self._page.tab, event=event, by="apply")

    def move(self, x: float, y: float, steps: int = 1) -> None:
        self._x, self._y = x, y
        self._send({"type": "move", "x": x, "y": y})

    def down(self, button: str = "left", click_count: int = 1) -> None:
        self._send({"type": "down", "x": self._x, "y": self._y, "button": button, "clicks": click_count})

    def up(self, button: str = "left", click_count: int = 1) -> None:
        self._send({"type": "up", "x": self._x, "y": self._y, "button": button, "clicks": click_count})

    def click(self, x: float, y: float, delay: float | None = None, button: str = "left", click_count: int = 1) -> None:
        self.move(x, y)
        for count in range(1, click_count + 1):
            self.down(button, count)
            if delay:
                time.sleep(delay / 1000)
            self.up(button, count)

    def dblclick(self, x: float, y: float, delay: float | None = None, button: str = "left") -> None:
        self.click(x, y, delay=delay, button=button, click_count=2)

    def wheel(self, delta_x: float, delta_y: float) -> None:
        self._send({"type": "wheel", "x": self._x, "y": self._y, "dx": delta_x, "dy": delta_y})


class FileChooser:
    """The file input a page asked for (Playwright's FileChooser): set_files gives it files."""

    def __init__(self, page: PortPage, frame: int, mode: str):
        self._page, self._frame, self._mode = page, frame, mode

    @property
    def page(self) -> PortPage:
        return self._page

    def is_multiple(self) -> bool:
        return self._mode == "selectMultiple"

    def set_files(self, files, timeout: float | None = None, **_) -> None:
        if not self._page.worker.call("chooser.set", tab=self._page.tab, frame=self._frame, files=file_payloads(files)):
            raise PortError("NotFound", "FileChooser.set_files: the file input is gone")


class _Chosen:
    """expect_file_chooser's `as` value: `.value` is the FileChooser, after the block."""

    def __init__(self):
        self._value: FileChooser | None = None

    @property
    def value(self) -> FileChooser:
        if self._value is None:
            raise PortError("NotFound", "expect_file_chooser: no file chooser yet")
        return self._value


@contextmanager
def expect_file_chooser(page: PortPage, timeout: float):
    """Playwright's page.expect_file_chooser: what the block does must ask for a file within
    `timeout` ms (a click on a file input, its label, or a button whose script clicks one)."""
    page.worker.call("chooser.watch", tab=page.tab)
    chosen = _Chosen()
    deadline = time.monotonic() + timeout / 1000
    yield chosen
    while not (asked := page.worker.call("chooser.get", tab=page.tab)):
        if time.monotonic() > deadline:
            raise PortTimeoutError(f"Timeout {timeout:.0f}ms exceeded while waiting for event \"filechooser\"")
        time.sleep(POLL)
    chosen._value = FileChooser(page, asked["frame"], asked["mode"])
