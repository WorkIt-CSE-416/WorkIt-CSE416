"""Plain Workers' Chromes: each a Chrome process Apply starts itself and stops by its PID.

A plain Worker's Chrome runs on its own profile, APPLY_PROFILES/plain-<k>, with no CDP, no
`--remote-debugging-port`, no `--enable-automation` and no `--headless`. Its only switches
beyond the profile are first-run, default-browser, crash-bubble, window placement, and
`--disable-backgrounding-occluded-windows` (Lisul, 2026-11-04), so a Worker covered by
Lisul's apps keeps painting, and `--restore-last-session` (KAN-718), so a quit keeps the job
sites' session cookies: their sign-ins. Workers sit on-screen, never minimized.

Two Chromes (policies.yaml `plain_chrome`):
- "chrome": branded Google Chrome. It ignores `--load-extension`, so the worker extension is
  installed once by the user's clicks in the seed profile (APPLY_PROFILES/plain-seed: `apply plain seed`),
  with Allow User Scripts on; each Worker profile starts as a copy of the seed.
- "testing": Chrome for Testing (the build Playwright installs), which still takes
  `--load-extension`: dev and tests. A seed is copied if there is one; else a fresh profile.

Each profile gets its own NativeMessagingHosts folder with the host's manifest, naming only
the worker extension, and a wrapper that tells the host its socket and Worker number. Lisul's
own Chrome folder is never touched.
"""

import json
import os
import shlex
import shutil
import signal
import subprocess
import sys
import time
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path

from apply.adapters import SetupError
from apply.browsers import (
    BUSY,
    NOT_COPIED,
    PROFILES,
    ProfileInUse,
    _no_saved_passwords,
    chrome_pid,
)
from apply.focus import KEEPER
from apply.plain import extension, host
from apply.plain.bridge import (
    OUT_OF_DATE,
    SETS_FROM,
    Bridge,
    Connection,
    PortError,
    Refused,
    features,
    socket_path,
)
from apply.profile import load_policies

BRANDED = Path("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")
SEED = "plain-seed"
# A normal, readable Chrome at 100% zoom, at the screen's top-left corner. The extension shrinks it
# to the main screen's visible area (ops/core.js: onScreen), so it is wholly on-screen.
WINDOW = (1280, 900)
# `--restore-last-session` (KAN-718): Chrome drops session cookies on a clean quit (Apply's SIGTERM, Cmd-Q, a macOS
# restart) unless it restores the last session, and a job site's sign-in is a session cookie. With
# `--no-startup-window` no tab of the last session opens again: only the cookies come back
# (docs/restart-recovery.md).
FLAGS = ("--no-first-run", "--no-default-browser-check", "--disable-backgrounding-occluded-windows",
         "--hide-crash-restore-bubble", "--restore-last-session")
# Never passed to a plain Worker: each would make it an automated browser.
NEVER = ("--remote-debugging-port", "--remote-debugging-pipe", "--enable-automation", "--headless")
HELLO_WAIT = 30.0  # s from launch to the extension's hello
STOP_WAIT = 10.0  # s from SIGTERM to SIGKILL
START_WAIT = 20.0  # s from `open` to the Chrome holding the profile
OPEN = "/usr/bin/open"
WRAPPER = "apply-worker-host"


def chrome_for_testing() -> Path:
    """The newest Chrome for Testing Playwright installed."""
    root = Path(os.environ.get("PLAYWRIGHT_BROWSERS_PATH") or Path.home() / "Library/Caches/ms-playwright")
    found = sorted(root.glob("chromium-*/chrome-mac*/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"),
                   key=lambda p: int(p.parts[len(root.parts)].split("-")[1]))
    if not found:
        raise FileNotFoundError(f"no Chrome for Testing under {root}: run `uv run playwright install chromium`")
    return found[-1]


def developer_mode(profile: Path) -> bool:
    """Whether a Worker profile's Chrome has Developer mode on (the seed's first step). Only then
    does chrome.runtime.reload() bring an unpacked extension back; without it Chrome disables it
    (`unsupportedDeveloperExtension`, Chrome for Testing 156)."""
    for name in ("Secure Preferences", "Preferences"):
        try:
            prefs = json.loads((profile / "Default" / name).read_text())
        except (OSError, ValueError):
            continue
        if prefs.get("extensions", {}).get("ui", {}).get("developer_mode") is True:
            return True
    return False


def chrome_kind() -> str:
    """"testing" or "chrome": $APPLY_PLAIN_CHROME, else policies.yaml's plain_chrome."""
    kind = os.environ.get("APPLY_PLAIN_CHROME") or load_policies().get("plain_chrome") or "chrome"
    if kind not in ("testing", "chrome"):
        raise ValueError(f"plain_chrome must be testing or chrome, not {kind!r}")
    return kind


