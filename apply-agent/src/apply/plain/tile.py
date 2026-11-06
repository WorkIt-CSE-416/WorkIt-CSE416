"""The live tile and Fix from the window on plain Workers (S3, KAN-609).

PortFrames is the Apply window's frame source (dashboard.Frames) for plain Workers, as
CdpFrames is for CDP ones. With Screen Recording permission, Apply films each Worker's own
window with ScreenCaptureKit (apply.plain.window_capture, KAN-635): 30 frames a second at the
screen's pixel scale, the extension only saying which window and tab are shown (`tile.shown`).
Without it, each Worker's extension streams its shown tab as `tile.frame` events
(captureVisibleTab, about 2 frames a second, only when the picture changed), and the tile says
how to turn the permission on (`notice`). A filmed tile never stays blank (KAN-643): with no
filmed frame within FIRST_FRAME s of `tile.start` (an extension too old to send `tile.shown`, a
helper never aimed), or none for STALLED s after the extension said its picture moved, Apply
stops filming it and the extension's frames show. A tile whose extension is older than Apply
says so (bridge.OUT_OF_DATE). A tile's clicks, keys, wheel, pastes, <select> picks and files go back as `tile.input`, replayed
in the page as synthetic DOM events. No CDP anywhere.

Mouse is PortPage.mouse, and expect_file_chooser is PortPage.expect_file_chooser: a click
with no user activation opens no picker, so the extension marks the file input the page
asked for, and FileChooser.set_files gives it files through DataTransfer.
"""

import base64
import sys
import threading
import time
from collections.abc import Callable
from contextlib import contextmanager
from pathlib import Path
from typing import Self

from apply import stuck
from apply.dashboard import ERRORS_EVERY, jpeg_size
from apply.plain import window_capture
from apply.plain.bridge import OUT_OF_DATE, Connection, PortError, PortTimeoutError
from apply.plain.page import POLL, PortPage, file_payloads

FOREIGN = "This tile's browser connection isn't from this Worker's own Chrome, so the tile shows nothing from it."
INPUT_WAIT = 5.0  # s a tile event may take on the page before the window gives up on it
WATCH_EVERY = 0.5  # s between looks for Workers that connected or went away
FIRST_FRAME = 3.0  # s a filmed tile may wait for its first frame before the extension's frames show
STALLED = 20.0  # s a filmed tile may go without a frame after a `tile.shown`
SETTLE = 0.25  # s around a switch of the filmed window's tab whose frames go to neither tab's tile (KAN-717)
KEPT = 1.0  # s of each tab's filmed frames kept, so a switch can take back the ones that showed the next tab


