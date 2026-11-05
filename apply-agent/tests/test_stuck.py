"""Never stuck with no way on (KAN-594): while a rehearsal fills, its tile
says what Apply is doing, and offers Resume whenever Apply waits on Claude,
the page shows a field error, or the fill makes no progress for a while.
Resume stops the wait, keeps what Lisul put on the page, and goes on from
it. Nothing is ever submitted."""

import json
import os
import time
import urllib.error
import urllib.request

import pytest
from fake_workday import STEPS, FakeWorkdayServer, Field
from fakes import FakeClaude, RecordingBoard
from test_dashboard import window  # noqa: F401 (a fixture)
from test_employer_accounts import XCEL_FORM, XCEL_URL, World
from test_rehearse import NeverSubmittingWorkday, adapters

from apply import rehearsal, stuck
from apply.claude_cli import run_claude
from apply.dashboard import Dashboard, NoFrames
from apply.fillers import FILLERS
from apply.profile import ApplicantProfile

XCEL = "xcelenergy.wd1.myworkdayjobs.com"
ESSAY = "Why do you want to intern at Xcel Energy?"
HIS = "I want to build the grid tools my own town runs on."
# My Information, then a step whose essay Claude must write: its plan waits on Claude.
ESSAY_STEPS = [STEPS[0], ("Application Questions", [Field("whyXcel", ESSAY, "textarea", True)])]


class WaitingClaude(FakeClaude):
    """Claude, slow on the Xcel essay (its research or its writing) until Lisul's Resume stops the wait."""

    stopped = 0

    def _waits(self, said: str) -> None:
        if self.stopped or "Xcel" not in said:
            return
        end = time.monotonic() + 60
        while time.monotonic() < end:
            if stuck.pressed():  # as the live adapter's watcher hears it, and kills its claude -p
                self.stopped += 1
                raise stuck.Stopped("you pressed Resume while Apply waited on Claude")
            time.sleep(0.05)
        pytest.fail("Resume never came while Apply waited on Claude")

    def ask(self, *, model, system, prompt, schema):
        if "essays" in schema["properties"] or "plan" in schema["properties"]:
            self._waits(prompt + json.dumps(schema))
        return super().ask(model=model, system=system, prompt=prompt, schema=schema)

    def research(self, **call):
        self._waits(call["prompt"])
        return super().research(**call)


def test_resume_while_apply_waits_on_claude_keeps_his_answer_and_goes_on_from_the_page_unsent(monkeypatch):
    monkeypatch.setitem(FILLERS, "workday", NeverSubmittingWorkday)
    pages = []
    real_guard = rehearsal.guard
    monkeypatch.setattr(rehearsal, "guard", lambda page: pages.append(page) or real_guard(page))

    class Lisul(RecordingBoard):
        """While Apply waits on Claude for the essay, he types his own answer on the page and presses Resume."""

        pressed, seen = 0, None

        def resumed(self, worker):
            shown = self.captions.get(worker, {})
            if self.pressed or not shown.get("waiting"):
                return False
            self.seen = dict(shown)
            pages[-1].locator("textarea").first.fill(HIS)
            self.pressed += 1
            return True

    board, claude, world = Lisul(), WaitingClaude(), World()
    with FakeWorkdayServer(XCEL_FORM, steps=ESSAY_STEPS) as server:
        [done] = rehearsal.rehearse([XCEL_URL], adapters(server, claude, board=board),
                                    ApplicantProfile.load(world.profile), 1, keep_open=False, out=lambda line: None)
        saved = server.saved(XCEL)

    # While it waited, the tile said what Apply was doing and offered Resume.
    assert board.pressed == 1 and claude.stopped == 1
    assert board.seen["status"] == "filling" and board.seen["waiting"] is True
    assert board.seen["doing"] in ("Researching Xcel Energy Services for an essay",
                                   "Writing answers for 'Application Questions'")
    # Resume stopped the wait and went on from the page as he left it, to the last step, unsent.
    assert done.outcome == "ready to submit", done.why
    assert saved["whyXcel"] == HIS  # his answer, never written over
    assert done.missing == ()  # he answered it on the page: it waits on him no more
    [line] = [h for h in done.history if "Resumed" in h]
    assert "you pressed Resume while Apply was " in line and "went on from the page as you left it" in line
    assert board.captions[0]["waiting"] is False
    assert server.submissions == []


