"""The open-jobs pool (ADR 0007): a board is proposed only for an early-career
posting, under the name its hiring system gives it, and a sample is checked."""

import json
import zlib

import pytest

import discover_boards as discovery
from workit_scraper import board_read, providers
from workit_scraper.discovery_channels import OPEN_JOBS, CollectionResult, open_jobs
from workit_scraper.discovery_review import SAMPLE_FEWEST, reconcile, render_review, sampled
from workit_scraper.providers import Board, Job

AT = "2026-10-29T12:00:00+00:00"


class Robots:
    def __init__(self, allowed=True):
        self.allowed = allowed
        self.asked = []

    def allows(self, url):
        self.asked.append(url)
        return self.allowed

    def pace(self, url):
        pass


def job(title, token="acme"):
    return Job("greenhouse", token, token, title, title, f"https://x.test/{token}/{title}")


# Each answer as the hiring system sent it on 2026-10-29.
@pytest.mark.parametrize(
    ("ats", "text", "name"),
    [
        ("greenhouse", '{"name": "HelloFresh", "content": "<p>Mission</p>"}', "HelloFresh"),
        ("workable", '{"name": "SAP Fioneer", "jobs": []}', "SAP Fioneer"),
        ("lever", "<html><head><title>Palantir Technologies</title>", "Palantir Technologies"),
        ("lever", "<title>Ben &amp; Jerry&#39;s</title>", "Ben & Jerry's"),
        ("ashby", "<title>Matter Intelligence Jobs</title>", "Matter Intelligence"),
        # An unknown Ashby board's page, and pages naming no one.
        ("ashby", "<title>Jobs</title>", None),
        ("lever", "<title> </title>", None),
        ("greenhouse", '{"name": ""}', None),
        ("workable", "[]", None),
    ],
)
def test_each_pool_system_reads_the_name_it_gives(ats, text, name):
    assert providers.PROVIDERS[ats].read_name(text) == name


def test_name_pages_are_the_boards_own():
    assert (
        providers.name_url("greenhouse", "acme")
        == "https://boards-api.greenhouse.io/v1/boards/acme"
    )
    assert providers.name_url("lever", "eu/acme") == "https://jobs.eu.lever.co/acme"
    assert providers.name_url("ashby", "acme") == "https://jobs.ashbyhq.com/acme"


def test_reported_name_obeys_robots_and_never_guesses(monkeypatch):
    monkeypatch.setattr(providers.fetch, "_get_text", lambda url: '{"name": "Acme"}')
    board = Board("greenhouse", "acme", "acme")
    assert board_read.reported_name(board, Robots()) == "Acme"
    assert board_read.reported_name(board, Robots(False)) is None

    def fail(url):
        raise TimeoutError

    monkeypatch.setattr(providers.fetch, "_get_text", fail)
    assert board_read.reported_name(board, Robots()) is None
    assert board_read.reported_name(Board("bamboohr", "acme", "acme"), Robots()) is None


# Names Greenhouse gave boards on 2026-11-01: 25 of 242 sampled were like these.
@pytest.mark.parametrize(
    "name",
    [
        "Careers at KKR",
        "C3 AI Ascend Internship Program: Summer 2027",
        "BitGo Internships and New Grads",
        "Rubrik Job Board",
        "Referrals Only",
        "Join Our Talent Community",
        "BGE Inc. Campus Recruiting",
        "Graphcore Early Careers",
        "Gelber Group Handshake",
        "Philadelphia Phillies - Baseball Operations",
        "SanMar- External",
    ],
)
def test_a_careers_page_or_program_is_no_company_name(monkeypatch, name):
    monkeypatch.setattr(providers.fetch, "_get_text", lambda url: json.dumps({"name": name}))
    assert board_read.reported_name(Board("greenhouse", "acme", "acme"), Robots()) is None


@pytest.mark.parametrize(
    "name", ["KKR", "Handshake", "Invitation Homes", "2020 Companies", "Ben & Jerry's", "C3.ai"]
)
def test_a_company_name_is_kept(monkeypatch, name):
    monkeypatch.setattr(providers.fetch, "_get_text", lambda url: json.dumps({"name": name}))
    assert board_read.reported_name(Board("greenhouse", "acme", "acme"), Robots()) == name


def test_open_jobs_channel_keeps_only_pool_systems_and_names_no_one():
    payload = {
        "ats": {
            "greenhouse": ["acme"],
            "workable": ["beta"],
            "ashby": ["gamma"],
            "lever": ["delta"],
            "bamboohr": ["unnamed"],
            "workday": ["acme.wd5.myworkdayjobs.com"],
        }
    }
    result = open_jobs(lambda url, **_: json.dumps(payload).encode())
    keys = [key for item in result.evidence for key in discovery.board_keys(item.url)]
    assert keys == [
        ("greenhouse", "acme"),
        ("workable", "beta"),
        ("ashby", "gamma"),
        ("lever", "delta"),
    ]
    assert {(item.company, item.source) for item in result.evidence} == {("", OPEN_JOBS)}


def pool_row(token="acme"):
    return discovery.candidates(
        [discovery.Evidence(f"https://job-boards.greenhouse.io/{token}", "", OPEN_JOBS)]
    )[0]


