"""`apply plain seed`, the guided setup (KAN-677): each detected state, from fixture preference files.

The fixtures are written as Chrome writes them (Secure Preferences, measured on Chrome for Testing): the
wizard reads them and must never change them. The live check is in the PR: Chrome and the Worker are fakes here.
"""

import json
import os
import signal
import subprocess
from pathlib import Path
from types import SimpleNamespace

import pytest

from apply.browsers import ProfileInUse
from apply.plain import extension, seed_setup
from apply.plain.bridge import Refused
from apply.plain.seed_setup import (
    DETAILS_PAGE,
    EXTENSIONS_PAGE,
    Desk,
    Problem,
    SeedState,
    Wizard,
    first_problem,
    read_state,
)


def write_prefs(seed: Path, developer=False, path=None, scripts=False, disabled=(), name="Secure Preferences") -> None:
    extensions = {"ui": {"developer_mode": developer}, "settings": {"some-other-extension": {"path": "/elsewhere"}}}
    if path:
        extensions["settings"][extension.EXTENSION_ID] = {"path": str(path), "location": 4, "disable_reasons": list(disabled),
                                                          "user_scripts_enabled": scripts}
    (seed / "Default").mkdir(parents=True, exist_ok=True)
    (seed / "Default" / name).write_text(json.dumps({"extensions": extensions}))


FOLDER = Path("/profiles/worker-extension")


@pytest.mark.parametrize("state, step, kind", [
    (SeedState(), seed_setup.DEVELOPER, "developer"),
    (SeedState(developer=True), seed_setup.EXTENSION, "no_extension"),
    (SeedState(developer=True, path="/old/checkout"), seed_setup.EXTENSION, "wrong_folder"),
    (SeedState(developer=True, path=str(FOLDER), disabled=True), seed_setup.EXTENSION, "disabled"),
    (SeedState(developer=True, path=str(FOLDER)), seed_setup.SCRIPTS, "scripts"),
])
def test_first_problem_names_the_first_step_not_saved(state, step, kind):
    problem = first_problem(state, FOLDER)
    assert (problem.step, problem.kind) == (step, kind)


def test_first_problem_is_none_when_every_step_is_saved():
    assert first_problem(SeedState(developer=True, path=str(FOLDER), scripts=True), FOLDER) is None


def test_each_failure_has_its_own_message():
    kinds = ("developer", "no_extension", "wrong_folder", "disabled", "scripts")
    said = [seed_setup.instruction(Problem("step", kind, "/old/checkout"), FOLDER) for kind in kinds]
    assert len(set(said)) == len(kinds)
    assert "/old/checkout" in said[2] and "Remove" in said[2] and str(FOLDER) in said[2]


def test_read_state_on_a_fresh_profile_and_on_broken_files(tmp_path):
    assert read_state(tmp_path) == SeedState()
    (tmp_path / "Default").mkdir()
    (tmp_path / "Default" / "Secure Preferences").write_text("{half a file")
    (tmp_path / "Default" / "Preferences").write_text('{"extensions": {"settings": []}}')
    assert read_state(tmp_path) == SeedState()


@pytest.mark.parametrize("name", ["Secure Preferences", "Preferences"])
def test_read_state_reads_each_step_from_either_file(tmp_path, name):
    write_prefs(tmp_path, developer=True, path="/a/folder", scripts=True, disabled=[8], name=name)
    assert read_state(tmp_path) == SeedState(developer=True, path="/a/folder", disabled=True, scripts=True)


def test_read_state_keeps_the_path_of_a_folder_that_is_gone(tmp_path):
    write_prefs(tmp_path, developer=True, path="/gone/checkout")
    assert read_state(tmp_path).path == "/gone/checkout"
    assert extension.loaded_folder(tmp_path) is None  # doctor's view: nothing that loads


