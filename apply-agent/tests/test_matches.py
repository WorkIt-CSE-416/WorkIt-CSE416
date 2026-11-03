"""Seam 1 for the Match queue: whole `apply run`s over a fixture Feed. Which
Postings become Applications, and in what order, is read off the Tracker rows.

Every job system here is filled by a stand-in Filler with an empty form, so
these runs need no browser: they test which Matches are applied to, not how.
"""

import itertools
import json
from contextlib import contextmanager
from datetime import date, datetime
from pathlib import Path

import pytest
from conftest import FIXTURES
from fakes import FakeClaude, FakeClock, FakeMailbox, ScriptedUsage
from test_run_answers import profile_with

from apply.adapters import Adapters
from apply.cli import main
from apply.feed import SimplifyFeed
from apply.fillers import FILLERS
from apply.model import Status
from apply.tracker import InMemoryTracker, Row

NOW = datetime(2026, 10, 15, 9, 30)
DAY = 86_400
_ids = itertools.count(1)


def feed_record(**fields) -> dict:
    """One Feed record that is a Match unless `fields` say otherwise."""
    n = next(_ids)
    record = {
        "id": f"id-{n}",
        "company_name": f"Company {n}",
        "title": "Software Engineer Intern",
        "url": f"https://jobs.example.com/company-{n}/{n}",
        "category": "Software",
        "active": True,
        "is_visible": True,
        "terms": ["Summer 2027"],
        "locations": ["Torrance, CA"],
        "degrees": ["Bachelor's"],
        "date_posted": 1_790_000_000 - n * DAY,
        "date_updated": 1_790_000_000 - n * DAY,
    }
    return record | fields


class EmptyFormFiller:
    """A Filler for a form with no questions. Submitting always works."""

    def question_set(self, url, site):
        return []

    def fill(self, page, questions, answers):
        return {}

    def submit(self, page):
        pass


class BlankPage:
    """A page with nothing on it but a screenshot for the Record."""

    def screenshot(self, **options) -> bytes:
        return b"\x89PNG\r\n\x1a\n"


class NoBrowser:
    """A JobSite whose pages are never looked at."""

    def fetch(self, url):
        raise LookupError(url)

    @contextmanager
    def open(self, url, worker=0):
        yield BlankPage()


def run(monkeypatch, *records: dict, tracker: InMemoryTracker | None = None, profile: Path = FIXTURES / "profile.yaml",
        ) -> list[Row]:
    """One `apply run` over a Feed of `records`. Returns the rows it added, in order."""
    feed = SimplifyFeed(lambda: json.dumps(list(records)).encode())
    for posting in feed.postings():
        monkeypatch.setitem(FILLERS, posting.job_system, EmptyFormFiller())
    tracker = tracker or InMemoryTracker()
    before = {row.application_id for row in tracker.rows()}
    main(
        ["run", "--profile", str(profile)],
        adapters=Adapters(
            feed=feed,
            tracker=tracker,
            site=NoBrowser(),
            claude=FakeClaude(),
            mailbox=FakeMailbox(),
            usage=ScriptedUsage(),
            clock=FakeClock(NOW),
        ),
    )
    return [row for row in tracker.rows() if row.application_id not in before]


def applied_to(rows: list[Row]) -> list[str]:
    return [row.application_id for row in rows]


