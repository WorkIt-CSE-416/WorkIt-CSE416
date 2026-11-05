"""A plain Worker's own Chrome window, live, through macOS ScreenCaptureKit (KAN-635).

captureVisibleTab gives the tile about 2 frames a second (Chrome's quota per browser), and only
the debugger API, which a plain Worker never uses, gets past it. So Apply films the Worker's
window itself, by its window ID: `window_capture.swift`, built once with swiftc into
~/Library/Caches/apply/, streams that window of the Worker's Chrome (found by its PID) cropped
to the tab's viewport, at the screen's pixel scale, 30 frames a second, only when it changed.
Nothing is focused, raised or moved, and a covered window still streams.

It needs Screen Recording permission for the app Apply runs in (macOS gives it to the app at
the top of the process chain: Terminal, iTerm, Paradev, or Apply.app). Apply never asks for it
or changes it: without it, `allowed()` is False, the tile keeps the captureVisibleTab path, and
`PERMISSION` says where Lisul turns it on. `APPLY_TILE_CAPTURE=extension` forces that path.
"""

import hashlib
import json
import os
import shutil
import struct
import subprocess
import threading
from collections.abc import Callable
from functools import cache
from pathlib import Path

SOURCE = Path(__file__).with_name("window_capture.swift")
CACHE = Path.home() / "Library" / "Caches" / "apply"
FPS = 30
QUALITY = 0.85
SETTINGS = "System Settings > Privacy & Security > Screen & System Audio Recording"
OFF = 3  # the helper's exit code without permission


def mode() -> str:
    """"native" (ScreenCaptureKit when allowed, the default) or "extension" ($APPLY_TILE_CAPTURE)."""
    return "extension" if os.environ.get("APPLY_TILE_CAPTURE") == "extension" else "native"


@cache
def helper() -> Path | None:
    """The built helper, built now if its source changed; None without swiftc or if it won't build."""
    built = CACHE / f"window-capture-{hashlib.sha256(SOURCE.read_bytes()).hexdigest()[:12]}"
    if built.exists():
        return built
    swiftc = shutil.which("swiftc")
    if not swiftc:
        return None
    CACHE.mkdir(parents=True, exist_ok=True)
    partial = built.with_suffix(".partial")
    made = subprocess.run([swiftc, "-O", "-o", str(partial), str(SOURCE)], capture_output=True, text=True)
    if made.returncode != 0:
        return None
    partial.rename(built)
    return built


def allowed() -> bool:
    """Whether the app Apply runs in has Screen Recording permission (only looks, never asks)."""
    found = helper()
    return bool(found) and subprocess.run([str(found), "--check"], capture_output=True).returncode == 0


def running_app() -> str:
    """The app at the top of Apply's process chain, the one macOS asks permission for: "Terminal"."""
    pid, app = os.getpid(), ""
    for _ in range(30):
        found = subprocess.run(["ps", "-o", "ppid=,comm=", "-p", str(pid)], capture_output=True, text=True).stdout.strip()
        if not found:
            break
        parent, command = found.split(None, 1)
        if ".app/" in command:
            app = command.split(".app/")[0].rsplit("/", 1)[-1]
        pid = int(parent)
        if pid <= 1:
            break
    return app


def permission_note() -> str:
    """The tile's one line when the permission is missing."""
    app = running_app() or "the app you run Apply from"
    return f"Live tile off: turn on {app} in {SETTINGS}, then quit and reopen {app}."


def chrome_of(host_pid: int | None) -> int | None:
    """The Chrome that started a Worker's native messaging host (its parent): the Worker's PID."""
    if not host_pid:
        return None
    found = subprocess.run(["ps", "-o", "ppid=", "-p", str(host_pid)], capture_output=True, text=True).stdout.strip()
    return int(found) if found.isdigit() and int(found) > 1 else None


class WindowStream:
    """One Worker's window, streamed: `aim` at its shown window and viewport, `on_frame(jpeg)` per frame."""

    def __init__(self, pid: int, on_frame: Callable[[bytes], None], fps: int = FPS, quality: float = QUALITY):
        self.pid = pid
        self.status: dict = {}
        self._on_frame = on_frame
        self._aimed = ""
        self._process = subprocess.Popen([str(helper()), "--pid", str(pid), "--fps", str(fps), "--quality", str(quality)],
                                         stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        threading.Thread(target=self._frames, name=f"window-capture-{pid}", daemon=True).start()
        threading.Thread(target=self._said, name=f"window-capture-{pid}-status", daemon=True).start()

    @property
    def alive(self) -> bool:
        return self._process.poll() is None

    def aim(self, window: dict, viewport: dict) -> None:
        """Stream the window at `window` ({left, top, width, height}), cropped to `viewport` ({width, height})."""
        line = " ".join(str(v) for v in (window["left"], window["top"], window["width"], window["height"],
                                         viewport["width"], viewport["height"])) + "\n"
        if line == self._aimed or not self.alive:
            return
        self._aimed = line
        try:
            self._process.stdin.write(line.encode())
            self._process.stdin.flush()
        except OSError:
            pass

    def close(self) -> None:
        try:
            self._process.stdin.close()
            self._process.wait(2)
        except (OSError, subprocess.TimeoutExpired):
            self._process.kill()  # this helper only: Apply started it
            self._process.wait(2)

    def _frames(self) -> None:
        out = self._process.stdout
        while (head := out.read(4)) and len(head) == 4:
            frame = out.read(struct.unpack(">I", head)[0])
            if frame.startswith(b"\xff\xd8"):
                self._on_frame(frame)

    def _said(self) -> None:
        for line in self._process.stderr:
            try:
                self.status = json.loads(line)
            except ValueError:
                pass
