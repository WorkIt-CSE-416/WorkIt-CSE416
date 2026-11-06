"""`apply reopen` (KAN-720): after Apply and its Workers stop, each form on the open-forms list comes back in the Worker
that held it, with what it held, under the same guards, and nothing is ever submitted.

The restart test runs Apply in a process of its own and kills it and its plain Worker (Chrome for Testing). It skips
without Chrome for Testing (CI). The sign-in test runs the fake Workday in Playwright's Chromium."""

import _thread
import json
import os
import shutil
import signal
import subprocess
import sys
import tempfile
import threading
import time
from pathlib import Path

import fakes
import pytest
from conftest import APPLY, ARC_FORM, ARC_URL, PURE_STORAGE_FORM, PURE_STORAGE_URL
from fake_workday import FakeWorkdayServer
from fakes import FakeJobServer, RecordingBoard
from plain_fakes import have_chrome_for_testing, https_fake
from test_employer_accounts import XCEL_FORM, XCEL_URL
from test_plain_routing import UPLOADS, _uploading
from test_rehearse import NeverSubmits, NeverSubmittingWorkday, adapters
from test_resume import handed_pages
from test_run_answers import profile_with

from apply import batch, cli, rehearsal
from apply.browsers import chrome_pid
from apply.fillers import FILLERS
from apply.greenhouse import GreenhouseFiller
from apply.plain.bridge import Bridge
from apply.plain.launcher import PlainWorkers
from apply.plain.site import PlainSite
from apply.profile import ApplicantProfile
from apply.records import FolderRecords
from apply.workday import GOOGLE_BUTTON

TESTS = Path(__file__).parent
needs_chrome = pytest.mark.skipif(not have_chrome_for_testing(), reason="needs Chrome for Testing")
PLANTED = "Typed on the held form before the restart"


def _wait(until, seconds: float, why: str):
    deadline = time.monotonic() + seconds
    while not (found := until()):
        if time.monotonic() > deadline:
            pytest.fail(why() if callable(why) else why)
        time.sleep(0.5)
    return found


def _gone(pid: int) -> bool:
    try:
        os.kill(pid, 0)
        return False
    except ProcessLookupError:
        return True


class Held(RecordingBoard):
    """The window, which presses Ctrl-C once `count` tiles hold their forms for Lisul."""

    def __init__(self, count: int):
        super().__init__()
        self._count, self._pressed = count, False

    def update(self, worker: int, **caption) -> None:
        super().update(worker, **caption)
        held = [c for c in self.captions.values() if c.get("status") == rehearsal.READY]
        if len(held) >= self._count and not self._pressed:
            self._pressed = True
            threading.Timer(3.0, _thread.interrupt_main).start()  # once both are held and their guards lifted


