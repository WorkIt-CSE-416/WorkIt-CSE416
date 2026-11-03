"""Keeps Apply's own Chromes from taking Lisul's focus.

On macOS a Chrome makes itself the front app as it starts and whenever it
opens a tab or pop-up (seen live: Playwright's new page, window.open, a link
with target=_blank). A run starts a Chrome per Worker, and the Apply window,
while Lisul works in another app, so each one pulled him away from it.

The FocusKeeper hands the focus back to the app he was in whenever one of
Apply's Chromes comes to the front with no click of his just before it. A
Chrome he clicked (its window, or Apply in the Dock) is his, and it stays in
front. Only a click since his app was last seen in front counts: one in his
app itself (the Apply window's tiles, say) is no click on the Chrome that
came forward a moment after. Switching to one with Cmd-Tab alone is not
told apart from Chrome's own doing, so it is handed back too: click it instead.
"""

import ctypes
import subprocess
import threading
import time
from collections.abc import Callable
from contextlib import contextmanager

CLICKED = 1.0  # s: an app that came forward this soon after a click came forward by it
EVERY = 0.2  # s between looks at the front app
# CoreGraphics' event source state of the hardware, and its mouse-down event types.
HID_STATE = 1
MOUSE_DOWNS = (1, 3, 25)  # left, right, other


def front_pid() -> int | None:
    """The pid of the front app."""
    asn = subprocess.run(["lsappinfo", "front"], capture_output=True, text=True, check=False).stdout.strip()
    found = subprocess.run(["lsappinfo", "info", "-only", "pid", asn], capture_output=True, text=True,
                           check=False).stdout.strip()
    try:
        return int(found.rsplit("=", 1)[1])
    except (IndexError, ValueError):
        return None


def since_click() -> float:
    """Seconds since Lisul last pressed a mouse button, anywhere."""
    try:
        graphics = ctypes.CDLL("/System/Library/Frameworks/CoreGraphics.framework/CoreGraphics")
    except OSError:
        return float("inf")
    since = graphics.CGEventSourceSecondsSinceLastEventType
    since.restype, since.argtypes = ctypes.c_double, [ctypes.c_int, ctypes.c_uint32]
    return min(since(HID_STATE, kind) for kind in MOUSE_DOWNS)


def bring_forward(pid: int) -> bool:
    """Make the app with `pid` the front app again."""
    script = f'tell application "System Events" to set frontmost of (first process whose unix id is {pid}) to true'
    return subprocess.run(["osascript", "-e", script], capture_output=True, text=True, check=False).returncode == 0


class FocusKeeper:
    def __init__(self, front: Callable[[], int | None] = front_pid, clicked: Callable[[], float] = since_click,
                 give: Callable[[int], bool] = bring_forward, now: Callable[[], float] = time.monotonic,
                 every: float | None = EVERY):
        """Looks at the front app every `every` seconds once it has something
        to watch; with None, only when `turn` is called."""
        self._front, self._clicked, self._give, self._now, self._every = front, clicked, give, now, every
        self._lock = threading.Lock()
        self._watched: dict[int, float] = {}  # pid -> when to stop watching it (inf: till forgotten)
        self._launching = 0
        self._yours: int | None = None
        self._seen = float("-inf")  # when his app was last seen in front
        self._thread: threading.Thread | None = None

    @contextmanager
    def launching(self):
        """While one of Apply's Chromes starts and its pid is not yet known, any
        app that comes forward with no click is taken to be it."""
        self._start()
        with self._lock:
            self._launching += 1
        try:
            yield
        finally:
            with self._lock:
                self._launching -= 1

    def watch(self, pid: int, seconds: float | None = None) -> None:
        """Hand the focus back whenever `pid` takes it unclicked: till `forget`,
        or for `seconds` only."""
        self._start()
        with self._lock:
            self._watched[pid] = float("inf") if seconds is None else self._now() + seconds

    def forget(self, pid: int) -> None:
        with self._lock:
            self._watched.pop(pid, None)

    def bring(self, pid: int) -> bool:
        """Bring `pid` to the front for Lisul, who asked for it (Open in Chrome
        in the Apply window): it is his app now, however long it takes to come."""
        with self._lock:
            self._yours = pid
        return self._give(pid)

    def turn(self) -> None:
        """One look at the front app."""
        front, now = self._front(), self._now()
        if front is not None and front == self._yours:
            self._seen = now
        if front is None or front == self._yours:
            return
        with self._lock:
            self._watched = {pid: until for pid, until in self._watched.items() if until > now}
            ours = front in self._watched or self._launching > 0
        clicked = self._clicked() < min(CLICKED, now - self._seen)  # on this app, not in his before it came
        if ours and self._yours is not None and not clicked and self._give(self._yours):
            return
        self._yours, self._seen = front, now  # Lisul's own choice, or an app that has gone: his

    def _start(self) -> None:
        with self._lock:
            if self._thread is not None:
                return
            self._yours, self._seen = self._front(), self._now()
            self._thread = threading.Thread(target=self._run, daemon=True, name="focus-keeper")
            if self._every is not None:
                self._thread.start()

    def _run(self) -> None:
        while True:
            try:
                self.turn()
            except Exception:
                pass  # a look that failed: the next one tries again
            time.sleep(self._every)


KEEPER = FocusKeeper()
