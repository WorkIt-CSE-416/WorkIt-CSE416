"""`apply plain seed`: the guided setup of the plain seed profile (KAN-677).

Branded Chrome takes the worker extension only by the user's own clicks: Developer mode, Load
unpacked, Allow User Scripts. This wizard opens the page, puts the folder's path on the clipboard,
shows the folder in Finder, and then watches the seed's preference files until each step is saved.
It only reads those files, and it never clicks a chrome:// page.

Chrome writes a change to disk about 10 s after the click (measured on Chrome for Testing), and only
a clean exit writes the rest: SIGTERM saves, SIGKILL loses it (measured on both Chromes). So Apply
quits the seed's Chrome with SIGTERM, never SIGKILL, reads the files again, and says "done" only
after a real Worker, copied from the seed, says hello with user scripts on.
"""

import os
import shutil
import signal
import subprocess
import time
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

from apply.adapters import SetupError
from apply.browsers import ProfileInUse, chrome_pid
from apply.plain import extension
from apply.plain.bridge import BridgeBusy, Refused
from apply.plain.launcher import BRANDED, FLAGS, PlainWorkers, developer_mode

EXTENSIONS_PAGE = "chrome://extensions"
DETAILS_PAGE = f"{EXTENSIONS_PAGE}/?id={extension.EXTENSION_ID}"
POLL = 1.0  # s between two reads of the preference files
NUDGE = 45.0  # s on one step before Apply says what may have gone wrong
QUIT_WAIT = 15.0  # s from SIGTERM to telling the user that Chrome is still up
OPEN_WAIT = 20.0  # s from opening Chrome to its holding the seed profile

# The steps, in the order the user does them. Each problem below belongs to one of them.
DEVELOPER, EXTENSION, SCRIPTS = "Developer mode", "Load unpacked", "Allow User Scripts"
ORDER = (DEVELOPER, EXTENSION, SCRIPTS)
DONE = {DEVELOPER: "Developer mode is on.",
        EXTENSION: "The worker extension is registered from the right folder.",
        SCRIPTS: "Allow User Scripts is on."}


@dataclass(frozen=True)
class SeedState:
    """What the seed's preference files say now."""

    developer: bool = False
    path: str | None = None  # the folder the worker extension is registered from
    disabled: bool = False  # its card's switch is off, or Chrome turned it off
    scripts: bool = False


@dataclass(frozen=True)
class Problem:
    """The first step that isn't saved yet, and how it is wrong."""

    step: str
    kind: str  # "developer", "no_extension", "wrong_folder", "disabled" or "scripts"
    path: str | None = None  # wrong_folder: the folder that is registered


def read_state(seed: Path) -> SeedState:
    """Read the seed's preference files. It only reads: nothing here opens a file to write."""
    entry = extension.registration(seed) or {}
    return SeedState(developer=developer_mode(seed), path=entry.get("path"),
                     disabled=bool(entry.get("disable_reasons")),
                     scripts=entry.get("user_scripts_enabled") is True)


def first_problem(state: SeedState, folder: Path) -> Problem | None:
    """The first step `state` hasn't saved, with the extension expected from `folder`. None: all done."""
    if not state.developer:
        return Problem(DEVELOPER, "developer")
    if not state.path:
        return Problem(EXTENSION, "no_extension")
    if Path(state.path).resolve() != folder.resolve():
        return Problem(EXTENSION, "wrong_folder", state.path)
    if state.disabled:
        return Problem(EXTENSION, "disabled")
    if not state.scripts:
        return Problem(SCRIPTS, "scripts")
    return None


def instruction(problem: Problem, folder: Path) -> str:
    """What the user does now, for each problem."""
    load = (f"Drag it from Finder onto the Extensions page. Or click Load unpacked, press Cmd+Shift+G, "
            f"Cmd+V, Return, then click Select.\n  Folder (on your clipboard): {folder.resolve()}")
    return {
        "developer": 'Turn on Developer mode: the switch at the top right of the Extensions page.',
        "no_extension": f"No extension yet. Add the worker extension. {load}",
        "wrong_folder": f"Wrong folder. The Apply Worker card loads from {problem.path}. Click Remove on that card, "
                        f"then add it again from the right folder. {load}",
        "disabled": "The Apply Worker card is turned off. Turn on the switch on that card.",
        "scripts": "User scripts are off. On the Apply Worker's Details page, turn on Allow User Scripts.",
    }[problem.kind]