class PortFrames:
    """Each plain Worker's shown tab, streamed to its tile, and its tile's input replayed on it.
    `connection(k)` is Worker k's bridge Connection, None while it has none (launcher:
    `lambda k: workers.bridge.connection(k)`). Implements dashboard.Frames."""

    def __init__(self, workers: int, connection: Callable[[int], Connection | None], capture: str | None = None,
                 chrome: Callable[[int], int | None] | None = None, **settings):
        """`capture`: "native" (ScreenCaptureKit when allowed, else the extension's frames) or
        "extension" (default: window_capture.mode(), $APPLY_TILE_CAPTURE). `chrome(k)` is the PID of the
        Chrome that has Worker k's profile open (launcher: browsers.chrome_pid): a Connection from any
        other Chrome, or whose Chrome can't be told (either PID unknown), shows nothing on Worker k's tile and takes
        none of its input until it can (KAN-717). Without `chrome` (tests), no Connection is checked."""
        self._workers = workers
        self._connection = connection
        self._chrome = chrome or (lambda worker: None)
        self._strict = chrome is not None
        self._foreign: set[int] = set()  # Workers whose Connection is another Chrome's
        self._capture = capture or window_capture.mode()
        self._allowed: bool | None = None  # Screen Recording permission, looked at once
        self._streams: dict[int, window_capture.WindowStream] = {}  # worker -> its window, filmed
        self._notes: dict[int, str] = {}  # worker -> the tile's line about its capture
        self._filmed: dict[int, dict[str, float]] = {}  # worker -> when filming began, its last frame, last tile.shown
        self._settings = settings  # tile.start's: interval ms, quality, maxWidth, maxHeight
        self._frames: dict[int, tuple[bytes, int]] = {}  # worker -> (latest frame, its number)
        self._tabs: dict[int, int] = {}  # worker -> the tab its latest frame shows
        # (worker, tab) -> that tab's own frames, [(when, frame)], newest last, and its number: a tile showing one
        # of several forms in a Worker (`--into`) shows that form's tab only, never the one shown now (KAN-717).
        self._by_tab: dict[tuple[int, int], tuple[list[tuple[float, bytes]], int]] = {}
        self._switched: dict[int, float] = {}  # worker -> when its filmed window last showed another tab
        self._seq: dict[int, int] = {}  # worker -> the number of its newest frame, of any tab
        # A form's own pop-ups and the tabs its page opens show on its tile (KAN-717): (worker, tab) -> the tab that
        # opened it (the extension's tab.created and popup.blocked), when each tab last showed, and the closed ones.
        self._openers: dict[tuple[int, int], int] = {}
        self._shown_at: dict[tuple[int, int], float] = {}
        self._gone: set[tuple[int, int]] = set()
        self._watched: dict[int, Connection] = {}
        # (worker, tab) -> {mode, tab, frame} of the file input that tab's page asked for: a file picked on a tile goes
        # only to its own tab's (KAN-717), newest last
        self._choosers: dict[tuple[int, int | None], dict] = {}
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

    def _family(self, worker: int, tab: int) -> list[int]:
        """`tab` and the open tabs its page opened, and theirs: one form's tabs. A tab another form opened isn't one."""
        def opened_by_tab(other: int) -> bool:
            for _ in range(20):  # a chain of pop-ups; never a loop
                other = self._openers.get((worker, other))
                if other is None:
                    return False
                if other == tab:
                    return True
            return False
        return [tab] + [other for (owner, other) in list(self._openers)
                        if owner == worker and (worker, other) not in self._gone and opened_by_tab(other)]

    def _current(self, worker: int, tab: int) -> int:
        """The tab of `tab`'s form a tile shows and presses: of the form's tabs with a frame, the one shown last."""
        framed = [other for other in self._family(worker, tab) if self._by_tab.get((worker, other), ([], 0))[0]]
        return max(framed, key=lambda other: self._shown_at.get((worker, other), 0.0), default=tab)

    def _latest(self, worker: int, tab: int | None) -> tuple[bytes | None, int]:
        if tab is None:
            return self._frames.get(worker, (None, 0))
        kept, number = self._by_tab.get((worker, self._current(worker, tab)), ([], 0))
        return (kept[-1][1] if kept else None), number

    def frame(self, worker: int, tab: int | None = None) -> bytes | None:
        """Worker `worker`'s latest frame; with `tab`, the latest that showed that form's tab or one of its pop-ups
        (None before one did)."""
        return self._latest(worker, tab)[0]

    def wait(self, worker: int, after: int, timeout: float, tab: int | None = None) -> tuple[bytes | None, int]:
        with self._changed:
            self._changed.wait_for(lambda: self._latest(worker, tab)[1] > after, timeout)
            return self._latest(worker, tab)

    def input(self, worker: int, event: dict, tab: int | None = None) -> dict | None:
        """Replay a tile event on `tab` (the tile's own form), else the tab Worker `worker` shows now."""
        connection = self._watched.get(worker)
        if connection is None or connection.closed.is_set() or worker in self._foreign:
            return None
        own, tab = tab, self._tabs.get(worker) if tab is None else self._current(worker, tab)
        try:
            if event["type"] == "files":
                return self._give(connection, worker, own, event.get("paths") or [])
            size = jpeg_size(self.frame(worker, tab) or b"") or (None, None)
            reply = connection.call("tile.input", timeout=INPUT_WAIT, tab=tab, event=event,
                                    width=size[0], height=size[1])
        except (PortError, OSError):
            return None  # the page went away under it
        if isinstance(reply, dict) and reply.get("chooser"):
            asked = reply.get("tab", tab)
            self._choosers.pop((worker, asked), None)
            self._choosers[(worker, asked)] = {"mode": reply["chooser"], "tab": asked, "frame": reply.get("frame", 0)}
            return None
        return reply if isinstance(reply, dict) and ("menu" in reply or "text" in reply) else None

    def _asked(self, worker: int, tab: int | None) -> tuple[int, int | None] | None:
        """The key of the newest file input that `tab`'s form asked for, in its tab or a pop-up (None: that any tab of
        Worker `worker` asked for)."""
        own = None if tab is None else self._family(worker, tab)
        return next((key for key in reversed(list(self._choosers)) if key[0] == worker and (own is None or key[1] in own)), None)

    def chooser(self, worker: int, tab: int | None = None) -> str | None:
        """Whether `tab`'s page (None: any of Worker `worker`'s) asked for a file, and how many."""
        key = self._asked(worker, tab)
        return self._choosers[key]["mode"] if key else None

    def forget_chooser(self, worker: int, tab: int | None = None) -> None:
        """The file its page asked for was given another way (Claude set the input itself)."""
        if key := self._asked(worker, tab):
            self._choosers.pop(key, None)

    def field_error(self, worker: int) -> str:
        return self._errors.get(worker, ("", 0.0))[0]

    # --- the frames thread

    def _give(self, connection: Connection, worker: int, tab: int | None, paths: list[str]) -> None:
        """Answer the file input that `tab` (the tile's own; None: Worker `worker`'s only tile) asked for with
        `paths` (none: let it go). Never another tab's: his file goes only to the form whose tile he picked it on."""
        key = self._asked(worker, tab)
        chooser = self._choosers.pop(key, None) if key else None
        if chooser:
            connection.call("chooser.set", timeout=60, tab=chooser["tab"], frame=chooser["frame"],
                            files=file_payloads([Path(p) for p in paths]))

    def _keep(self, worker: int, message: dict) -> None:
        if worker not in self._streams:  # a filmed tile's frames come from its window, not the extension
            self._store(worker, base64.b64decode(message.get("data") or ""), message.get("tab"))

    def _store(self, worker: int, frame: bytes, tab: int | None = None, own: bool = True) -> None:
        """Keep `frame` as Worker `worker`'s latest, and as `tab`'s own unless `own` is False (it may show another)."""
        if not frame.startswith(b"\xff\xd8"):
            return
        now = time.monotonic()
        with self._changed:
            number = self._seq[worker] = self._seq.get(worker, 0) + 1  # one count for all tabs: a tile may change tab
            self._frames[worker] = (frame, number)
            if tab is not None:
                self._tabs[worker] = tab
                if own:
                    kept = self._by_tab.get((worker, tab), ([], 0))[0]
                    kept = [(when, old) for when, old in kept if now - when < KEPT][-30:] + [(now, frame)]
                    self._by_tab[(worker, tab)] = (kept, number)
                    self._shown_at[(worker, tab)] = now
            self._changed.notify_all()

    def _aim(self, worker: int, message: dict) -> None:
        """The extension's `tile.shown`: film that window, cropped to that tab's viewport, if its title is the tab's."""
        tab, before = message.get("tab", self._tabs.get(worker)), self._tabs.get(worker)
        if before is not None and tab != before and worker in self._streams:
            self._switch(worker, before)
        self._tabs[worker] = tab
        if worker in self._filmed:
            self._filmed[worker]["shown"] = time.monotonic()
        stream, window = self._streams.get(worker), message.get("window") or {}
        if stream and window.get("state") != "minimized" and message.get("viewport", {}).get("width"):
            stream.aim(window, message["viewport"], message.get("title") or "")

    def _switch(self, worker: int, before: int | None) -> None:
        """The filmed window shows another tab now. Its frames of the last SETTLE s may show the new tab
        already (`tile.shown` comes a moment after the switch): they leave the old tab's tile."""
        now = time.monotonic()
        with self._changed:
            self._switched[worker] = now
            if before is not None and (worker, before) in self._by_tab:
                kept = self._by_tab[(worker, before)][0]
                number = self._seq[worker] = self._seq.get(worker, 0) + 1
                self._by_tab[(worker, before)] = ([(when, f) for when, f in kept if when < now - SETTLE] or kept[:0],
                                                  number)
            self._changed.notify_all()

    def _opened(self, worker: int, tab: int | None, opener: int | None) -> None:
        """Tab `tab` was opened by tab `opener`'s page (tab.created, popup.blocked): it is that form's."""
        if tab is not None and opener is not None and tab != opener:
            with self._changed:
                self._openers[(worker, tab)] = opener
                self._changed.notify_all()

    def _closed(self, worker: int, tab: int | None) -> None:
        with self._changed:
            self._gone.add((worker, tab))
            self._changed.notify_all()

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
        if pid is None or (self._strict and pid != self._chrome(worker)):
            return False
        self._filmed[worker] = {"began": time.monotonic(), "frame": 0.0, "shown": 0.0}
        self._streams[worker] = window_capture.WindowStream(pid, lambda frame, worker=worker: self._filmed_frame(worker, frame))
        self._notes.pop(worker, None)
        return True

    def _filmed_frame(self, worker: int, frame: bytes) -> None:
        if times := self._filmed.get(worker):
            times["frame"] = time.monotonic()
        settled = time.monotonic() - self._switched.get(worker, float("-inf")) >= SETTLE
        self._store(worker, frame, self._tabs.get(worker), own=settled)

    def _blank(self, worker: int, stream: window_capture.WindowStream) -> str:
        """Why Worker `worker`'s filmed tile shows nothing and should take the extension's frames, or ""."""
        if not stream.alive:
            return "the helper ended"
        if "mismatch" in stream.status:  # no window of its Chrome shows its tab: never film another (KAN-717)
            return f"helper: {stream.status['mismatch']}"
        times, now = self._filmed.get(worker) or {}, time.monotonic()
        if not times.get("frame") and now - times.get("began", now) > FIRST_FRAME:
            return (f"no frame in {FIRST_FRAME:.0f} s (" + ("no tile.shown from the extension" if not times.get("shown")
                                                            else f"helper: {stream.status or 'never aimed'}") + ")")
        if times.get("shown", 0) > times.get("frame", 0) and now - times["shown"] > STALLED:
            return f"no frame for {STALLED:.0f} s after the page moved (helper: {stream.status})"
        return ""

    def _unfilm(self, worker: int) -> None:
        self._filmed.pop(worker, None)
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
        if connection is not None and connection is self._watched.get(worker) and worker in self._foreign \
                and not self._foreign_to(worker, connection):
            self._watched.pop(worker)  # its Chrome can be told now, and it is this Worker's: set it up below
        if connection is self._watched.get(worker):
            if connection is not None and (stream := self._streams.get(worker)) and (why := self._blank(worker, stream)):
                self._unfilm(worker)  # the extension's frames from now on
                if why != "the helper ended":
                    print(f"Plain Worker {worker + 1}'s tile: {why}; showing the extension's frames.", file=sys.stderr)
                connection.call("tile.start", timeout=5, **{**self._settings, "native": False})
            return
        self._unfilm(worker)
        self._notes.pop(worker, None)
        self._watched.pop(worker, None)
        self._choosers = {key: asked for key, asked in self._choosers.items() if key[0] != worker}
        self._foreign.discard(worker)
        self._pages = {key: page for key, page in self._pages.items() if key[0] != worker}
        self._openers = {key: opener for key, opener in self._openers.items() if key[0] != worker}
        self._gone = {key for key in self._gone if key[0] != worker}
        if connection is None:
            return
        if self._foreign_to(worker, connection):
            self._foreign.add(worker)
            self._notes[worker] = FOREIGN
            print(f"Plain Worker {worker + 1}'s tile: {FOREIGN}", file=sys.stderr)
            self._watched[worker] = connection  # looked at again each turn: its tile shows none of its frames till then
            return
        connection.on("tile.frame", lambda message, worker=worker: self._keep(worker, message))
        connection.on("tab.created", lambda message, worker=worker: self._opened(worker, message.get("tab"),
                                                                                 message.get("opener")))
        connection.on("popup.blocked", lambda message, worker=worker: self._opened(worker, message.get("popup"),
                                                                                   message.get("tab")))
        connection.on("tab.removed", lambda message, worker=worker: self._closed(worker, message.get("tab")))
        connection.on("tile.shown", lambda message, worker=worker: self._aim(worker, message))
        native = self._film(worker, connection)
        if getattr(connection, "stale", False):
            self._notes[worker] = OUT_OF_DATE  # bridge logged it; the tile still shows the frames it can
        connection.call("tile.start", timeout=5, **{**self._settings, "native": native})
        self._watched[worker] = connection

    def _foreign_to(self, worker: int, connection: Connection) -> bool:
        """Whether `connection` may not be Worker `worker`'s: its Chrome (the host's parent) isn't the one with the
        Worker's profile open, or either PID can't be told. Fails closed (KAN-717)."""
        if not self._strict:
            return False
        expected = self._chrome(worker)
        found = window_capture.chrome_of(connection.relay.get("host_pid")) if expected else None
        return not (expected and found and found == expected)

    def _read_errors(self, worker: int) -> None:
        """The field error Worker `worker`'s shown page shows, every ERRORS_EVERY s (apply.stuck)."""
        connection, tab = self._watched.get(worker), self._tabs.get(worker)
        if connection is None or tab is None or worker in self._foreign:
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

    def frame(self, worker: int, tab: int | None = None) -> bytes | None:
        return self._port.frame(worker, tab) if self._plain(worker) else self._cdp.frame(worker)

    def wait(self, worker: int, after: int, timeout: float, tab: int | None = None) -> tuple[bytes | None, int]:
        return self._port.wait(worker, after, timeout, tab) if self._plain(worker) else self._cdp.wait(worker, after, timeout)

    def input(self, worker: int, event: dict, tab: int | None = None) -> dict | None:
        return self._port.input(worker, event, tab) if self._plain(worker) else self._cdp.input(worker, event)

    def chooser(self, worker: int, tab: int | None = None) -> str | None:
        return self._port.chooser(worker, tab) if self._plain(worker) else self._cdp.chooser(worker)

    def forget_chooser(self, worker: int, tab: int | None = None) -> None:
        self._port.forget_chooser(worker, tab) if self._plain(worker) else self._cdp.forget_chooser(worker)

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
