"""Plain Workers' Chromes: each a Chrome process Apply starts itself and stops by its PID.

A plain Worker's Chrome runs on its own profile, APPLY_PROFILES/plain-<k>, with no CDP, no
`--remote-debugging-port`, no `--enable-automation` and no `--headless`. Its only switches
beyond the profile are first-run, default-browser, crash-bubble, window placement, and
`--disable-backgrounding-occluded-windows` (Lisul, 2026-11-04), so a Worker covered by
Lisul's apps keeps painting. Workers sit on-screen, never minimized.

Two Chromes (policies.yaml `plain_chrome`):
- "chrome": branded Google Chrome. It ignores `--load-extension`, so the worker extension is
  installed once by hand in the seed profile (APPLY_PROFILES/plain-seed: `apply plain seed`),
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
from dataclasses import dataclass
from pathlib import Path

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
from apply.plain.bridge import Bridge, Connection
from apply.profile import load_policies

BRANDED = Path("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")
SEED = "plain-seed"
WINDOW = (1280, 800)
FLAGS = ("--no-first-run", "--no-default-browser-check", "--disable-backgrounding-occluded-windows",
         "--hide-crash-restore-bubble")
# Never passed to a plain Worker: each would make it an automated browser.
NEVER = ("--remote-debugging-port", "--remote-debugging-pipe", "--enable-automation", "--headless")
HELLO_WAIT = 30.0  # s from launch to the extension's hello
STOP_WAIT = 10.0  # s from SIGTERM to SIGKILL
WRAPPER = "apply-worker-host"


def chrome_for_testing() -> Path:
    """The newest Chrome for Testing Playwright installed."""
    root = Path(os.environ.get("PLAYWRIGHT_BROWSERS_PATH") or Path.home() / "Library/Caches/ms-playwright")
    found = sorted(root.glob("chromium-*/chrome-mac*/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"),
                   key=lambda p: int(p.parts[len(root.parts)].split("-")[1]))
    if not found:
        raise FileNotFoundError(f"no Chrome for Testing under {root}: run `uv run playwright install chromium`")
    return found[-1]


def chrome_kind() -> str:
    """"testing" or "chrome": $APPLY_PLAIN_CHROME, else policies.yaml's plain_chrome."""
    kind = os.environ.get("APPLY_PLAIN_CHROME") or load_policies().get("plain_chrome") or "chrome"
    if kind not in ("testing", "chrome"):
        raise ValueError(f"plain_chrome must be testing or chrome, not {kind!r}")
    return kind


@dataclass
class PlainWorker:
    """One running plain Worker: its Chrome process and its port."""

    worker: int  # 0-based, as WorkerBrowsers.open's
    profile: Path
    process: subprocess.Popen
    connection: Connection

    @property
    def pid(self) -> int:
        return self.process.pid


class PlainWorkers:
    def __init__(self, profiles: Path | None = None, kind: str | None = None, bridge: Bridge | None = None,
                 extension_dir: Path = extension.EXTENSION_DIR):
        """`profiles` defaults to $APPLY_PROFILES, else APPLY_HOME/profiles. `kind` is
        "testing" or "chrome" (default: chrome_kind())."""
        self.profiles = Path(profiles or os.environ.get("APPLY_PROFILES") or PROFILES)
        self.kind = kind or chrome_kind()
        self.bridge = bridge or Bridge()
        self.extension_dir = extension_dir
        self.running: dict[int, PlainWorker] = {}

    @property
    def seed(self) -> Path:
        return self.profiles / SEED

    def profile(self, worker: int) -> Path:
        return self.profiles / f"plain-{worker + 1}"

    def binary(self) -> Path:
        return chrome_for_testing() if self.kind == "testing" else BRANDED

    def arguments(self, worker: int) -> list[str]:
        """Worker `worker`'s Chrome command line."""
        x, y = 40 + 40 * worker, 40 + 30 * worker  # on-screen, staggered: never minimized or off-screen
        arguments = [str(self.binary()), f"--user-data-dir={self.profile(worker)}", *FLAGS,
                     f"--window-position={x},{y}", f"--window-size={WINDOW[0]},{WINDOW[1]}"]
        if self.kind == "testing":
            arguments.append(f"--load-extension={self.extension_dir}")
        arguments.append("about:blank")
        assert not any(a.startswith(NEVER) for a in arguments)
        return arguments

    def prepare(self) -> dict:
        """Write the worker extension's generated files (the engine bundle, Playwright's injected script)."""
        return extension.prepare(self.extension_dir / "vendor")

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
        if self.kind == "testing":
            self.prepare()
        self.bridge.start()
        self.install_host(worker)
        log = (self.profiles / f"plain-{worker + 1}.log").open("ab")
        with KEEPER.launching():
            process = subprocess.Popen(self.arguments(worker), stdin=subprocess.DEVNULL, stdout=log,
                                       stderr=subprocess.STDOUT, start_new_session=True)
        log.close()
        KEEPER.watch(process.pid)
        try:
            connection = self.bridge.wait_for(worker, HELLO_WAIT)
        except BaseException as error:
            _stop(process)
            KEEPER.forget(process.pid)
            if isinstance(error, TimeoutError) and self.kind == "chrome":
                raise TimeoutError(f"{error}: is the worker extension installed in {self.seed}? "
                                   "(`uv run apply plain seed`)") from None
            raise
        self.running[worker] = PlainWorker(worker, profile, process, connection)
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

    def seed_profile(self) -> list[str]:
        """Open branded Chrome on the seed profile at chrome://extensions for Lisul's one-time
        setup, with no extension loaded and nothing automated. Returns the steps to show him."""
        self.seed.mkdir(parents=True, exist_ok=True)
        _no_saved_passwords(self.seed)
        subprocess.Popen([str(BRANDED), f"--user-data-dir={self.seed}", *FLAGS, "chrome://extensions"],
                         stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                         start_new_session=True)
        return ["Turn on Developer mode (top right).",
                f"Load unpacked: choose {self.extension_dir}.",
                "Open the Apply Worker's Details and turn on Allow User Scripts.",
                "Quit that Chrome. Each plain Worker now starts as a copy of this profile."]


def _copy(source: Path, profile: Path) -> None:
    shutil.rmtree(profile, ignore_errors=True)
    shutil.copytree(source, profile, symlinks=True, ignore=NOT_COPIED)


def _stop(process: subprocess.Popen) -> None:
    if process.poll() is not None:
        return
    process.send_signal(signal.SIGTERM)
    try:
        process.wait(STOP_WAIT)
    except subprocess.TimeoutExpired:
        process.kill()
        process.wait(5)
