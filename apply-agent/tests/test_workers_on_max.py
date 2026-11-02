"""Seam 1: whole runs with several Workers, Max usage limits and interruptions."""

from datetime import datetime

import pytest
from conftest import ARC_FORM, ARC_URL, FIXTURES
from fakes import (
    FakeClaude,
    FakeClock,
    FakeJobServer,
    FakeMailbox,
    Killed,
    RecordingBoard,
    ScriptedUsage,
)
from test_claude_answers import ResearchForm
from test_claude_answers import run as run_form

from apply.adapters import Adapters, UsageReading
from apply.cli import main
from apply.model import Posting
from apply.orchestrator import INTERRUPTED_SUBMIT
from apply.tracker import InMemoryTracker

START = datetime(2026, 10, 15, 9, 30)
RESET = datetime(2026, 10, 16, 10, 0)  # a day later, so it shows in Date applied


class PostingsFeed:
    """A Feed of `count` Postings at different companies. All are copies of
    the saved Arc form (FakeJobServer ignores the `copy` parameter)."""

    def __init__(self, count: int):
        self._postings = [
            Posting(id=f"posting-{n}", company=f"Company {n}", title="Software Engineer Intern", url=f"{ARC_URL}?copy={n}")
            for n in range(1, count + 1)
        ]

    def postings(self) -> list[Posting]:
        return self._postings


def run(job_server, *, postings=3, workers=3, usage=None, clock=None, tracker=None, **more) -> InMemoryTracker:
    tracker = tracker if tracker is not None else InMemoryTracker()
    adapters = Adapters(
        feed=PostingsFeed(postings),
        tracker=tracker,
        site=job_server,
        claude=FakeClaude(),
        mailbox=FakeMailbox(),
        usage=usage or ScriptedUsage(),
        clock=clock or FakeClock(START),
        **more,
    )
    main(["run", "--profile", str(FIXTURES / "profile.yaml"), "--workers", str(workers)], adapters=adapters)
    return tracker


def statuses(tracker: InMemoryTracker) -> dict[str, str]:
    return {row.application_id: str(row.status) for row in tracker.rows()}


def test_workers_fill_in_parallel_each_in_its_own_worker_profile():
    # Every form waits until three are open at once, so this only passes if
    # three Workers fill at the same time.
    with FakeJobServer(ARC_FORM, together=3) as job_server:
        tracker = run(job_server, postings=3, workers=3)

    assert statuses(tracker) == {f"posting-{n}": "submitted" for n in (1, 2, 3)}
    assert len(job_server.submissions) == 3
    assert sorted(job_server.workers) == [0, 1, 2]


@pytest.mark.parametrize("used", [
    UsageReading(five_hour=0.85, five_hour_resets_at=RESET, weekly=0.2),
    UsageReading(five_hour=0.2, weekly=0.70, weekly_resets_at=RESET),
], ids=["85% of the five-hour window", "70% of the week"])
def test_no_application_starts_past_a_threshold_until_the_window_resets(used):
    clock = FakeClock(START)
    with FakeJobServer(ARC_FORM) as job_server:
        # The first Application pushes usage past the threshold until RESET.
        usage = ScriptedUsage(lambda: used if job_server.submissions and clock.now() < RESET else UsageReading())
        tracker = run(job_server, postings=2, workers=1, usage=usage, clock=clock)

    assert clock.slept == [RESET]
    assert statuses(tracker) == {"posting-1": "submitted", "posting-2": "submitted"}
    dates = {row.application_id: row.date_applied for row in tracker.rows()}
    assert dates == {"posting-1": START.date(), "posting-2": RESET.date()}
    assert len(job_server.submissions) == 2


