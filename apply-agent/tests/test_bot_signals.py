"""Bot signals: what a job system did that suggests it took a Worker's
browser for a bot, noted on each Tracker row beside how the browser ran."""

import json

from conftest import FIXTURES
from fakes import FakeClaude, FakeClock, FakeMailbox, ScriptedUsage
from test_matches import NOW, NoBrowser, feed_record

from apply.adapters import Adapters
from apply.cli import main
from apply.feed import SimplifyFeed
from apply.fillers import FILLERS
from apply.model import Question, Status
from apply.tracker import InMemoryTracker, Row


class SecurityCodeFiller:
    """Stand-in Filler whose job system asks for an emailed code after the
    submit click, as Greenhouse does, before it takes the form."""

    def question_set(self, url, site):
        return [Question("email", "Email", "text")]

    def fill(self, page, questions, answers):
        return dict(answers)

    def submit(self, page):
        return ("security code",)


def run(monkeypatch, filler, *records: dict) -> InMemoryTracker:
    tracker = InMemoryTracker()
    monkeypatch.setitem(FILLERS, "other", filler)
    main(["run", "--profile", str(FIXTURES / "profile.yaml")], adapters=Adapters(
        feed=SimplifyFeed(lambda: json.dumps(list(records)).encode()), tracker=tracker, site=NoBrowser(),
        claude=FakeClaude(), mailbox=FakeMailbox(), usage=ScriptedUsage(), clock=FakeClock(NOW),
    ))
    return tracker


def test_a_submit_that_met_a_bot_signal_on_the_way_notes_it_on_the_submitted_row(monkeypatch):
    tracker = run(monkeypatch, SecurityCodeFiller(), feed_record())

    [row] = tracker.rows()
    assert row.status == "submitted"
    assert row.bot_signals == "headless: security code"


def tracked(*rows: tuple[str, str, Status, str]) -> InMemoryTracker:
    tracker = InMemoryTracker()
    for n, (job_system, signals, status, reason) in enumerate(rows):
        tracker.add(Row(f"id-{n}", f"Company {n}", "Intern", f"https://example.com/{n}", job_system, status,
                        reason=reason, bot_signals=signals))
    return tracker


def signals(tracker, capsys) -> str:
    main(["signals"], adapters=Adapters(feed=None, tracker=tracker, site=None, claude=None, mailbox=None,
                                        usage=None, clock=None))
    return capsys.readouterr().out


def test_apply_signals_counts_each_bot_signal_per_mode_and_job_system(capsys):
    tracker = tracked(
        ("greenhouse", "headless", Status.SUBMITTED, ""),
        ("greenhouse", "headless: security code", Status.SUBMITTED, ""),
        ("greenhouse", "headless: captcha", Status.HANDOFF, "A captcha challenge came up"),
        ("ashby", "headless: refused", Status.HANDOFF, "Ashby refused the submission"),
        ("ashby", "headed", Status.SUBMITTED, ""),
        ("greenhouse", "headed: security code", Status.SUBMITTED, ""),
        ("lever", "", Status.CLOSED, "Closed"),  # no browser ever opened: not counted
    )

    assert signals(tracker, capsys) == (
        "Bot signals per filled Application, by how the Workers' Chrome ran:\n"
        "headless: 4 Applications; captcha 1, refused 1, security code 1\n"
        "  ashby: 1 Application; refused 1\n"
        "  greenhouse: 3 Applications; captcha 1, security code 1\n"
        "headed: 2 Applications; security code 1\n"
        "  ashby: 1 Application; none\n"
        "  greenhouse: 1 Application; security code 1\n"
    )


def test_apply_signals_with_nothing_filled_yet_says_so(capsys):
    tracker = tracked(("lever", "", Status.CLOSED, "Closed"))

    assert "No filled Applications" in signals(tracker, capsys)