def test_pool_board_with_an_early_career_posting_is_named_by_its_system(swap_provider, monkeypatch):
    swap_provider(
        "greenhouse", read=lambda *_: [job("Software Engineer Intern"), job("Senior Engineer")]
    )
    monkeypatch.setattr(providers.fetch, "_get_text", lambda url: '{"name": "Acme Corp"}')
    row = pool_row()
    discovery.validate_pooled(row, Robots())
    assert (row.status, row.postings, row.kept, row.companies) == (
        "validated",
        2,
        ["Software Engineer Intern"],
        ["Acme Corp"],
    )
    # The review accepts it: the hiring system's page is the evidence for the name.
    update = reconcile([], [], {}, {"generated_at": AT, "candidates": [discovery.asdict(row)]})
    assert [board.company for board in update.boards] == ["Acme Corp"]


def test_pool_board_without_an_early_career_posting_is_not_proposed(swap_provider):
    swap_provider("greenhouse", read=lambda *_: [job("Senior Engineer")])
    swap_provider("greenhouse", read_name=lambda text: pytest.fail("no name needed"))
    row = pool_row()
    discovery.validate_pooled(row, Robots())
    assert (row.status, row.companies) == ("no_early_career", [])


def test_pool_board_its_system_does_not_name_is_not_proposed(swap_provider, monkeypatch):
    swap_provider("greenhouse", read=lambda *_: [job("Analyst Intern")])
    monkeypatch.setattr(discovery, "reported_name", lambda *_: None)
    row = pool_row()
    discovery.validate_pooled(row, Robots())
    assert (row.status, row.companies) == ("needs_company", [])


def test_pool_has_its_own_limit_and_named_leads_keep_theirs(tmp_path, monkeypatch, swap_provider):
    pool = [
        discovery.Evidence(f"https://job-boards.greenhouse.io/p{i}", "", OPEN_JOBS)
        for i in range(5)
    ]
    named = [discovery.Evidence(f"https://jobs.lever.co/n{i}", f"N{i}", "hn") for i in range(3)]
    monkeypatch.setattr(discovery, "Robots", Robots)
    monkeypatch.setattr(discovery, "collect", lambda *_a, **_k: CollectionResult(pool + named, []))
    monkeypatch.setattr(discovery, "reported_name", lambda board, _: board.token.upper())
    swap_provider("greenhouse", read=lambda token, _: [job("Software Engineer Intern", token)])
    swap_provider("lever", read=lambda *_: [])
    report = tmp_path / "report.json"
    args = ["--channel", "openjobs", "--limit", "1", "--pool-days", "2", "--pool-day", "3"]
    args += ["--pool-limit", "9", "--boards", str(tmp_path / "b.csv"), "--report", str(report)]
    assert discovery.main(args) == 0
    status = {row["token"]: row["status"] for row in json.loads(report.read_text())["candidates"]}
    # Day 3 of a 2-day pass is day 1: the pool boards whose key hashes there.
    day = [f"p{i}" for i in range(5) if zlib.crc32(f"greenhouse/p{i}".encode()) % 2 == 1]
    assert [t for t, s in status.items() if t.startswith("p") and s == "validated"] == day
    assert sum(s == "validated" for t, s in status.items() if t.startswith("n")) == 1


def test_a_pool_board_keeps_its_day_as_the_pool_changes():
    # An offset taken modulo the pool's size jumped as boards joined boards.csv,
    # and a 16-day pass read about 77% of the pool.
    pool = [pool_row(f"b{i}") for i in range(300)]
    days = [discovery.on_day(pool, 16, day) for day in range(16)]
    assert sorted(row.token for day in days for row in day) == sorted(row.token for row in pool)
    smaller = pool[100:]
    for number, rows in enumerate(days):
        assert discovery.on_day(smaller, 16, number) == [row for row in rows if row in smaller]
    assert discovery.on_day(pool, 16, 16) == days[0]


def pool_record(token, at=AT):
    return {"ats": "greenhouse", "token": token, "kept": ["Intern"], "validated_at": at}


def test_sample_is_a_tenth_of_each_batch_at_least_the_fewest_and_fixed():
    ledger = {f"greenhouse/b{i}": pool_record(f"b{i}") for i in range(80)}
    ledger |= {
        f"greenhouse/c{i}": pool_record(f"c{i}", "2026-10-30T12:00:00+00:00") for i in range(3)
    }
    ledger["lever/named"] = {"ats": "lever", "token": "named", "kept": [], "validated_at": AT}
    chosen = sampled(ledger, ledger)
    assert sum(key.startswith("greenhouse/b") for key in chosen) == 8
    # A batch smaller than the fewest is checked whole; a named lead is never sampled.
    assert sum(key.startswith("greenhouse/c") for key in chosen) == 3
    assert "lever/named" not in chosen
    assert sampled(ledger, reversed(list(ledger))) == chosen
    assert SAMPLE_FEWEST == 5


def test_render_marks_the_sample_and_shows_why_a_pool_board_is_proposed():
    rows = []
    for i in range(6):
        row = pool_row(f"b{i}")
        row.status, row.postings, row.kept, row.companies = (
            "validated",
            1,
            ["Data <Intern>"],
            [f"B{i}"],
        )
        row.evidence.append(
            discovery.Evidence(
                row.evidence[0].url, f"B{i}", "https://boards-api.greenhouse.io/v1/boards/b"
            )
        )
        rows.append(discovery.asdict(row))
    update = reconcile([], [], {}, {"generated_at": AT, "candidates": rows})
    rendered = render_review(update, [])
    assert rendered.count("Sample: check this name") == 5
    assert rendered.count("trusted if its batch's sample holds") == 1
    assert "Early career: <code>Data &lt;Intern&gt;</code>" in rendered