def test_only_matches_become_applications(monkeypatch):
    rows = run(
        monkeypatch,
        feed_record(id="match"),
        feed_record(id="closed", active=False),
        feed_record(id="hidden", is_visible=False),
        feed_record(id="summer 2026", terms=["Summer 2026"]),
        feed_record(id="no term", terms=["N/A"]),
        feed_record(id="product", category="Product", title="AI Product Intern"),
        feed_record(id="london", locations=["London, UK"]),
        feed_record(id="toronto", locations=["Toronto, ON, Canada"]),
        feed_record(id="phd only", degrees=["Master's", "PhD"]),
        feed_record(id="masters title", title="Software Engineer Intern (Master's)"),
        feed_record(id="analytics", category="AI/ML/Data", title="Data Analytics Intern"),
        feed_record(id="bi", category="AI/ML/Data", title="Business Intelligence Intern"),
        feed_record(id="ml", category="AI/ML/Data", title="Machine Learning Intern"),
        feed_record(id="data scientist", category="AI/ML/Data", title="Data Scientist Intern"),
        feed_record(id="analytics engineer", category="AI/ML/Data", title="Analytics Engineer Intern"),
        feed_record(id="legacy category", category="Software Engineering"),
        feed_record(id="firmware", category="Hardware", title="Firmware Engineer Intern"),
        feed_record(id="embedded", category="Hardware", title="Embedded Software Engineer Intern"),
        feed_record(id="circuits", category="Hardware", title="Circuit Design Intern"),
        feed_record(id="quant dev", category="Quant", title="Quantitative Developer Intern"),
        feed_record(id="trader", category="Quant", title="Quantitative Trader Intern"),
        feed_record(id="it support", title="IT Support Intern"),
        feed_record(id="remote us", locations=["Remote in USA"]),
        feed_record(id="nyc", locations=["NYC"]),
        feed_record(id="state name", locations=["Wisconsin"]),
        feed_record(id="lowercase state", locations=["Carlsbad, Ca"]),
        feed_record(id="one of several", locations=["London, UK", "Austin, TX"]),
        feed_record(id="no degrees listed", degrees=[]),
        feed_record(id="multi term", terms=["Fall 2026", "Summer 2027"]),
    )

    assert sorted(applied_to(rows)) == sorted([
        "match", "ml", "data scientist", "analytics engineer", "legacy category",
        "firmware", "embedded", "quant dev", "remote us", "nyc", "state name",
        "lowercase state", "one of several", "no degrees listed", "multi term",
    ])


def test_matches_are_applied_to_newest_posted_first_then_newest_updated(monkeypatch):
    day = 1_790_000_000
    rows = run(
        monkeypatch,
        feed_record(id="older", date_posted=day - DAY, date_updated=day),
        feed_record(id="newest, updated earlier", date_posted=day, date_updated=day + 100),
        feed_record(id="oldest, over 60 days", date_posted=day - 90 * DAY, date_updated=day - 90 * DAY),
        feed_record(id="newest, updated later", date_posted=day, date_updated=day + 200),
    )

    assert applied_to(rows) == [
        "newest, updated later", "newest, updated earlier", "older", "oldest, over 60 days",
    ]


def tracked(application_id: str, url: str, *, company: str = "Earlier Co", role: str = "Earlier Intern",
            status: Status = Status.SUBMITTED, date_applied: date | None = date(2026, 9, 1)) -> Row:
    """A Tracker row from an earlier run."""
    return Row(application_id=application_id, company=company, role=role, posting_url=url,
               job_system="other", status=status, date_applied=date_applied)


def test_a_repost_of_an_earlier_application_is_not_applied_to_again(monkeypatch):
    tracker = InMemoryTracker()
    tracker.add(tracked("applied", "https://jobs.example.com/acme/123"))
    tracker.add(tracked("held", "https://jobs.lever.co/beta/abc", status=Status.HELD, date_applied=None))
    tracker.add(tracked("workday", "https://salesforce.wd12.myworkdayjobs.com/External_Career_Site/job/CA/Intern_JR340771"))

    rows = run(
        monkeypatch,
        feed_record(id="applied"),
        feed_record(id="same url, new id", url="https://jobs.example.com/acme/123/apply?utm_source=Simplify&ref=Simplify"),
        feed_record(id="same url, held", url="https://jobs.lever.co/beta/abc/apply"),
        feed_record(id="same req, other site",
                url="https://salesforce.wd12.myworkdayjobs.com/en-US/Futureforce_Internships/job/San-Francisco/Intern_JR340771-1"),
        feed_record(id="new role", url="https://jobs.example.com/acme/124"),
        tracker=tracker,
    )

    assert applied_to(rows) == ["new role"]