def test_a_pause_at_a_usage_limit_tells_the_window_when_the_run_goes_on():
    clock, board = FakeClock(START), RecordingBoard()
    used = UsageReading(five_hour=0.85, five_hour_resets_at=RESET, weekly=0.2)
    with FakeJobServer(ARC_FORM) as job_server:
        usage = ScriptedUsage(lambda: used if job_server.submissions and clock.now() < RESET else UsageReading())
        run(job_server, postings=2, workers=1, usage=usage, clock=clock, board=board)

    assert (board.runs[0]["mode"], board.runs[0]["queued"], board.runs[0]["today"]) == ("run", 2, 0)
    paused = board.runs.index({"paused_until": RESET.isoformat(timespec="minutes")})
    assert board.runs[paused + 1] == {"paused_until": None}


def test_applications_keep_starting_just_under_the_thresholds():
    clock = FakeClock(START)
    usage = ScriptedUsage(lambda: UsageReading(five_hour=0.84, weekly=0.69, five_hour_resets_at=RESET))
    with FakeJobServer(ARC_FORM) as job_server:
        tracker = run(job_server, postings=2, workers=1, usage=usage, clock=clock)

    assert clock.slept == []
    assert {row.date_applied for row in tracker.rows()} == {START.date()}


def test_a_limit_hit_pauses_every_worker_then_resumes_after_the_reset():
    paused_rows = []
    clock = FakeClock(START, on_sleep=lambda: paused_rows.append(statuses(tracker)))
    tracker = InMemoryTracker()
    with FakeJobServer(ARC_FORM, together=3) as job_server:
        # The limit is hit while all three Workers have a form open.
        usage = ScriptedUsage(lambda: (
            UsageReading(five_hour=1.0, limited=True, resets_at=RESET)
            if len(job_server.workers) >= 3 and clock.now() < RESET else UsageReading()
        ))
        run(job_server, postings=3, workers=3, usage=usage, clock=clock, tracker=tracker)

    assert paused_rows == [{f"posting-{n}": "paused" for n in (1, 2, 3)}]
    assert clock.slept == [RESET]
    assert statuses(tracker) == {f"posting-{n}": "submitted" for n in (1, 2, 3)}
    assert {row.date_applied for row in tracker.rows()} == {RESET.date()}
    assert len(job_server.submissions) == 3


def test_a_second_run_never_reapplies():
    tracker = InMemoryTracker()
    with FakeJobServer(ARC_FORM) as job_server:
        run(job_server, postings=1, tracker=tracker)
        run(job_server, postings=1, tracker=tracker)

    assert statuses(tracker) == {"posting-1": "submitted"}
    assert len(job_server.submissions) == 1


def test_a_run_killed_mid_application_is_finished_by_the_next_run_with_one_submission():
    tracker = InMemoryTracker()
    with FakeJobServer(ARC_FORM, kill="open") as job_server:
        with pytest.raises(Killed):
            run(job_server, postings=1, tracker=tracker)
        assert job_server.submissions == []

        run(job_server, postings=1, tracker=tracker)

    assert statuses(tracker) == {"posting-1": "submitted"}
    assert len(job_server.submissions) == 1


def test_a_run_killed_just_after_submitting_is_never_submitted_again():
    tracker = InMemoryTracker()
    with FakeJobServer(ARC_FORM, kill="submit") as job_server:
        with pytest.raises(Killed):
            run(job_server, postings=1, tracker=tracker)

        run(job_server, postings=1, tracker=tracker)

    assert len(job_server.submissions) == 1
    [row] = tracker.rows()
    assert row.status == "handoff"
    assert "may have been submitted" in row.reason


class SubmitBreaks(ResearchForm):
    """The submit click goes out, then the confirmation never shows."""

    def submit(self, page):
        super().submit(page)
        raise TimeoutError("no confirmation in 30 s")


def test_a_submit_that_errors_is_a_handoff_that_may_have_been_submitted(monkeypatch):
    form = SubmitBreaks("Northwood Space")

    row = run_form(monkeypatch, form, FakeClaude())

    assert len(form.submitted) == 1
    assert row.status == "handoff"
    assert row.reason.startswith(INTERRUPTED_SUBMIT)
    assert "TimeoutError" in row.reason
