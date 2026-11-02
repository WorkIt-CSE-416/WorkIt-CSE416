"""Seam 1: whole `apply run`s on forms that show their questions one step at
a time, as Workday does once signed in. A stand-in Filler plays such a form
with no browser: each step's questions are revealed only once the step
before is filled."""

import json
import threading

from conftest import FIXTURES
from fakes import FakeClaude, FakeClock, FakeMailbox, ScriptedUsage
from test_matches import NOW, NoBrowser, feed_record

from apply.adapters import Adapters
from apply.cli import main
from apply.feed import SimplifyFeed
from apply.fillers import FILLERS, MoreQuestions
from apply.model import Question
from apply.tracker import InMemoryTracker, Row

PROFILE = FIXTURES / "planner-profile.yaml"
NAME = Question("first", "First Name", "text", required=True)
SPONSOR = Question("sponsor", "Will you now or in the future require sponsorship?", "select", True, ("Yes", "No"))
ENGINE = Question("engine", "Which rocket engine have you tested?", "text", required=True)
WHY = Question("why", "Why do you want to work on rockets?", "textarea", required=True)


class SteppedForm:
    """A form in steps. The Question set holds the first step; fill() fills
    the current step, then reveals the next one's questions it wasn't given."""

    def __init__(self, *steps: list[Question]):
        self._steps = steps
        self._at = threading.local()
        self.submitted: list[dict] = []

    def question_set(self, url, site):
        self._at.step = 0
        self._at.sent = {}
        return list(self._steps[0])

    def fill(self, page, questions, answers):
        known = {q.name for q in questions}
        while True:
            step = self._steps[self._at.step]
            self._at.sent |= {q.name: answers[q.name] for q in step if q.name in answers}
            if self._at.step + 1 == len(self._steps):
                return dict(self._at.sent)
            self._at.step += 1
            unseen = [q for q in self._steps[self._at.step] if q.name not in known]
            if unseen:
                raise MoreQuestions(unseen)

    def submit(self, page):
        self.submitted.append(dict(self._at.sent))


def run(monkeypatch, form: SteppedForm, claude: FakeClaude | None = None, tracker: InMemoryTracker | None = None) -> Row:
    tracker = tracker or InMemoryTracker()
    monkeypatch.setitem(FILLERS, "other", form)
    main(["run", "--profile", str(PROFILE)], adapters=Adapters(
        feed=SimplifyFeed(lambda: json.dumps([feed_record(id="stepped", company_name="Acme")]).encode()),
        tracker=tracker, site=NoBrowser(), claude=claude or FakeClaude(),
        mailbox=FakeMailbox(), usage=ScriptedUsage(), clock=FakeClock(NOW),
    ))
    return tracker.get("stepped")


def test_questions_a_later_step_reveals_are_planned_and_sent(monkeypatch):
    form = SteppedForm([NAME], [SPONSOR])

    row = run(monkeypatch, form)

    assert row.status == "submitted"
    assert form.submitted == [{"first": "Test", "sponsor": "No"}]


def test_a_later_steps_one_off_question_is_drafted_by_claude(monkeypatch):
    form = SteppedForm([NAME], [SPONSOR], [ENGINE])

    row = run(monkeypatch, form, FakeClaude(drafts={"Which rocket engine": "None yet"}))

    assert row.status == "submitted", row.reason
    assert form.submitted == [{"first": "Test", "sponsor": "No", "engine": "None yet"}]


def test_a_later_steps_question_claude_cannot_answer_is_a_missing_fact(monkeypatch):
    form = SteppedForm([NAME], [SPONSOR], [ENGINE])

    row = run(monkeypatch, form, FakeClaude(needs_lisul=[ENGINE.label]))

    assert (row.status, row.missing_fact) == ("missing fact", ENGINE.label)
    assert form.submitted == []


def test_a_later_steps_essay_is_written_by_claude(monkeypatch):
    form = SteppedForm([NAME], [WHY])
    claude = FakeClaude()  # its default essay is grown to the question's length, so it passes the gates

    row = run(monkeypatch, form, claude)

    assert row.status == "submitted", row.reason
    [sent] = form.submitted
    assert sent["first"] == "Test" and sent["why"].startswith(FakeClaude.DRAFT)


def test_a_field_claude_rescued_is_submitted_and_asks_for_a_repair(monkeypatch):
    form = SteppedForm([NAME], [SPONSOR])
    form.rescued = ["Will you now or in the future require sponsorship?: the Filler failed (TimeoutError: click), "
                    "and Claude filled it live"]
    monkeypatch.setitem(FILLERS, "other", form)
    tracker = InMemoryTracker()
    adapters = Adapters(
        feed=SimplifyFeed(lambda: json.dumps([feed_record(id="stepped", company_name="Acme")]).encode()),
        tracker=tracker, site=NoBrowser(), claude=FakeClaude(),
        mailbox=FakeMailbox(), usage=ScriptedUsage(), clock=FakeClock(NOW),
    )

    main(["run", "--profile", str(PROFILE)], adapters=adapters)

    assert tracker.get("stepped").status == "submitted"
    [request] = adapters.repairs.all()
    assert request.problems == form.rescued
