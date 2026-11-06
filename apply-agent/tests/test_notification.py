"""Seam 1 for the run notification: whole `apply run`s, read off the
notifications Lisul would see."""

import json
import os
import threading
from datetime import date

import pytest
from conftest import FIXTURES
from fakes import FakeClaude, FakeClock, FakeMailbox, ScriptedUsage
from test_matches import NOW, NoBrowser, feed_record

from apply.adapters import Adapters
from apply.cli import main
from apply.feed import SimplifyFeed
from apply.fillers import FILLERS
from apply.model import Question
from apply.notify import MacNotifier, RecordingNotifier
from apply.tracker import EmployerAccount, InMemoryTracker


class ScriptedFiller:
    """Stand-in Filler: a one-question form whose page drops the answer at
    `garbled` URLs, and whose submit at `signs_up` URLs also creates an
    Employer account. Each Worker carries one Application on its own thread,
    so the URL being filled is kept per thread."""

    def __init__(self, tracker: InMemoryTracker, garbled=(), signs_up=(), more=()):
        self._tracker, self._garbled, self._signs_up = tracker, set(garbled), set(signs_up)
        self._more = list(more)  # questions besides Email
        self._worker = threading.local()

    def question_set(self, url, site):
        self._worker.url = url
        return [Question("email", "Email", "text"), *self._more]

    def fill(self, page, questions, answers):
        return {} if self._worker.url in self._garbled else dict(answers)

    def submit(self, page):
        if self._worker.url in self._signs_up:
            self._tracker.add_employer_account(EmployerAccount("Acme", self._worker.url, "test.person@example.com", NOW.date()))


def run(monkeypatch, records: list[dict], garbled=(), signs_up=(), tracker=None, more=()) -> RecordingNotifier:
    tracker = tracker or InMemoryTracker()
    notifier = RecordingNotifier()
    monkeypatch.setitem(FILLERS, "other", ScriptedFiller(tracker, garbled, signs_up, more))
    main(
        ["run", "--profile", str(FIXTURES / "profile.yaml")],
        adapters=Adapters(
            feed=SimplifyFeed(lambda: json.dumps(records).encode()),
            tracker=tracker,
            site=NoBrowser(),
            claude=FakeClaude(),
            mailbox=FakeMailbox(),
            usage=ScriptedUsage(),
            clock=FakeClock(NOW),
            notifier=notifier,
        ),
    )
    return notifier


def test_a_run_ends_with_one_notification_counting_what_it_did(monkeypatch):
    a, b, c = feed_record(), feed_record(), feed_record()
    tracker = InMemoryTracker()
    tracker.add_employer_account(EmployerAccount("Old", "https://old.example.com", "x@example.com", date(2026, 9, 1)))

    notifier = run(monkeypatch, [a, b, c], garbled=[b["url"]], signs_up=[c["url"]], tracker=tracker)

    assert notifier.sent == [
        ("Apply run finished", "2 submitted, 1 held, 0 handoff, 0 missing fact, 1 new Employer account"),
    ]


def test_a_run_with_nothing_to_do_still_says_so(monkeypatch):
    notifier = run(monkeypatch, [])

    assert notifier.sent == [
        ("Apply run finished", "0 submitted, 0 held, 0 handoff, 0 missing fact, 0 new Employer accounts"),
    ]


HOUSING = Question("housing", "Do you have housing within 30 miles of our office?", "select", True, ("Yes", "No"))
FLEX = Question("flex", "Are you able to work 10 consecutive weeks?", "select", True, ("Yes", "No"))


def test_the_notification_lists_each_answer_claude_drafted_for_lisul_to_review(monkeypatch):
    a, b = feed_record(), feed_record()

    notifier = run(monkeypatch, [a, b], more=[HOUSING, FLEX])  # both Applications ask; the second reuses the bank

    # The two Workers race: whether the second finds the first's drafts in the bank decides only the "used again" tail.
    [(title, body)] = notifier.sent
    assert title == "Apply run finished"
    assert body.startswith(
        "2 submitted, 0 held, 0 handoff, 0 missing fact, 0 new Employer accounts. "
        "Review 2 answers Claude drafted: Do you have housing within 30 miles of our office? → Yes; "
        "Are you able to work 10 consecutive weeks? → Yes"
    )


@pytest.mark.skipif(not os.environ.get("APPLY_TEST_NOTIFY"), reason="set APPLY_TEST_NOTIFY=1 to show a real macOS notification")
def test_a_real_macos_notification_shows_quotes_and_backslashes_as_written():
    MacNotifier().notify('Apply "test"', "1 submitted, \\ 'quoted' \"text\"")
