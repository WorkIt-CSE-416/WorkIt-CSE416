"""Seam 1: Lisul approves a Hold. He edits the held Application's essay in
the Tracker and ticks Approve; a later pass fills the form again from the
Applicant profile plus his text, checks it and submits it."""

import json
import shutil
from pathlib import Path

import pytest
from fakes import FakeClaude, FakeClock, FakeMailbox, Killed, ScriptedUsage
from test_claude_answers import (
    AUTONOMY,
    NOW,
    PROFILE,
    PROJECT,
    SARONIC,
    Browser,
    ResearchForm,
)

from apply.adapters import Adapters
from apply.cli import main
from apply.feed import SimplifyFeed
from apply.fillers import FILLERS
from apply.tracker import InMemoryTracker, Row

EDITED = "I want to build the autonomy stack for Saronic's surface vessels, starting from the planner I wrote for our Micromouse."


class Passes:
    """Runs `apply` again and again over one Tracker and one Feed, as launchd
    would, with Lisul editing the Tracker in between."""

    def __init__(self, monkeypatch, form: ResearchForm, companies: list[str], profile: Path = PROFILE):
        self.form = form
        self.tracker = InMemoryTracker()
        self.companies = companies  # one Match at each, in the Feed
        self._profile = profile
        monkeypatch.setitem(FILLERS, "other", form)

    def _feed(self) -> bytes:
        return json.dumps([{
            "id": f"posting-{n}", "company_name": company, "title": "Software Engineer Intern",
            "url": f"https://jobs.example.com/example/{n}", "category": "Software", "active": True, "is_visible": True,
            "terms": ["Summer 2027"], "locations": ["Torrance, CA"], "degrees": ["Bachelor's"],
            "date_posted": 1_790_000_000 - n, "date_updated": 1_790_000_000 - n,
        } for n, company in enumerate(self.companies, 1)]).encode()

    def run(self, claude: FakeClaude | None = None, *args: str) -> None:
        main([*(args or ["run"]), "--profile", str(self._profile)], adapters=Adapters(
            feed=SimplifyFeed(self._feed), tracker=self.tracker, site=Browser(), claude=claude or FakeClaude(),
            mailbox=FakeMailbox(), usage=ScriptedUsage(), clock=FakeClock(NOW),
        ))

    def row(self, application_id: str = "posting-1") -> Row:
        return self.tracker.get(application_id)

    def sent(self, start: str) -> list[str]:
        """What each submitted Application answered to the question starting `start`."""
        return [answer for sent in self.form.submitted for label, answer in sent.items() if label.startswith(start)]


def held_saronic(monkeypatch) -> Passes:
    passes = Passes(monkeypatch, ResearchForm("Saronic"), ["Saronic"])
    passes.run(FakeClaude(essays={SARONIC: AUTONOMY}))
    assert passes.row().status == "held"
    return passes


def edited(cell: str) -> str:
    return cell.replace(AUTONOMY, EDITED)


def test_an_approved_hold_is_submitted_with_lisuls_edited_essay(monkeypatch):
    passes = held_saronic(monkeypatch)
    passes.tracker.edit_as_lisul("posting-1", essay=edited(passes.row().essay), approve=True)

    passes.run()

    assert passes.row().status == "submitted", passes.row().reason
    assert passes.row().date_applied == NOW.date()
    assert passes.sent(SARONIC) == [EDITED]


def test_an_unapproved_hold_is_never_submitted(monkeypatch):
    passes = held_saronic(monkeypatch)
    passes.tracker.edit_as_lisul("posting-1", essay=edited(passes.row().essay))  # edited, not approved

    passes.run()
    passes.run()

    assert passes.row().status == "held"
    assert passes.form.submitted == []


WRONG_COMPANY = "Based on what is publicly available about Saronic: the essay names Anduril, not Saronic"


def test_an_approved_hold_that_fails_the_presubmit_check_returns_to_held_with_the_reason(monkeypatch):
    passes = held_saronic(monkeypatch)
    passes.tracker.edit_as_lisul("posting-1", essay=edited(passes.row().essay), approve=True)

    passes.run(FakeClaude(reviews=[[WRONG_COMPANY]]))

    assert passes.row().status == "held"
    assert WRONG_COMPANY in passes.row().reason
    assert EDITED in passes.row().essay  # his text is kept
    assert passes.form.submitted == []


def test_an_approved_hold_held_again_is_not_filled_again_on_every_pass(monkeypatch):
    passes = held_saronic(monkeypatch)
    passes.tracker.edit_as_lisul("posting-1", essay=edited(passes.row().essay), approve=True)
    passes.run(FakeClaude(reviews=[[WRONG_COMPANY]]))
    held_again = passes.row()

    passes.run()  # Approve is still ticked, and this time the review would pass
    passes.run()

    assert passes.row() == held_again
    assert passes.form.submitted == []