class FakeDesk:
    """Chrome and the Mac, with the user's clicks as `clicks`: one runs at each poll."""

    def __init__(self, stubborn: int = 0, on_terminate=None):
        self.opened, self.copied, self.revealed, self.terminated = [], [], [], []
        self.pid, self.quitting = None, False
        self.stubborn = stubborn  # polls Chrome stays up after SIGTERM
        self.on_terminate = on_terminate

    def open_chrome(self, url):
        self.opened.append(url)
        self.pid = 4242

    def copy(self, text):
        self.copied.append(text)

    def reveal(self, path):
        self.revealed.append(path)

    def chrome(self):
        if self.quitting and self.stubborn:
            self.stubborn -= 1
        elif self.quitting:
            self.pid, self.quitting = None, False
        return self.pid

    def terminate(self, pid):
        assert pid == self.pid
        self.terminated.append(pid)
        self.quitting = True
        if self.on_terminate:
            self.on_terminate()


class FakeWorkers:
    def __init__(self, root: Path, hellos=None):
        self.profiles, self.seed, self.copy = root, root / "plain-seed", root / "worker-extension"
        self.copy.mkdir(parents=True)
        self.hellos = list(hellos or [{"extension": "1.0", "userScripts": True}])
        self.launched, self.stopped = [], []
        self.bridge = SimpleNamespace(stop=lambda: None)
        self.running = False

    def idle(self):
        return not self.running

    def prepare(self):
        pass

    def profile(self, worker):
        return self.profiles / f"plain-{worker + 1}"

    def launch(self, worker):
        self.launched.append(worker)
        self.profile(worker).mkdir()
        hello = self.hellos.pop(0)
        if isinstance(hello, Exception):
            raise hello
        return SimpleNamespace(connection=SimpleNamespace(hello=hello))

    def stop(self, worker):
        self.stopped.append(worker)


class Run:
    """A wizard on fake time: each sleep runs the user's next click and moves the clock."""

    def __init__(self, tmp_path, clicks=(), desk=None, hellos=None, again=()):
        self.workers = FakeWorkers(tmp_path, hellos)
        self.desk = desk or FakeDesk()
        self.said, self.now, self.clicks, self.again = [], 0.0, list(clicks), list(again)
        self.wizard = Wizard(self.workers, self.desk, out=self.said.append, ask_again=lambda: self.again.pop(0),
                             sleep=self.sleep, clock=lambda: self.now)

    def sleep(self, seconds):
        self.now += seconds
        if self.clicks:
            self.clicks.pop(0)()

    def prefs(self, **fields):
        return lambda: write_prefs(self.workers.seed, **fields)

    @property
    def text(self):
        return "\n".join(self.said)

    def done(self):
        return {"developer": True, "path": self.workers.copy, "scripts": True}


def happy(run):
    return [run.prefs(developer=True), run.prefs(developer=True, path=run.workers.copy), run.prefs(**run.done())]


def test_a_fresh_profile_reaches_a_working_worker_with_only_the_users_clicks(tmp_path):
    run = Run(tmp_path)
    run.clicks = happy(run)
    assert run.wizard.run() is True

    assert run.desk.opened == [EXTENSIONS_PAGE, DETAILS_PAGE]  # opened for the user, nothing clicked
    assert run.desk.copied == [str(run.workers.copy.resolve())]
    assert run.desk.revealed == [run.workers.copy.resolve()]
    assert run.desk.terminated == [4242]
    assert run.workers.launched == [0] and run.workers.stopped == [0]
    for confirmed in ("Done: Developer mode is on.", "Done: The worker extension is registered",
                      "Done: Allow User Scripts is on.", "Done: a real Worker said hello"):
        assert confirmed in run.text
    assert run.text.index("Quitting") < run.text.index("real Worker said hello")


def test_the_wizard_never_changes_the_seeds_preference_files(tmp_path):
    run = Run(tmp_path)
    write_prefs(run.workers.seed, **run.done())
    written = run.workers.seed / "Default" / "Secure Preferences"
    before = written.read_bytes(), written.stat().st_mtime_ns
    assert run.wizard.run() is True
    assert (written.read_bytes(), written.stat().st_mtime_ns) == before
    assert [p.name for p in (run.workers.seed / "Default").iterdir()] == ["Secure Preferences"]
    assert run.desk.opened == []  # a finished seed needs no Chrome and no click


