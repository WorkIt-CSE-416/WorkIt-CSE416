"""Never stuck with no way on (KAN-594): while a rehearsal fills, its tile
says what Apply is doing, and offers Resume whenever Apply waits on Claude,
the page shows a field error, or the fill makes no progress for a while.
Resume stops the wait, keeps what Lisul put on the page, and goes on from
it. Nothing is ever submitted."""

import json
import os
import time

import pytest
from fake_workday import STEPS, FakeWorkdayServer, Field
from fakes import FakeClaude, RecordingBoard
from test_employer_accounts import XCEL_FORM, XCEL_URL, World
from test_rehearse import NeverSubmittingWorkday, adapters

from apply import rehearsal, stuck
from apply.claude_cli import run_claude
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