@needs_chrome
def test_each_form_comes_back_in_its_worker_with_its_record_and_guards_after_apply_is_killed(monkeypatch, tmp_path):
    monkeypatch.setattr(fakes._UploadStore, "url", property(lambda self: UPLOADS))
    listed, records, log = tmp_path / "open-forms.json", tmp_path / "rehearsals", tmp_path / "child.log"
    monkeypatch.setattr(batch, "PATH", listed)
    profile = profile_with(tmp_path)
    folder = Path(tempfile.mkdtemp(prefix="apw-re-", dir="/tmp"))  # short: a socket path is capped at 104 bytes
    child = None
    try:
        with FakeJobServer(ARC_FORM, PURE_STORAGE_FORM) as fake, https_fake(_uploading(fake)) as port:
            # 1. Apply rehearses two forms in one plain Worker, the second held for Lisul.
            child = subprocess.Popen([sys.executable, str(TESTS / "reopen_child.py"), str(folder), str(port), str(listed),
                                      str(records), str(profile)], cwd=APPLY, env=os.environ | {"PYTHONPATH": str(TESTS)},
                                     stdout=log.open("w"), stderr=subprocess.STDOUT)
            kept = _wait(lambda: (forms := batch.forms(listed)) and len(forms) == 2
                         and all(f["status"] == rehearsal.READY and f.get("record") for f in forms) and forms,
                         240, lambda: f"the first Apply never held both forms: {batch.forms(listed)}\n{log.read_text()[-3000:]}")
            assert [f["link"] for f in kept] == [ARC_URL, PURE_STORAGE_URL] and {f["worker"] for f in kept} == {0}
            pid = chrome_pid(folder / "plain-1")
            assert pid
            # 2. The Mac restarts: Apply dies, and macOS quits the Worker's Chrome.
            child.kill()
            child.wait(10)
            os.kill(pid, signal.SIGTERM)  # the Worker the test's own child started
            _wait(lambda: _gone(pid), 30, "the Worker's Chrome didn't quit")
            assert len(batch.forms(listed)) == 2  # nothing of the list was lost

            # What Lisul typed on the held form before the restart, as its Record kept it.
            arc = Path(kept[0]["record"]) / "answers.json"
            rows = json.loads(arc.read_text())
            planted = next(r for r in rows if r.get("kind") == "text" and r["on_page"] and "name" not in r["question"].lower()
                           and "@" not in str(r["on_page"]) and "phone" not in r["question"].lower())
            planted["on_page"] = PLANTED
            arc.write_text(json.dumps(rows))

            # 3. apply reopen, on the same profiles folder.
            monkeypatch.setitem(FILLERS, "greenhouse", NeverSubmits(GreenhouseFiller()))
            flags = (f"--host-resolver-rules=MAP * 127.0.0.1:{port}", "--ignore-certificate-errors", "--disable-quic")
            site = PlainSite(PlainWorkers(folder, kind="testing", bridge=Bridge(folder / "w.sock"), test_flags=flags))
            site.fetch = fake.fetch
            board, seen = Held(2), {}
            real_hold = rehearsal._Kept.hold

            def hold(self, release, *args, **kwargs):  # each held page's guard as Lisul gets it
                connection = site.workers.running[0].connection
                seen[self._page.url] = connection.call("guard.status", tab=self._page.tab)
                seen.setdefault("pids", set()).add(site.workers.running[0].pid)
                return real_hold(self, release, *args, **kwargs)
            monkeypatch.setattr(rehearsal._Kept, "hold", hold)
            watchdog = threading.Timer(300, _thread.interrupt_main)
            watchdog.start()
            try:
                cli.main(["reopen", "--profile", str(profile)], adapters(site, board=board, records=FolderRecords(records)))
            finally:
                watchdog.cancel()
                site.close()
            submissions = fake.submissions
    finally:
        if child and child.poll() is None:
            child.kill()
        shutil.rmtree(folder, ignore_errors=True)

    assert submissions == []  # nothing was ever sent
    tiles = [board.captions[k] for k in sorted(board.captions)]
    assert [t["posting_url"] for t in tiles] == [ARC_URL, PURE_STORAGE_URL]
    assert all(t["status"] == rehearsal.READY for t in tiles), [(t["status"], t.get("why")) for t in tiles]
    for tile in tiles:  # its Record anew, and its history says it was reopened
        assert "Reopened after Apply stopped" in tile["history"][0]
    assert board.shown == {1: 0}  # the second form was sent into the same Worker, once the first had stopped
    assert len(seen["pids"]) == 1  # one Chrome carried both, on the profile that held them
    for url in (ARC_URL, PURE_STORAGE_URL):  # held for Lisul under its guard's note: registered, then lifted for him
        status = next(v for k, v in seen.items() if k != "pids" and k.split("?")[0] == url.split("?")[0])
        assert status["scripts"] and status["rules"] > 0, status
    new = {f["link"]: f for f in batch.forms(listed)}
    assert set(new) == {ARC_URL, PURE_STORAGE_URL} and all(f["status"] == rehearsal.READY for f in new.values())
    again = {r["field"]: r for r in json.loads((Path(new[ARC_URL]["record"]) / "answers.json").read_text())}
    assert again[planted["field"]]["on_page"] == PLANTED  # what the form held came back, not a new answer


def test_a_reopened_workday_form_at_a_sign_in_waits_for_lisul_and_goes_on_by_itself(monkeypatch, tmp_path):
    monkeypatch.setitem(FILLERS, "workday", NeverSubmittingWorkday)
    handed = handed_pages(monkeypatch)
    shown = {}

    class Lisul(RecordingBoard):
        """At the reopened form's sign-in he signs in with Google himself; once Apply has gone on and stopped, he closes it."""

        turns = 0

        def resumed(self, worker):
            return False  # he never presses Resume

        def answered(self, worker):
            if not handed or handed[-1].is_closed():
                return []
            page, self.turns = handed[-1], self.turns + 1
            caption = self.captions[worker]
            if "Went on by itself" in " ".join(caption.get("history") or []) and caption.get("status") != "filling" \
                    or self.turns > 60:
                page.close()
            elif self.turns == 2:
                shown["status"], shown["why"] = caption.get("status"), caption.get("why")
                shown["typed"] = [box.input_value() for box in page.locator("input").all() if box.is_visible()]
                page.locator(GOOGLE_BUTTON).click()  # his own click: Apply never clicks on a sign-in page
            elif self.turns == 4 and "accounts.google.com" in page.url:
                page.locator("[data-identifier]").first.click()
            return []

    board = Lisul()
    reopening = rehearsal.Reopening([0], since={XCEL_URL: "2026-11-05 22:10"})
    with FakeWorkdayServer(XCEL_FORM, google="pick") as server:
        rehearsal.rehearse([XCEL_URL], adapters(server, board=board), ApplicantProfile.load(profile_with(tmp_path)), 1,
                           out=[].append, reopening=reopening)

    assert shown["status"] == rehearsal.SIGN_IN and "types nothing into a sign-in" in shown["why"]  # its tile: sign in
    assert not any(shown["typed"])  # Apply typed nothing on the sign-in page
    history = board.captions[0]["history"]
    assert "Reopened after Apply stopped (open since 2026-11-05 22:10)" in history[0]
    assert [h.split(" ", 1)[1].split(":")[0] for h in history[1:3]] == ["Paused", "Went on by itself"], history
    assert server.created == [] and server.submissions == []  # no account made, nothing sent