def test_a_role_listed_twice_in_the_feed_is_applied_to_once_on_its_newest_posting(monkeypatch):
    rows = run(
        monkeypatch,
        feed_record(id="older site", date_posted=1_000,
                url="https://salesforce.wd12.myworkdayjobs.com/External_Career_Site/job/CA/Intern_JR340771"),
        feed_record(id="newer site", date_posted=2_000,
                url="https://salesforce.wd12.myworkdayjobs.com/Futureforce_Internships/job/CA/Intern_JR340771-1"),
        feed_record(id="older url", date_posted=1_000, url="https://jobs.example.com/acme/123"),
        feed_record(id="newer url", date_posted=2_000, url="https://jobs.example.com/acme/123/"),
        feed_record(id="embed token 1", url="https://boards.greenhouse.io/embed/job_app?token=7905463"),
        feed_record(id="embed token 2", url="https://boards.greenhouse.io/embed/job_app?token=8003019"),
        feed_record(id="dashed req", url="https://expedia.wd108.myworkdayjobs.com/private/job/Austin/ML-Intern_R-98585"),
        feed_record(id="other dashed req", url="https://expedia.wd108.myworkdayjobs.com/private/job/Austin/ML-Intern_R-98586"),
    )

    assert sorted(applied_to(rows)) == sorted([
        "newer site", "newer url", "embed token 1", "embed token 2", "dashed req", "other dashed req",
    ])


def test_one_title_at_one_company_is_applied_to_once_on_its_newest_req(monkeypatch):
    tracker = InMemoryTracker()
    tracker.add(tracked("earlier", "https://jobs.example.com/booz/1", company="Booz Allen", role="Software Developer Intern"))

    rows = run(
        monkeypatch,
        feed_record(id="older req", company_name="Optiver", title="Software Engineer Intern", date_posted=1_000),
        feed_record(id="newest req", company_name="Optiver", title="Software Engineer Intern", date_posted=3_000),
        feed_record(id="same title, other spacing", company_name="optiver", title="Software  Engineer intern", date_posted=2_000),
        feed_record(id="other title", company_name="Optiver", title="Machine Learning Intern", date_posted=1_000),
        feed_record(id="same title, other company", company_name="TikTok", title="Software Engineer Intern"),
        feed_record(id="title applied to before", company_name="Booz Allen", title="Software Developer Intern"),
        tracker=tracker,
    )

    assert sorted(applied_to(rows)) == sorted(["newest req", "other title", "same title, other company"])


def test_at_most_three_applications_per_company_per_week_swe_and_ml_titles_first(monkeypatch):
    # NOW is 2026-10-15, so this week is 2026-10-09 to 2026-10-15.
    tracker = InMemoryTracker()
    tracker.add(tracked("this week", "https://jobs.example.com/acme/1", company="Acme", date_applied=date(2026, 10, 9)))
    tracker.add(tracked("last week", "https://jobs.example.com/acme/2", company="Acme", role="Other Intern",
                        date_applied=date(2026, 10, 8)))

    rows = run(
        monkeypatch,
        feed_record(id="acme data engineer", company_name="Acme", title="Data Engineer Intern", date_posted=5_000),
        feed_record(id="acme swe", company_name="Acme", title="Software Engineer Intern", date_posted=4_000),
        feed_record(id="acme data scientist", company_name="Acme", title="Data Scientist Intern", date_posted=3_000),
        feed_record(id="acme ml", company_name="Acme", title="Machine Learning Intern", date_posted=2_000),
        feed_record(id="beta 1", company_name="Beta", title="Backend Intern", date_posted=4_500),
        feed_record(id="beta 2", company_name="Beta", title="Frontend Intern", date_posted=3_500),
        feed_record(id="beta 3", company_name="Beta", title="Platform Intern", date_posted=2_500),
        feed_record(id="beta 4", company_name="Beta", title="Mobile Intern", date_posted=1_500),
        tracker=tracker,
    )

    assert applied_to(rows) == ["beta 1", "acme swe", "beta 2", "beta 3", "acme ml"]


def test_the_titles_dropped_as_not_engineering_are_a_policy_lisul_can_change(tmp_path):
    policies = tmp_path / "policies.yaml"
    policies.write_text("not_engineering_titles: [analyst, tooling]\n")
    records = [
        feed_record(id="tooling", title="Tooling Intern"),
        feed_record(id="bi", title="Business Intelligence Intern"),
        feed_record(id="analyst", title="Data Analyst Intern"),
    ]

    feed = SimplifyFeed(lambda: json.dumps(records).encode(), policies=policies)

    assert [posting.id for posting in feed.postings()] == ["bi"]