def nudge(problem: Problem) -> str:
    """What to say when a step stays unsaved for NUDGE s."""
    if problem.kind in ("no_extension", "wrong_folder"):
        return ("Apply still doesn't see the extension. Chrome saves a change in about 10 s. If the folder picker "
                "closed or Chrome showed an error, do this step again. The path is on your clipboard again.")
    return f"Apply still doesn't see {problem.step} saved. Chrome saves a change in about 10 s. Check the switch again."


def _press_return() -> bool:
    try:
        input()
    except EOFError:
        return False
    return True


@dataclass
class Desk:
    """What the wizard does outside its own files. Tests give fakes."""

    seed: Path
    binary: Path = BRANDED

    def open_chrome(self, url: str) -> None:
        """Open `url` in the seed's Chrome, in front: the user works in it. A running one takes a new tab."""
        subprocess.Popen([str(self.binary), f"--user-data-dir={self.seed}", *FLAGS, url], stdin=subprocess.DEVNULL,
                         stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)

    def copy(self, text: str) -> None:
        subprocess.run(["pbcopy"], input=text.encode(), check=True)

    def reveal(self, path: Path) -> None:
        subprocess.run(["open", "-R", str(path)], check=True)

    def chrome(self) -> int | None:
        """The PID of the Chrome that runs this seed. The lock names a PID; `ps` proves that it is this
        Chrome, not another program with a reused PID or a dead process that nothing has reaped."""
        pid = chrome_pid(self.seed)
        if pid is None:
            return None
        command = subprocess.run(["ps", "-o", "command=", "-p", str(pid)], capture_output=True, text=True).stdout
        return pid if f"--user-data-dir={self.seed}" in command else None

    def terminate(self, pid: int) -> None:
        try:
            os.kill(pid, signal.SIGTERM)
        except ProcessLookupError:
            pass