def test_no_extension_says_so_and_nudges_with_the_path_on_the_clipboard_again(tmp_path):
    run = Run(tmp_path)
    run.clicks = [run.prefs(developer=True)] + [lambda: None] * 60 + [run.prefs(developer=True, path=run.workers.copy),
                                                                       run.prefs(**run.done())]
    assert run.wizard.run() is True
    assert "No extension yet" in run.text and "Apply still doesn't see the extension" in run.text
    assert len(run.desk.copied) == 2


def test_wrong_folder_names_both_folders_and_shows_the_step_again(tmp_path):
    run = Run(tmp_path)
    run.clicks = [run.prefs(developer=True, path="/old/checkout"), run.prefs(developer=True, path=run.workers.copy),
                  run.prefs(**run.done())]
    assert run.wizard.run() is True
    assert "Wrong folder" in run.text and "/old/checkout" in run.text
    assert run.desk.revealed == [run.workers.copy.resolve()]


def test_user_scripts_off_says_so_on_its_details_page(tmp_path):
    run = Run(tmp_path)
    run.clicks = [run.prefs(developer=True, path=run.workers.copy), run.prefs(**run.done())]
    assert run.wizard.run() is True
    assert "User scripts are off" in run.text and DETAILS_PAGE in run.desk.opened


def test_a_turned_off_card_says_so(tmp_path):
    run = Run(tmp_path)
    run.clicks = [run.prefs(developer=True, path=run.workers.copy, disabled=[1]), run.prefs(**run.done())]
    assert run.wizard.run() is True
    assert "card is turned off" in run.text


def test_a_step_that_went_back_does_not_stick(tmp_path):
    run = Run(tmp_path)
    run.clicks = [run.prefs(developer=True, path=run.workers.copy), run.prefs(developer=False),
                  run.prefs(developer=True, path=run.workers.copy), run.prefs(**run.done())]
    assert run.wizard.run() is True
    assert "Developer mode did not stick" in run.text


def test_a_step_lost_when_chrome_quit_is_named_and_shown_again(tmp_path):
    run = Run(tmp_path)
    lost = [True]

    def lose():
        if lost:
            lost.pop()
            write_prefs(run.workers.seed, developer=True)

    run.desk.on_terminate = lose
    run.clicks = happy(run) + [lambda: None, run.prefs(developer=True, path=run.workers.copy), run.prefs(**run.done())]
    assert run.wizard.run() is True
    assert "Load unpacked did not save when Chrome quit" in run.text
    assert run.desk.opened.count(EXTENSIONS_PAGE) == 2


def test_chrome_not_quit_says_so_and_waits_and_is_never_killed(tmp_path):
    run = Run(tmp_path, desk=FakeDesk(stubborn=30))
    run.clicks = happy(run)
    assert run.wizard.run() is True
    assert "Chrome is not quit yet (PID 4242)" in run.text and "Cmd+Q" in run.text
    assert run.desk.terminated == [4242] and run.workers.launched == [0]
    assert run.text.index("not quit yet") < run.text.index("real Worker said hello")


def test_chrome_closed_too_early_opens_again_on_the_same_step(tmp_path):
    run = Run(tmp_path)

    def closed():
        run.desk.pid = None

    run.clicks = [run.prefs(developer=True), closed, run.prefs(developer=True, path=run.workers.copy),
                  run.prefs(**run.done())]
    assert run.wizard.run() is True
    assert "Chrome closed before Load unpacked was saved" in run.text
    assert run.text.count("No extension yet") == 2


def test_done_needs_user_scripts_on_in_the_workers_hello(tmp_path):
    run = Run(tmp_path, hellos=[{"extension": "1.0", "userScripts": False}, {"extension": "1.0", "userScripts": True}], again=[True])
    write_prefs(run.workers.seed, **run.done())
    assert run.wizard.run() is True
    assert "its user scripts are off" in run.text and DETAILS_PAGE in run.desk.opened
    assert len(run.workers.launched) == 2


def test_no_hello_is_not_done_and_the_user_can_stop(tmp_path):
    run = Run(tmp_path, hellos=[TimeoutError("no hello from plain Worker 1")], again=[False])
    write_prefs(run.workers.seed, **run.done())
    assert run.wizard.run() is False
    assert "did not say hello: no hello from plain Worker 1" in run.text
    assert "real Worker said hello" not in run.text
    assert run.desk.terminated == [4242]