def test_a_fellowship_is_a_match_only_where_its_title_names_engineering_not_just_ai():
    # The New York Times' "AI Initiatives Fellow" is a journalism fellowship the Feed filed under AI/ML.
    records = [
        feed_record(id="nyt", title="AI Initiatives Fellow", category="AI/ML/Data"),
        feed_record(id="ml fellow", title="Machine Learning Fellow", category="AI/ML/Data"),
        feed_record(id="swe fellow", title="Software Engineering Fellowship"),
        feed_record(id="ai intern", title="AI Intern", category="AI/ML/Data"),
    ]

    feed = SimplifyFeed(lambda: json.dumps(records).encode())

    assert sorted(posting.id for posting in feed.postings()) == ["ai intern", "ml fellow", "swe fellow"]


def test_the_per_company_cap_is_a_policy_lisul_can_change(monkeypatch, tmp_path):
    profile = profile_with(tmp_path)
    (tmp_path / "policies.yaml").write_text((tmp_path / "policies.yaml").read_text() + "company_cap: 1\n")

    rows = run(
        monkeypatch,
        feed_record(id="acme swe", company_name="Acme", title="Software Engineer Intern", date_posted=3_000),
        feed_record(id="acme ml", company_name="Acme", title="Machine Learning Intern", date_posted=2_000),
        feed_record(id="beta swe", company_name="Beta", title="Software Engineer Intern", date_posted=1_000),
        profile=profile,
    )

    assert applied_to(rows) == ["acme swe", "beta swe"]


def test_applications_not_yet_submitted_count_toward_the_per_company_cap(monkeypatch):
    # Each of these will be submitted this week once it is approved, answered or resumed.
    tracker = InMemoryTracker()
    for n, status in enumerate([Status.HELD, Status.MISSING_FACT, Status.QUEUED], 1):
        tracker.add(tracked(f"acme {n}", f"https://jobs.example.com/acme/{n}", company="Acme", role=f"Intern {n}",
                            status=status, date_applied=None))

    rows = run(
        monkeypatch,
        feed_record(id="acme swe", company_name="Acme", title="Software Engineer Intern"),
        feed_record(id="beta swe", company_name="Beta", title="Software Engineer Intern"),
        tracker=tracker,
    )

    assert applied_to(rows) == ["beta swe"]


def test_an_employer_limit_stricter_than_the_cap_skips_matches_with_a_logged_reason(monkeypatch, tmp_path, capsys):
    # OpenAI takes 2 Applications in any 180 days. NOW is 2026-10-15: one went in
    # 100 days before (it counts), one 200 days before (it doesn't).
    profile = profile_with(tmp_path)
    (tmp_path / "policies.yaml").write_text(
        (tmp_path / "policies.yaml").read_text() + "employer_limits:\n  OpenAI: {applications: 2, days: 180}\n")
    tracker = InMemoryTracker()
    tracker.add(tracked("100 days ago", "https://jobs.example.com/openai/1", company="OpenAI", role="Research Intern",
                        date_applied=date(2026, 7, 7)))
    tracker.add(tracked("200 days ago", "https://jobs.example.com/openai/2", company="OpenAI", role="Infra Intern",
                        date_applied=date(2026, 3, 29)))

    rows = run(
        monkeypatch,
        feed_record(id="openai swe", company_name="OpenAI", title="Software Engineer Intern", date_posted=3_000),
        feed_record(id="openai ml", company_name="OpenAI, Inc.", title="Machine Learning Intern", date_posted=2_000),
        feed_record(id="beta swe", company_name="Beta", title="Software Engineer Intern", date_posted=1_000),
        tracker=tracker,
        profile=profile,
    )

    assert applied_to(rows) == ["openai swe", "beta swe"]
    skipped = capsys.readouterr().err
    assert "Machine Learning Intern at OpenAI, Inc." in skipped
    assert "OpenAI takes at most 2 applications in any 180 days" in skipped