FILLING = {"company": "Visa", "role": "Intern", "posting_url": "https://visa.wd5.myworkdayjobs.com/x/job/1",
           "job_system": "workday", "status": "filling"}


class ErrorFrames(NoFrames):
    def __init__(self, error: str):
        self.error = error

    def field_error(self, worker: int) -> str:
        return self.error


def tile(frames=None, **caption) -> dict:
    with Dashboard(1, frames or NoFrames()) as board:
        board.update(0, **FILLING)
        board.update(0, **caption)
        return board.state()["tiles"][0]


def test_a_filling_tile_says_what_apply_is_doing_and_offers_no_resume_while_it_moves_on():
    shown = tile(doing="Planning answers for 'Application Questions'", progress_at=time.time())

    assert (shown["tone"], shown["label"]) == ("filling", "Filling")
    assert shown["detail"] == shown["doing"] == "Planning answers for 'Application Questions'"
    assert "resume" not in shown


@pytest.mark.parametrize("caption, frames, says", [
    ({"doing": "Researching Visa for an essay", "waiting": True, "progress_at": time.time()}, None, stuck.WAITING),
    ({"doing": "Filling 'My Experience'", "progress_at": time.time() - stuck.STUCK_AFTER - 5}, None, "No progress for"),
    ({"doing": "Filling 'My Experience'", "progress_at": time.time()}, ErrorFrames("Error-Degree is required"),
     "The page shows an error: 'Error-Degree is required'"),
])
def test_a_filling_tile_offers_resume_when_apply_waits_is_stuck_or_the_page_shows_an_error(caption, frames, says):
    shown = tile(frames, **caption)

    assert shown["tone"] == "filling" and shown["detail"] == caption["doing"]
    assert shown["resume"]["ok"] is True and shown["resume"]["why"].startswith(says)


def test_resume_on_a_waiting_tile_goes_to_its_worker_once_and_a_moving_one_refuses_it():
    with Dashboard(1, NoFrames()) as board:
        board.update(0, **FILLING, doing="Researching Visa for an essay", waiting=True, progress_at=time.time())
        reply = urllib.request.urlopen(urllib.request.Request(
            board.url + "/resume", json.dumps({"id": "tile-0"}).encode(), {"X-Apply-Token": board.token}))
        assert "Resuming" in json.loads(reply.read())["message"]
        assert board.resumed(0) and not board.resumed(0)

        board.update(0, waiting=False, progress_at=time.time())  # Apply moves on: no Resume to press
        with pytest.raises(urllib.error.HTTPError) as moving:
            urllib.request.urlopen(urllib.request.Request(
                board.url + "/resume", json.dumps({"id": "tile-0"}).encode(), {"X-Apply-Token": board.token}))
        assert moving.value.code == 404 and not board.resumed(0)


def test_a_held_tile_offers_no_resume_however_long_it_waits_for_start():
    shown = tile(stage="ready", progress_at=time.time() - 600)
    assert "resume" not in shown


@pytest.mark.parametrize("markup, said", [
    # Workday's errorHeading, as Snap's tenant lists a refused step's errors (the engine's fake step).
    ('<div data-automation-id="errorHeading"><ol><li><button><span>Error</span>-Degree: The field Degree is '
     'required and must have a value.</button></li></ol></div>',
     "Error-Degree: The field Degree is required and must have a value."),
    ('<div data-automation-id="errorMessage" role="alert">Enter a valid phone number</div>', "Enter a valid phone number"),
    # Greenhouse's job boards: the field's helper text turns red.
    ('<label>First Name<input aria-invalid="true" aria-describedby="first_name-error"></label>'
     '<p class="helper-text helper-text--error" id="first_name-error">First Name is required.</p>',
     "First Name is required."),
    ('<div class="application-question"><input><div class="error-message">Please enter a valid email</div></div>',
     "Please enter a valid email"),
    ('<div role="alert"></div><div class="error" hidden>Hidden</div><input aria-invalid="false">', ""),
    ('<div id="apply-rehearsal-blocked" role="alert">Apply blocked a submit</div>', ""),  # Apply's own note
])
def test_the_field_error_check_reads_each_job_systems_error_and_nothing_else(window, markup, said):
    window.set_content(f"<form>{markup}</form>")
    assert stuck.field_error(window) == said


