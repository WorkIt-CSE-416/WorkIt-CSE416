"""The Daily cap: a run stops taking new Matches once policies.yaml's
daily_cap of them were applied to (submitted or held) today. Requests and
approved Holds go ahead past it."""

import json
from datetime import datetime, timedelta
from pathlib import Path

from fakes import FakeClaude, FakeClock, FakeMailbox, ScriptedUsage
from test_claude_answers import NOW, PROFILE, Browser, ResearchForm

from apply.adapters import Adapters
from apply.cli import main
from apply.feed import SimplifyFeed
from apply.fillers import FILLERS
from apply.tracker import InMemoryTracker


class Runs:
    """`apply run` again and again over one Tracker, with one Match at each
    company in `companies`, under the policies given."""

    def __init__(self, monkeypatch, tmp_path: Path, policies: str):
        self.profile = tmp_path / "profile.yaml"
        self.profile.write_text(PROFILE.read_text())
        (tmp_path / "policies.yaml").write_text(policies)
        self.form = ResearchForm("Northwood Space")
        self.tracker = InMemoryTracker()
        self.companies: list[str] = []
        monkeypatch.setitem(FILLERS, "other", self.form)

    def run(self, *companies: str, now: datetime = NOW) -> dict[str, str]:
        """Run over a Feed of `companies` (newest first); each row's status, by company."""
        self.companies = list(companies)
        main(["run", "--profile", str(self.profile)], adapters=Adapters(
            feed=SimplifyFeed(self._feed), tracker=self.tracker, site=Browser(), claude=FakeClaude(),
            mailbox=FakeMailbox(), usage=ScriptedUsage(), clock=FakeClock(now),
        ))
        return {row.company: row.status for row in self.tracker.rows()}

    def _feed(self) -> bytes:
        return json.dumps([{
            "id": f"posting-{company}", "company_name": company, "title": "Software Engineer Intern",
            "url": f"https://jobs.example.com/example/{company}", "category": "Software", "active": True,
            "is_visible": True, "terms": ["Summer 2027"], "locations": ["Torrance, CA"], "degrees": ["Bachelor's"],
            "date_posted": 1_790_000_000 - n, "date_updated": 1_790_000_000 - n,
        } for n, company in enumerate(self.companies, 1)]).encode()


def test_a_run_stops_taking_matches_at_the_daily_cap_and_says_so(monkeypatch, tmp_path, capsys):
    runs = Runs(monkeypatch, tmp_path, "daily_cap: 2\ncalibration_run: 0\n")

    statuses = runs.run("Alpha", "Bravo", "Charlie", "Delta")

    assert statuses == {"Alpha": "submitted", "Bravo": "submitted"}
    assert "Daily cap reached: 2 new Matches applied to today (policies.yaml: daily_cap)" in capsys.readouterr().out


def test_matches_held_or_submitted_earlier_today_count_toward_the_cap(monkeypatch, tmp_path):
    runs = Runs(monkeypatch, tmp_path, "daily_cap: 3\ncalibration_run: 1\n")
    assert runs.run("Alpha") == {"Alpha": "held"}  # the Calibration run's one Hold
    assert runs.run("Alpha", "Bravo") == {"Alpha": "held", "Bravo": "submitted"}

    statuses = runs.run("Alpha", "Bravo", "Charlie", "Delta")

    assert statuses == {"Alpha": "held", "Bravo": "submitted", "Charlie": "submitted"}


def test_a_new_day_starts_a_new_count(monkeypatch, tmp_path):
    runs = Runs(monkeypatch, tmp_path, "daily_cap: 1\ncalibration_run: 0\n")
    runs.run("Alpha", "Bravo")

    statuses = runs.run("Alpha", "Bravo", now=NOW + timedelta(days=1))

    assert statuses == {"Alpha": "submitted", "Bravo": "submitted"}


def test_requests_are_applied_to_past_the_cap(monkeypatch, tmp_path):
    runs = Runs(monkeypatch, tmp_path, "daily_cap: 1\ncalibration_run: 0\n")
    runs.run("Alpha")
    runs.tracker.add_request("https://jobs.example.com/example/request")

    runs.run("Alpha", "Bravo")

    [request] = [row for row in runs.tracker.rows() if row.posting_url.endswith("/request")]
    assert request.status in ("submitted", "held"), request.reason  # filled either way (with no company, its essay holds it)
    assert "Bravo" not in {row.company for row in runs.tracker.rows()}


def test_an_approved_hold_is_submitted_past_the_cap(monkeypatch, tmp_path):
    runs = Runs(monkeypatch, tmp_path, "daily_cap: 2\ncalibration_run: 1\n")
    first = runs.run("Alpha", "Bravo")  # one held for the Calibration run, one submitted: the cap is reached
    # Two Workers fill at once, so either may be the one held.
    [held] = [company for company, status in first.items() if status == "held"]
    runs.tracker.edit_as_lisul(f"posting-{held}", approve=True)

    statuses = runs.run("Alpha", "Bravo", "Charlie")

    assert statuses == {"Alpha": "submitted", "Bravo": "submitted"}