def test_a_refused_hello_is_not_done(tmp_path):
    run = Run(tmp_path, hellos=[Refused("protocol 0"), {"extension": "1.0", "userScripts": True}], again=[True])
    write_prefs(run.workers.seed, **run.done())
    assert run.wizard.run() is True
    assert "did not say hello: protocol 0" in run.text


def test_an_old_worker_profile_cannot_answer_for_the_seed(tmp_path):
    run = Run(tmp_path)
    write_prefs(run.workers.seed, **run.done())
    run.workers.profile(0).mkdir()
    assert run.wizard.run() is True
    assert run.workers.launched == [1]
    assert not run.workers.profile(1).exists()  # the check's own copy goes
    assert run.workers.profile(0).is_dir()
    assert "keep their old setup until you delete them: plain-1" in run.text


def test_a_running_worker_refuses_the_setup_before_anything_opens(tmp_path):
    run = Run(tmp_path)
    run.workers.running = True
    with pytest.raises(ProfileInUse):
        run.wizard.run()
    assert run.desk.opened == [] and not run.workers.seed.exists()


def test_ctrl_c_quits_the_seeds_chrome_so_it_saves(tmp_path):
    run = Run(tmp_path)

    def stop():
        raise KeyboardInterrupt

    run.clicks = [stop]
    assert run.wizard.run() is False
    assert run.desk.terminated == [4242] and "Stopped" in run.text


def test_chrome_that_never_opens_is_a_setup_error(tmp_path):
    run = Run(tmp_path)
    run.desk.open_chrome = lambda url: None
    with pytest.raises(seed_setup.SetupError, match="did not open the seed profile"):
        run.wizard.run()


def test_the_desk_copies_reveals_and_opens_with_no_click(tmp_path, monkeypatch):
    calls = []
    monkeypatch.setattr(subprocess, "run", lambda argv, **kw: calls.append((argv, kw.get("input"))))
    monkeypatch.setattr(subprocess, "Popen", lambda argv, **kw: calls.append((argv, None)))
    desk = Desk(tmp_path, Path("/Chrome"))
    desk.copy("/a/folder")
    desk.reveal(Path("/a/folder"))
    desk.open_chrome(EXTENSIONS_PAGE)
    assert calls[0] == (["pbcopy"], b"/a/folder")
    assert calls[1] == (["open", "-R", "/a/folder"], None)
    assert calls[2][0][:2] == ["/Chrome", f"--user-data-dir={tmp_path}"] and calls[2][0][-1] == EXTENSIONS_PAGE
    assert not any(a.startswith(("--remote-debugging", "--enable-automation", "--headless", "--load-extension"))
                   for a in calls[2][0])


def test_the_desk_quits_by_sigterm_only(tmp_path, monkeypatch):
    sent = []
    monkeypatch.setattr(os, "kill", lambda pid, number: sent.append((pid, number)))
    Desk(tmp_path).terminate(77)
    assert sent == [(77, signal.SIGTERM)]


def test_the_desk_does_not_trust_a_lock_whose_pid_is_another_program(tmp_path):
    (tmp_path / "SingletonLock").symlink_to(f"this-mac-{os.getpid()}")  # this test's own process: not that Chrome
    assert Desk(tmp_path).chrome() is None
    assert Desk(tmp_path / "none").chrome() is None


def test_the_desk_knows_the_seeds_own_chrome(tmp_path, monkeypatch):
    seed = tmp_path / "plain-seed"
    seed.mkdir()
    (seed / "SingletonLock").symlink_to(f"this-mac-{os.getpid()}")  # a live PID
    asked = []

    def ps(argv, **kw):
        asked.append(argv)
        return SimpleNamespace(stdout=f"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome --user-data-dir={seed} --no-first-run\n")

    monkeypatch.setattr(subprocess, "run", ps)
    assert Desk(seed).chrome() == os.getpid()
    assert asked == [["ps", "-o", "command=", "-p", str(os.getpid())]]


def test_setup_needs_branded_chrome(tmp_path, monkeypatch):
    monkeypatch.setattr(seed_setup, "BRANDED", tmp_path / "no-chrome")
    with pytest.raises(seed_setup.SetupError, match="no Google Chrome"):
        seed_setup.run(tmp_path)