def held_again(monkeypatch) -> Passes:
    passes = held_saronic(monkeypatch)
    passes.tracker.edit_as_lisul("posting-1", essay=edited(passes.row().essay), approve=True)
    passes.run(FakeClaude(reviews=[[WRONG_COMPANY]]))
    assert passes.row().status == "held"
    return passes


def test_editing_the_essay_of_an_approved_hold_held_again_tries_it_again(monkeypatch):
    passes = held_again(monkeypatch)
    passes.tracker.edit_as_lisul("posting-1", essay=passes.row().essay.replace("surface vessels", "autonomous vessels"))

    passes.run()

    assert passes.row().status == "submitted", passes.row().reason
    assert passes.sent(SARONIC) == [EDITED.replace("surface vessels", "autonomous vessels")]


def test_unticking_approve_for_a_pass_and_ticking_it_again_tries_it_again(monkeypatch):
    passes = held_again(monkeypatch)

    passes.tracker.edit_as_lisul("posting-1", approve=False)
    passes.run()
    passes.tracker.edit_as_lisul("posting-1", approve=True)
    passes.run()

    assert passes.row().status == "submitted", passes.row().reason
    assert passes.sent(SARONIC) == [EDITED]


def test_an_approved_calibration_run_hold_is_submitted_not_held_for_calibration_again(monkeypatch, tmp_path):
    profile = tmp_path / "profile.yaml"  # with no policies.yaml beside it, the Calibration run is 10
    shutil.copy(PROFILE, profile)
    passes = Passes(monkeypatch, ResearchForm("Northwood Space"), ["Example Co"], profile)
    passes.run()
    assert "Calibration run" in passes.row().reason
    passes.tracker.edit_as_lisul("posting-1", approve=True)

    passes.run()

    assert passes.row().status == "submitted", passes.row().reason
    [sent] = passes.sent(PROJECT)
    assert sent.startswith(FakeClaude.DRAFT)  # grown to its question's length


def test_an_approved_target_company_hold_is_submitted(monkeypatch):
    passes = Passes(monkeypatch, ResearchForm("Northwood Space"), ["Stripe"])
    passes.run()
    assert "Target company" in passes.row().reason
    passes.tracker.edit_as_lisul("posting-1", approve=True)

    passes.run()

    assert passes.row().status == "submitted", passes.row().reason


class DiesFilling(ResearchForm):
    """The run dies while this form is filled for the `dies_on`-th time."""

    def __init__(self, company: str, dies_on: int):
        super().__init__(company)
        self._fills = 0
        self._dies_on = dies_on

    def fill(self, page, questions, answers):
        self._fills += 1
        if self._fills == self._dies_on:
            raise Killed()
        return super().fill(page, questions, answers)


def test_an_approved_hold_whose_run_died_is_resumed_with_lisuls_essay(monkeypatch):
    passes = Passes(monkeypatch, DiesFilling("Saronic", dies_on=2), ["Saronic"])
    passes.run(FakeClaude(essays={SARONIC: AUTONOMY}))
    passes.tracker.edit_as_lisul("posting-1", essay=edited(passes.row().essay), approve=True)
    with pytest.raises(Killed):
        passes.run()

    passes.run(FakeClaude(essays={SARONIC: AUTONOMY}))

    assert passes.row().status == "submitted", passes.row().reason
    assert passes.sent(SARONIC) == [EDITED]


def test_an_approve_pass_submits_approved_holds_and_applies_to_nothing_else(monkeypatch):
    passes = held_saronic(monkeypatch)
    passes.tracker.edit_as_lisul("posting-1", essay=edited(passes.row().essay), approve=True)
    passes.companies.append("Northwood Space")  # a new Match
    passes.tracker.paste_request("https://jobs.example.com/example/request")

    passes.run(None, "approve-pass")

    assert passes.row().status == "submitted", passes.row().reason
    assert passes.sent(SARONIC) == [EDITED]
    assert [row.application_id for row in passes.tracker.rows()] == ["posting-1"]
    assert passes.tracker.requests() == ["https://jobs.example.com/example/request"]


def test_an_approved_hold_whose_essay_lisul_emptied_is_held_again_not_sent_blank(monkeypatch):
    passes = held_saronic(monkeypatch)
    passes.tracker.edit_as_lisul("posting-1", essay=passes.row().essay.replace(AUTONOMY, ""), approve=True)

    passes.run()

    assert passes.row().status == "held"
    assert "nothing for" in passes.row().reason and SARONIC in passes.row().reason
    assert passes.form.submitted == []