class OutOfDate(SetupError):
    """A Worker's extension Apply can't guard pages with: the rehearsal says how to fix it, never a crash."""


@dataclass
class PlainWorker:
    """One running plain Worker: its Chrome process and its port."""

    worker: int  # 0-based, as WorkerBrowsers.open's
    profile: Path
    process: "Chrome"
    connection: Connection
    folder: Path | None = None  # the folder its extension is loaded from
    code: str = ""  # extension.code_hash(folder) when its extension last started

    @property
    def pid(self) -> int:
        return self.process.pid


class PlainWorkers:
    def __init__(self, profiles: Path | None = None, kind: str | None = None, bridge: Bridge | None = None,
                 extension_dir: Path | None = None, test_flags: tuple[str, ...] = ()):
        """`profiles` defaults to $APPLY_PROFILES, else APPLY_HOME/profiles. `kind` is
        "testing" or "chrome" (default: chrome_kind()). `test_flags`: tests' own switches for
        Chrome for Testing only, such as pointing the fakes' hosts at 127.0.0.1 (never Workers').
        `extension_dir`: a folder Chrome for Testing loads as it is (tests); by default every Worker
        loads the profiles folder's own copy of this checkout's extension (`copy`, KAN-645)."""
        self.profiles = Path(profiles or os.environ.get("APPLY_PROFILES") or PROFILES)
        self.kind = kind or chrome_kind()
        # One socket per profiles folder: a held rehearsal keeps its process up, and another
        # process on other profiles (APPLY_PROFILES) still drives its own Workers (KAN-634).
        self.bridge = bridge or Bridge(socket_path(self.profiles))
        self.bridge.reloadable = lambda worker: developer_mode(self.profile(worker))
        self.extension_dir = extension_dir or extension.EXTENSION_DIR  # the code the copy is made from
        self.direct = extension_dir is not None
        self._told_shared = False
        if test_flags and self.kind != "testing":
            raise ValueError("test_flags are for Chrome for Testing in tests only")
        self.test_flags = tuple(test_flags)
        self.running: dict[int, PlainWorker] = {}

    @property
    def seed(self) -> Path:
        return self.profiles / SEED

    @property
    def copy(self) -> Path:
        """This profiles folder's own copy of the worker extension, which its Workers load."""
        return self.profiles / extension.COPY

    def idle(self) -> bool:
        """Whether no Worker of this profiles folder runs: only then may its copy of the extension change."""
        return not self.running and not any(chrome_pid(p) for p in self.profiles.glob("plain-[0-9]*") if p.is_dir())

    def profile(self, worker: int) -> Path:
        return self.profiles / f"plain-{worker + 1}"

    def binary(self) -> Path:
        return chrome_for_testing() if self.kind == "testing" else BRANDED

    @staticmethod
    def position(worker: int) -> tuple[int, int]:
        """The top-left corner, staggered: never minimized or off-screen."""
        return 20 * worker, 25 + 20 * worker

    def arguments(self, worker: int) -> list[str]:
        """Worker `worker`'s Chrome command line."""
        x, y = self.position(worker)
        arguments = [str(self.binary()), f"--user-data-dir={self.profile(worker)}", *FLAGS,
                     f"--window-position={x},{y}", f"--window-size={WINDOW[0]},{WINDOW[1]}"]
        if self.kind == "testing":
            arguments.append(f"--load-extension={self.loaded_folder(worker)}")
            arguments += self.test_flags
        # No window at start: Chrome activates itself when it shows its first window, even under
        # `open -g`. The extension opens the Worker's window unfocused once it says hello.
        arguments.append("--no-startup-window")
        assert not any(a.startswith(NEVER) for a in arguments)
        return arguments

    def loaded_folder(self, worker: int | None = None) -> Path:
        """The folder Worker `worker`'s Chrome loads the worker extension from: for Chrome for Testing,
        the copy (or the tests' `extension_dir`); else the one Load unpacked registered in its profile (a
        copy of the seed's), the copy too once the seed is made by `apply plain seed`."""
        if self.kind == "testing":
            return self.extension_dir if self.direct else self.copy
        for profile in ([self.profile(worker)] if worker is not None else []) + [self.seed]:
            if folder := extension.loaded_folder(profile):
                return folder
        return self.copy

    def prepare(self, worker: int | None = None) -> dict:
        """Write the worker extension's generated files (the engine bundle, Playwright's injected script)
        into this checkout's extension folder, and the same files as a write-once vendor set into the
        folder Worker `worker` loads, which the bridge names in each welcome (KAN-645)."""
        identity = extension.engine_identity()
        files = extension.generated(identity)
        if self.direct:
            extension.prepare(self.extension_dir / "vendor")
        else:  # replaced only while none of this folder's Workers runs: a running one's code never changes
            extension.install(self.copy, files, replace=self.idle(), source=self.extension_dir)
        loaded = self.loaded_folder(worker).resolve()
        roots = {extension.vendor_set(loaded, files)}  # write-once: safe beside any Worker on that folder
        if loaded != self.copy.resolve() and not self.direct and not self._told_shared:
            self._told_shared = True
            print(f"Plain Workers load the worker extension from {loaded}, which changes under running Workers "
                  f"when it is updated. Run `uv run apply plain seed` again once no Worker runs: new Workers then "
                  f"load this folder's own copy ({self.copy}).", file=sys.stderr)
        self.bridge.folder = loaded
        self.bridge.vendor = roots.pop()  # one id: the same files
        self.bridge._engine = identity
        return identity

    def refresh(self, worker: int, others: bool = False) -> list[str]:
        """Before a new posting on running Worker `worker`: a new vendor set if the Fill engine on disk
        changed (vendor.use), and a reload of its extension if its code on disk changed since it started,
        unless `others` (another posting is open in it: a reload would drop its guards). Says what it did."""
        running = self.running.get(worker)
        if not running or running.connection.closed.is_set():
            return []
        said, before = [], self.bridge.vendor
        self.prepare(worker)
        alone = not others and set(self.running) == {worker}  # no other form or Worker loads its copy now
        folder = running.folder
        if folder and folder.resolve() == self.copy.resolve() and not self.direct:
            code = extension.code_hash(self.extension_dir)  # this Apply's own code, which the copy is made from
            if code != running.code and alone:
                extension.install(self.copy, extension.generated(self.bridge.engine), replace=True,
                                  source=self.extension_dir)
        elif folder:
            code = extension.code_hash(folder)  # a shared folder: what its code on disk is now
        if folder and code != running.code:
            if not alone:
                said.append("its worker extension's code changed on disk; it reloads once no other form is open in it")
            else:
                try:
                    running.connection, running.code = self.bridge.reload(worker), code  # extension.reload (KAN-643)
                    said.append("reloaded its worker extension: its code changed on disk")
                except (PortError, Refused, TimeoutError) as error:  # one that can't reload itself, or no hello
                    running.code = code
                    said.append(f"its worker extension's code changed on disk but didn't reload ({error})")
                return said
        if self.bridge.vendor != before and running.connection.vendor:
            running.connection.call("vendor.use", root=self.bridge.vendor)
            running.connection.vendor = self.bridge.vendor
            said.append(f"the Fill engine changed on disk: its pages load {self.bridge.engine['version']} now")
        return said

    def install_host(self, worker: int) -> Path:
        """Write the host's wrapper and manifest into Worker `worker`'s profile. Returns the manifest."""
        hosts = self.profile(worker) / "NativeMessagingHosts"
        hosts.mkdir(parents=True, exist_ok=True)
        wrapper = hosts / WRAPPER
        wrapper.write_text(f"#!/bin/sh\nexec {shlex.quote(sys.executable)} -I {shlex.quote(host.__file__)} "
                           f"--socket {shlex.quote(str(self.bridge.path))} --worker {worker} \"$@\"\n")
        wrapper.chmod(0o700)
        manifest = hosts / f"{extension.HOST_NAME}.json"
        manifest.write_text(json.dumps({
            "name": extension.HOST_NAME,
            "description": "Relays Apply's plain Worker extension to the Apply process on this Mac",
            "path": str(wrapper),
            "type": "stdio",
            "allowed_origins": [extension.EXTENSION_ORIGIN],
        }, indent=1) + "\n")
        return manifest

    def launch(self, worker: int = 0) -> PlainWorker:
        """Start Worker `worker`'s Chrome and wait for its hello."""
        if worker in self.running:
            return self.running[worker]
        profile = self.profile(worker)
        if chrome_pid(profile):
            raise ProfileInUse(f"{profile.name} {BUSY}")
        if self.kind == "chrome" and not self.seed.exists():
            raise FileNotFoundError(f"no seed profile at {self.seed}: run `uv run apply plain seed` once")
        if not profile.exists() and self.seed.exists():
            _copy(self.seed, profile)
        profile.mkdir(parents=True, exist_ok=True)
        _no_saved_passwords(profile)
        (profile / "DevToolsActivePort").unlink(missing_ok=True)
        # Chrome keeps an extension's service worker script across restarts, so an updated worker
        # extension would run its old code: drop the stored service workers (sites' re-register).
        shutil.rmtree(profile / "Default" / "Service Worker", ignore_errors=True)
        self.prepare(worker)  # into the folder its extension loads from too: its own vendor set
        self.bridge.start()
        self.install_host(worker)
        with KEEPER.launching():
            process = start_in_background(self.arguments(worker), profile, self.profiles / f"plain-{worker + 1}.log")
        KEEPER.watch(process.pid)
        try:
            connection = self.bridge.wait_for(worker, HELLO_WAIT)
            folder = self.loaded_folder(worker)
            if features(connection.hello) < SETS_FROM and not extension.guards_match(folder):
                # Code from before vendor sets, in a folder whose guards are another Apply's: guarding a page
                # would fail. The bridge reloaded it already if it could (KAN-643); it can't fill safely.
                raise OutOfDate(f"Browser {worker + 1}: {OUT_OF_DATE}. Its worker extension, in {folder}, is from "
                                f"before vendor sets and its guard files are another Apply's. Run `uv run apply "
                                f"plain seed` once no Worker runs, so Workers load this folder's own copy ({self.copy})")
            x, y = self.position(worker)
            try:
                connection.call("windows.create", left=x, top=y, width=WINDOW[0], height=WINDOW[1])
            except PortError:  # a seed's extension from before windows.create: a window all the same
                connection.call("tabs.create")
        except BaseException as error:
            _stop(process)
            KEEPER.forget(process.pid)
            if isinstance(error, TimeoutError) and self.kind == "chrome":
                raise TimeoutError(f"{error}: is the worker extension installed in {self.seed}? "
                                   "(`uv run apply plain seed`)") from None
            raise
        code = extension.code_hash(folder)
        self.running[worker] = PlainWorker(worker, profile, process, connection, folder, code)
        return self.running[worker]

    def stop(self, worker: int) -> None:
        """Stop Worker `worker`'s Chrome by its PID: the one this process started, no other."""
        running = self.running.pop(worker, None)
        if running:
            KEEPER.forget(running.pid)
            running.connection.close()
            _stop(running.process)

    def stop_all(self) -> None:
        for worker in list(self.running):
            self.stop(worker)
        self.bridge.stop()

    def show(self, worker: int) -> bool:
        """Bring Worker `worker`'s Chrome window to the front, as Lisul asked in the Apply window."""
        running = self.running.get(worker)
        return bool(running) and KEEPER.bring(running.pid)

    @contextmanager
    def open(self, url: str, worker: int = 0):
        """Worker `worker`'s page at `url`, as WorkerBrowsers.open gives one; the Worker stops after."""
        from apply.plain.page import PortPage

        running = self.launch(worker)
        try:
            page = PortPage.first(running.connection)
            page.goto(url)
            yield page
        finally:
            self.stop(worker)