def test_openai_takes_five_applications_in_any_180_days(monkeypatch):
    # policies.yaml's limit for OpenAI. None of these is in this week's cap; the oldest is 178 days before NOW.
    tracker = InMemoryTracker()
    for n, applied in enumerate([date(2026, 4, 20), date(2026, 6, 1), date(2026, 7, 1), date(2026, 8, 3),
                                 date(2026, 9, 1)], 1):
        tracker.add(tracked(f"openai {n}", f"https://jobs.example.com/openai/{n}", company="OpenAI", role=f"Intern {n}",
                            date_applied=applied))

    rows = run(
        monkeypatch,
        feed_record(id="openai swe", company_name="OpenAI", title="Software Engineer Intern"),
        feed_record(id="beta swe", company_name="Beta", title="Software Engineer Intern"),
        tracker=tracker,
    )

    assert applied_to(rows) == ["beta swe"]


@pytest.mark.parametrize("company, applied", [
    ("ElevenLabs", date(2026, 7, 18)),  # 89 days before NOW
    ("Thinking Machines Lab", date(2026, 4, 17)),  # 181 days before NOW
])
def test_elevenlabs_and_thinking_machines_take_one_application_in_their_windows(monkeypatch, company, applied):
    # policies.yaml's cautious readings: ElevenLabs 1 in any 90 days, Thinking Machines 1 in any 182.
    tracker = InMemoryTracker()
    tracker.add(tracked("earlier", "https://jobs.example.com/earlier/1", company=company, role="Research Intern",
                        date_applied=applied))

    rows = run(
        monkeypatch,
        feed_record(id="limited swe", company_name=company, title="Software Engineer Intern"),
        feed_record(id="beta swe", company_name="Beta", title="Software Engineer Intern"),
        tracker=tracker,
    )

    assert applied_to(rows) == ["beta swe"]


def test_the_dry_run_counts_matches_with_no_claude_call_and_applies_to_nothing(capsys):
    records = [
        feed_record(company_name="Acme", title="Software Engineer Intern"),
        feed_record(company_name="Acme", title="Backend Intern"),
        feed_record(company_name="Acme", title="Frontend Intern"),
        feed_record(company_name="Acme", title="ML Intern"),
        feed_record(company_name="Beta", url="https://jobs.example.com/beta/1"),
        feed_record(company_name="Beta Repost", url="https://jobs.example.com/beta/1?utm_source=Simplify"),
        feed_record(category="Product"),
    ]
    tracker, claude = InMemoryTracker(), FakeClaude()
    feed = SimplifyFeed(lambda: json.dumps(records).encode())

    main(["matches"], adapters=Adapters(
        feed=feed, tracker=tracker, site=NoBrowser(), claude=claude,
        mailbox=FakeMailbox(), usage=ScriptedUsage(), clock=FakeClock(NOW),
    ))

    assert capsys.readouterr().out == "5 Matches in the Feed today; a first run would apply to 4.\n"
    assert tracker.rows() == []
    assert claude.prompts == []


def test_the_dry_run_counts_a_first_run_up_to_the_daily_cap(monkeypatch, capsys):
    monkeypatch.setattr("apply.cli.load_policies", lambda: {"company_cap": 3, "daily_cap": 2})
    records = [feed_record(company_name=company) for company in ("Acme", "Beta", "Gamma")]

    main(["matches"], adapters=Adapters(
        feed=SimplifyFeed(lambda: json.dumps(records).encode()), tracker=InMemoryTracker(), site=NoBrowser(),
        claude=FakeClaude(), mailbox=FakeMailbox(), usage=ScriptedUsage(), clock=FakeClock(NOW),
    ))

    assert capsys.readouterr().out == "3 Matches in the Feed today; a first run would apply to 2 (policies.yaml: daily_cap).\n"


def test_a_match_skipped_over_an_employer_limit_is_told_to_the_apply_window(capsys):
    from apply.match_queue import match_queue
    from apply.model import Posting
    rows = [Row("o0", "OpenAI", "Research Intern", "https://jobs.example.com/openai/0", "greenhouse", Status.SUBMITTED,
                date_applied=date(2026, 10, 10))]
    told = []

    match_queue([Posting("o1", "OpenAI", "Software Engineer Intern", "https://jobs.example.com/openai/1")], rows,
                date(2026, 10, 15), 99, {"OpenAI": {"applications": 1, "days": 180}},
                lambda posting, why: told.append((posting.company, why)))

    assert told == [("OpenAI", "OpenAI takes at most 1 applications in any 180 days (policies.yaml: employer_limits)")]