@dataclass
class Wizard:
    workers: PlainWorkers
    desk: Desk | None = None
    out: Callable[[str], None] = print
    ask_again: Callable[[], bool] = _press_return  # False: the user stops
    sleep: Callable[[float], None] = time.sleep
    clock: Callable[[], float] = time.monotonic

    def __post_init__(self) -> None:
        self.desk = self.desk or Desk(self.seed)

    @property
    def seed(self) -> Path:
        return self.workers.seed

    @property
    def folder(self) -> Path:
        return self.workers.copy

    def problem(self) -> Problem | None:
        return first_problem(read_state(self.seed), self.folder)

    def run(self) -> bool:
        """The whole setup. True only after a real Worker's hello said the extension and user scripts are on."""
        if not self.workers.idle():
            raise ProfileInUse(f"a plain Worker of {self.workers.profiles} is running: seed once none runs")
        self.seed.mkdir(parents=True, exist_ok=True)
        self.workers.prepare()  # this profiles folder's own copy of the extension, to load (KAN-645)
        try:
            return self._steps()
        except KeyboardInterrupt:
            self.out("Stopped. Apply quits the seed's Chrome so that what you did is saved. Run this again to go on.")
            self._quit(wait=False)
            return False

    def _steps(self) -> bool:
        self.out(f"Setting up the seed profile: {self.seed}")
        self.out("Apply only watches. The clicks are yours. Chrome saves each one in about 10 s, and Apply shows it here.")
        while True:
            self._guide()
            self._quit()
            if problem := self.problem():  # what a clean exit really saved
                self.out(f"{problem.step} did not save when Chrome quit. Do that step again.")
                continue
            self.out("Saved. Starting one real Worker to check.")
            if not (failed := self._worker_says()):
                self._tell_old_workers()
                return True
            self.out(f"Not done yet. {failed}")
            self.desk.open_chrome(DETAILS_PAGE)
            self.out("Check the Apply Worker card and its Allow User Scripts switch in the Chrome that opened. "
                     "Then press Return here to try again, or Ctrl-C to stop.")
            if not self.ask_again():
                self._quit(wait=False)
                return False
            self._quit()

    def _guide(self) -> None:
        """Show one step at a time until the files show all of them, with Chrome open for as long as one is left."""
        shown, since, nudged, was_open = None, self.clock(), False, False
        while True:
            problem = self.problem()
            if problem is None:
                if shown:
                    self.out(f"Done: {DONE[shown.step]}")
                return
            if self.desk.chrome() is None:
                if was_open:
                    self.out(f"Chrome closed before {problem.step} was saved. Apply opens it again.")
                    shown = None  # show the step again
                self._open(problem)
            was_open = True
            if problem != shown:
                self._show(problem, shown)
                shown, since, nudged = problem, self.clock(), False
            elif not nudged and self.clock() - since > NUDGE:
                nudged = True
                self.out(nudge(problem))
                if problem.kind in ("no_extension", "wrong_folder"):
                    self.desk.copy(str(self.folder.resolve()))
            self.sleep(POLL)

    def _open(self, problem: Problem) -> None:
        self.desk.open_chrome(DETAILS_PAGE if problem.kind == "scripts" else EXTENSIONS_PAGE)
        deadline = self.clock() + OPEN_WAIT
        while self.desk.chrome() is None:
            if self.clock() > deadline:
                raise SetupError(f"Chrome did not open the seed profile within {OPEN_WAIT:.0f} s: {self.seed}")
            self.sleep(POLL)

    def _show(self, problem: Problem, last: Problem | None) -> None:
        if last and ORDER.index(problem.step) < ORDER.index(last.step):
            self.out(f"{problem.step} did not stick. Do that step again.")
        elif last and problem.step != last.step:
            self.out(f"Done: {DONE[last.step]}")
        self.out(f"Now: {instruction(problem, self.folder)}")
        if problem.kind in ("no_extension", "wrong_folder"):
            self.desk.copy(str(self.folder.resolve()))
            self.desk.reveal(self.folder.resolve())
        elif problem.kind == "scripts" and last:
            self.desk.open_chrome(DETAILS_PAGE)  # shows the switch; the click is the user's

    def _quit(self, wait: bool = True) -> None:
        """Ask the seed's Chrome to quit, so that it saves. Never SIGKILL: that loses unsaved changes."""
        if (pid := self.desk.chrome()) is None:
            return
        self.out("Quitting the seed's Chrome.")
        self.desk.terminate(pid)
        deadline, told = self.clock() + QUIT_WAIT, False
        while wait and self.desk.chrome() is not None:
            if not told and self.clock() > deadline:
                told = True
                self.out(f"Chrome is not quit yet (PID {pid}). A dialog or the folder picker may be open. Close it, "
                         "then quit that Chrome with Cmd+Q. Apply waits.")
            self.sleep(POLL)

    def _worker_says(self) -> str | None:
        """Start one real Worker from the seed, on a new profile, so that an old Worker profile can't answer for
        it. It goes after the check. Returns what is wrong, or None when its hello has the extension and user
        scripts on."""
        worker = 0
        while self.workers.profile(worker).exists():
            worker += 1
        try:
            hello = self.workers.launch(worker).connection.hello
        except (TimeoutError, Refused, BridgeBusy, SetupError, OSError) as error:
            return f"The Worker did not say hello: {error}"
        finally:
            self.workers.stop(worker)
            self.workers.bridge.stop()
            shutil.rmtree(self.workers.profile(worker), ignore_errors=True)
            (self.workers.profiles / f"plain-{worker + 1}.log").unlink(missing_ok=True)
        if hello.get("userScripts") is not True:
            return "The Worker said hello, but its user scripts are off."
        self.out(f"Done: a real Worker said hello with extension {hello.get('extension')} and user scripts on.")
        return None

    def _tell_old_workers(self) -> None:
        old = sorted(p.name for p in self.workers.profiles.glob("plain-[0-9]*") if p.is_dir())
        if old:
            self.out(f"These Worker profiles keep their old setup until you delete them: {', '.join(old)}. "
                     "New Worker profiles copy this seed.")


def run(profiles: Path | None = None, out: Callable[[str], None] = print) -> bool:
    """`apply plain seed`, with branded Chrome."""
    workers = PlainWorkers(profiles, kind="chrome")
    if not BRANDED.exists():
        raise SetupError(f"no Google Chrome at {BRANDED}: install Chrome, then run this again")
    return Wizard(workers, out=out).run()
