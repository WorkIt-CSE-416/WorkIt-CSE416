import json
import os

import pytest

import discover_boards as discovery
from workit_scraper.discovery_channels import CollectionResult, Evidence
from workit_scraper.providers import BoardNotFound, Incomplete


class Robots:
    def __init__(self, allowed=True):
        self.allowed = allowed
        self.paced = []

    def allows(self, url):
        return self.allowed

    def pace(self, url):
        self.paced.append(url)


@pytest.mark.parametrize("url", [
    "https://eviljobs.lever.co/acme",
    "https://evil.com/jobs.lever.co/acme",
    "https://evil.com/?url=https://jobs.lever.co/acme",
    "https://acme.bamboohr.com.evil.com/jobs",
    "https://user@jobs.lever.co/acme",
    "https://jobs.lever.co:123/acme",
])
def test_spoofed_urls_are_not_boards(url):
    assert discovery.board_keys(url) == []


@pytest.mark.parametrize(("url", "key"), [
    ("https://jobs.eu.lever.co/Acme/123", ("lever", "eu/acme")),
    ("https://acme.bamboohr.com/careers/123", ("bamboohr", "acme")),
    ("https://jobs.ashbyhq.com/Acme/123", ("ashby", "acme")),
    ("https://acme.wd5.myworkdayjobs.com/en-US/External/job/123",
     ("workday", "acme.wd5/external")),
])
def test_real_urls_reuse_provider_tokens(url, key):
    assert discovery.board_keys(url) == [key]


@pytest.mark.parametrize("host", [
    "boards.greenhouse.io", "job-boards.greenhouse.io",
    "boards.eu.greenhouse.io", "job-boards.eu.greenhouse.io",
])
def test_greenhouse_embed_board_parameter(host):
    url = f"https://{host}/embed/job_app?token=12345&for=Acme"
    assert discovery.board_keys(url) == [("greenhouse", "acme")]


@pytest.mark.parametrize("query", [
    "token=12345", "for=", "for=acme&for=other", "for=acme&for=",
    "for=acme%2Fother", "for=https%3A%2F%2Fjobs.lever.co%2Facme",
])
def test_greenhouse_embed_rejects_invalid_board_parameters(query):
    assert discovery.board_keys(f"https://boards.greenhouse.io/embed/job_app?{query}") == []


@pytest.mark.parametrize("host", [
    "evilboards.greenhouse.io", "boards.greenhouse.io.evil.com", "example.com",
])
def test_greenhouse_embed_rejects_untrusted_hosts(host):
    assert discovery.board_keys(f"https://{host}/embed/job_app?for=acme") == []


def test_embedded_jobs_from_different_companies_stay_separate():
    rows = discovery.candidates([
        Evidence(f"https://boards.greenhouse.io/embed/job_app?for={name}&token=123", name, "list")
        for name in ("acme", "other")
    ])
    assert [(r.token, r.companies) for r in rows] == [
        ("acme", ["acme"]), ("other", ["other"]),
    ]


def test_deduplicate_preserves_evidence_and_flags_conflicting_names():
    rows = discovery.candidates([
        Evidence("https://jobs.lever.co/acme/1", "Acme", "one"),
        Evidence("https://jobs.lever.co/ACME/2", "Other", "two"),
    ])
    assert len(rows) == 1
    assert rows[0].companies == ["Acme", "Other"]
    assert len(rows[0].evidence) == 2


def test_empty_complete_board_is_valid(swap_provider):
    swap_provider("lever", read=lambda *_: [])
    row = discovery.Candidate("lever", "acme", ["Acme"])
    discovery.validate(row, Robots())
    assert row.status == "validated"
    assert row.postings == 0


@pytest.mark.parametrize(("error", "status"), [
    (BoardNotFound(), "not_found"), (Incomplete(), "unread:incomplete"),
    (TimeoutError(), "unread:timeout"),
])
def test_failed_reads_never_validate(swap_provider, error, status):
    def fail(*_):
        raise error
    swap_provider("lever", read=fail)
    row = discovery.Candidate("lever", "acme", ["Acme"])
    discovery.validate(row, Robots())
    assert row.status == status


def test_robots_blocks_provider(swap_provider):
    def fail(*_):
        pytest.fail("must not fetch")
    swap_provider("lever", read=fail)
    row = discovery.Candidate("lever", "acme", ["Acme"])
    discovery.validate(row, Robots(False))
    assert row.status == "robots_disallowed"


def test_preview_then_apply_is_additive_and_idempotent(tmp_path, monkeypatch, swap_provider):
    boards = tmp_path / "boards.csv"
    boards.write_text("# preserved\nats,token,company\nlever,existing,Original\n")
    report = tmp_path / "report.json"
    monkeypatch.setattr(discovery, "Robots", Robots)
    swap_provider("lever", read=lambda *_: [])
    args = ["--url", "https://jobs.lever.co/acme", "--company", "Acme, Inc.",
            "--boards", str(boards), "--report", str(report)]
    before = boards.read_bytes()
    assert discovery.main(args) == 0
    assert boards.read_bytes() == before
    assert discovery.main([*args, "--apply"]) == 0
    assert 'lever,acme,"Acme, Inc."' in boards.read_text()
    assert "lever,existing,Original" in boards.read_text()
    assert boards.read_text().startswith("# preserved")
    after = boards.read_bytes()
    assert discovery.main([*args, "--apply"]) == 0
    assert boards.read_bytes() == after
    assert json.loads(report.read_text())["candidates"][0]["status"] == "already_known"