class Chrome:
    """A Chrome that `open` started: its own PID (read from the profile's SingletonLock), not open's."""

    def __init__(self, pid: int):
        self.pid = pid

    def poll(self) -> int | None:
        try:
            os.kill(self.pid, 0)
        except ProcessLookupError:
            return 0
        return None

    def send_signal(self, number: int) -> None:
        try:
            os.kill(self.pid, number)
        except ProcessLookupError:
            pass

    def kill(self) -> None:
        self.send_signal(signal.SIGKILL)

    def wait(self, timeout: float | None = None) -> int:
        deadline = time.monotonic() + (timeout if timeout is not None else 1e9)
        while self.poll() is None:
            if time.monotonic() > deadline:
                raise subprocess.TimeoutExpired(f"chrome {self.pid}", timeout)
            time.sleep(0.1)
        return 0


def start_in_background(arguments: list[str], profile: Path, log: Path) -> Chrome:
    """Start Chrome (`arguments`, the binary first) through `open -g -n`: a new instance that is
    never activated, so it never takes Lisul's focus. Running the binary itself brings it forward."""
    app = Path(arguments[0]).parents[2]  # …/X.app/Contents/MacOS/X
    subprocess.run([OPEN, "-g", "-n", "-a", str(app), "--stdout", str(log), "--stderr", str(log),
                    "--args", *arguments[1:]], check=True, stdin=subprocess.DEVNULL,
                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    deadline = time.monotonic() + START_WAIT
    while (pid := chrome_pid(profile)) is None:
        if time.monotonic() > deadline:
            raise TimeoutError(f"no Chrome took {profile.name} within {START_WAIT:.0f} s of `open`")
        time.sleep(0.1)
    return Chrome(pid)


def _copy(source: Path, profile: Path) -> None:
    shutil.rmtree(profile, ignore_errors=True)
    shutil.copytree(source, profile, symlinks=True, ignore=NOT_COPIED)


def _stop(process: Chrome) -> None:
    if process.poll() is not None:
        return
    process.send_signal(signal.SIGTERM)
    try:
        process.wait(STOP_WAIT)
    except subprocess.TimeoutExpired:
        process.kill()
        process.wait(5)