def test_resume_kills_a_claude_call_apply_waits_on():
    class Pressed(RecordingBoard):
        def resumed(self, worker):
            return True

    started = time.monotonic()
    with stuck.watching(Pressed(), 0), stuck.stoppable(), pytest.raises(stuck.Stopped):
        run_claude(["/bin/sh", "-c", "sleep 30"], "", dict(os.environ))
    assert time.monotonic() - started < 5
    with stuck.watching(Pressed(), 0):  # outside a step that goes on from the page, nothing stops it
        assert run_claude(["/bin/sh", "-c", "echo done"], "", dict(os.environ)) == "done\n"


def test_a_stalled_fill_notes_what_it_was_doing_and_where_its_thread_was_in_its_trace(tmp_path, monkeypatch):
    # Applied Materials (2026-11-04): "No progress for 420 s" on Application Questions, and nothing in the trace.
    from apply import trace
    monkeypatch.setattr(stuck, "STUCK_AFTER", 0.2)
    monkeypatch.setattr(stuck, "LOOK_S", 0.05)

    def hangs_here() -> None:
        time.sleep(0.6)

    with trace.tracing("request-1", "https://x.wd1.myworkdayjobs.com/job/1", folder=tmp_path) as path:
        with stuck.watching(RecordingBoard(), 0):
            stuck.doing("Filling 'Application Questions'")
            hangs_here()
    events = [json.loads(line) for line in path.read_text().splitlines()]

    [doing] = [e for e in events if e["kind"] == "doing"]
    [stalled] = [e for e in events if e["kind"] == "stuck"]  # once per stall, not on every look
    assert doing["what"] == stalled["doing"] == "Filling 'Application Questions'"
    assert "hangs_here" in stalled["stack"]


def test_a_wait_on_claude_is_no_stall(tmp_path, monkeypatch):
    from apply import trace
    monkeypatch.setattr(stuck, "STUCK_AFTER", 0.1)
    monkeypatch.setattr(stuck, "LOOK_S", 0.05)

    with trace.tracing("request-2", "https://x.example/1", folder=tmp_path) as path:
        with stuck.watching(RecordingBoard(), 0), stuck.stoppable(), stuck.waiting():
            time.sleep(0.4)

    assert '"kind": "stuck"' not in path.read_text()


@pytest.mark.parametrize("status", ["not eligible", "closed"])
def test_a_tile_that_ruled_lisul_out_offers_fill_it_anyway_and_the_press_goes_to_its_worker(status):
    # Booz Allen (2026-11-04): "why is there no resume button for that".
    with Dashboard(1, NoFrames()) as board:
        board.update(0, **FILLING)
        board.update(0, status=status, why="Screener: Will you graduate in May 2028?",
                     resume={"ok": True, "label": rehearsal.ANYWAY, "why": rehearsal.ANYWAY_WHY})
        shown = board.state()["tiles"][0]
        assert shown["resume"] == {"ok": True, "label": "Fill it anyway", "why": rehearsal.ANYWAY_WHY}
        reply = urllib.request.urlopen(urllib.request.Request(
            board.url + "/resume", json.dumps({"id": "tile-0"}).encode(), {"X-Apply-Token": board.token}))
        assert json.loads(reply.read())["message"].startswith("Filling it anyway")
        assert board.resumed(0)


def test_a_tile_that_ruled_lisul_out_without_the_offer_has_no_button():
    assert "resume" not in tile(status="not eligible", why="Posting requires graduate study: a PhD")