def test_search_without_name_is_reported_not_added(tmp_path, monkeypatch):
    monkeypatch.setattr(discovery, "Robots", Robots)
    monkeypatch.setattr(discovery, "collect", lambda *_a, **_k: CollectionResult([
        Evidence("https://jobs.lever.co/acme", "", "search")], []))
    boards = tmp_path / "boards.csv"
    report = tmp_path / "report.json"
    assert discovery.main(["--channel", "ddg", "--query", "fintech", "--apply",
                           "--boards", str(boards), "--report", str(report)]) == 0
    assert not boards.exists()
    assert json.loads(report.read_text())["candidates"][0]["status"] == "needs_company"


def test_partial_channel_failure_retains_success_report(tmp_path, monkeypatch, swap_provider):
    monkeypatch.setattr(discovery, "Robots", Robots)
    def collect(channel, *_a, **_k):
        if channel == "hn":
            raise TimeoutError()
        return CollectionResult([Evidence("https://jobs.lever.co/acme", "Acme", "curated")], [])
    monkeypatch.setattr(discovery, "collect", collect)
    swap_provider("lever", read=lambda *_: [])
    report = tmp_path / "report.json"
    assert discovery.main(["--channel", "hn", "--channel", "curated",
                           "--boards", str(tmp_path / "boards.csv"),
                           "--report", str(report)]) == 1
    payload = json.loads(report.read_text())
    assert payload["candidates"][0]["status"] == "validated"
    assert payload["channel_failures"] == [
        {"channel": "hn", "source": "hn", "error": "TimeoutError"},
    ]


def test_validation_limit_follows_deduplication(tmp_path, monkeypatch, swap_provider):
    monkeypatch.setattr(discovery, "Robots", Robots)
    links = [Evidence(f"https://jobs.lever.co/{slug}", name, "curated") for slug, name in [
        ("known", "Known"), ("conflict", "First"), ("conflict", "Second"),
        ("new", "New"), ("later", "Later")]]
    monkeypatch.setattr(discovery, "collect", lambda *_a, **_k: CollectionResult(links, []))
    called = []
    def read(token, company):
        called.append(token)
        return []
    swap_provider("lever", read=read)
    boards = tmp_path / "boards.csv"
    boards.write_text("ats,token,company\nlever,known,Original\n")
    report = tmp_path / "report.json"
    discovery.main(["--channel", "curated", "--limit", "1", "--apply",
                    "--boards", str(boards), "--report", str(report)])
    assert called == ["new"]
    assert "conflict" not in boards.read_text()
    assert "lever,new,New" in boards.read_text()
    assert json.loads(report.read_text())["candidates"][-1]["status"] == "deferred"


def test_paged_validation_receives_pacer_and_checks_careers_site(swap_provider):
    robots = Robots()
    def read(token, company, *, pace):
        assert pace == robots.pace
        return []
    swap_provider("workday", read=read)
    row = discovery.Candidate("workday", "acme.wd5/external", ["Acme"])
    discovery.validate(row, robots)
    assert row.status == "validated"


def test_http_keeps_identifying_agent_and_auth_headers(monkeypatch):
    from workit_scraper import web

    class Response:
        def __enter__(self):
            return self

        def __exit__(self, *_):
            pass

        def read(self):
            return b"{}"

    def open_request(request, *, timeout):
        assert request.get_header("Authorization") == "Bearer test"
        assert request.get_header("User-agent") == web.USER_AGENT
        return Response()

    monkeypatch.setattr(web._OPENER, "open", open_request)
    assert web.get("https://api.github.com/search/code", timeout=3,
                   headers={"Authorization": "Bearer test", "User-Agent": "other"}) == b"{}"


@pytest.mark.parametrize("apply", [False, True])
@pytest.mark.parametrize("alias", ["same", "relative", "hardlink"])
def test_report_cannot_replace_catalog(tmp_path, monkeypatch, apply, alias):
    boards = tmp_path / "boards.csv"
    boards.write_text("ats,token,company\nlever,acme,Acme\n")
    original = boards.read_bytes()
    report = boards
    if alias == "relative":
        monkeypatch.chdir(tmp_path)
        report = boards.relative_to(tmp_path)
    elif alias == "hardlink":
        report = tmp_path / "report.json"
        os.link(boards, report)
    def no_network(*_a, **_k):
        pytest.fail("path collision must be rejected before network initialization")
    monkeypatch.setattr(discovery, "Robots", no_network)
    args = ["--url", "https://jobs.lever.co/acme", "--company", "Acme",
            "--boards", str(boards), "--report", str(report)]
    with pytest.raises(SystemExit) as error:
        discovery.main(args + (["--apply"] if apply else []))
    assert error.value.code == 2
    assert boards.read_bytes() == original


def test_partial_source_results_reach_report_and_catalog(tmp_path, monkeypatch, swap_provider):
    from workit_scraper.discovery_channels import SourceFailure

    monkeypatch.setattr(discovery, "Robots", Robots)
    monkeypatch.setattr(discovery, "collect", lambda *_a, **_k: CollectionResult(
        [Evidence("https://jobs.lever.co/acme", "Acme", "https://example.com/good")],
        [SourceFailure("curated", "https://example.com/broken", "TimeoutError")],
    ))
    swap_provider("lever", read=lambda *_: [])
    boards, report = tmp_path / "boards.csv", tmp_path / "report.json"
    assert discovery.main(["--channel", "curated", "--apply", "--boards", str(boards),
                           "--report", str(report)]) == 1
    assert "lever,acme,Acme" in boards.read_text()
    data = json.loads(report.read_text())
    assert data["channel_failures"][0]["source"] == "https://example.com/broken"
    assert data["candidates"][0]["evidence"][0]["company"] == "Acme"
