import json
import os

import pytest

import discover_boards as discovery
from workit_scraper import board_resolve
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


@pytest.mark.parametrize(
    "url",
    [
        "https://eviljobs.lever.co/acme",
        "https://evil.com/jobs.lever.co/acme",
        "https://evil.com/?url=https://jobs.lever.co/acme",
        "https://acme.bamboohr.com.evil.com/jobs",
        "https://user@jobs.lever.co/acme",
        "https://jobs.lever.co:123/acme",
    ],
)
def test_spoofed_urls_are_not_boards(url):
    assert discovery.board_keys(url) == []


@pytest.mark.parametrize(
    ("url", "key"),
    [
        ("https://jobs.eu.lever.co/Acme/123", ("lever", "eu/acme")),
        ("https://acme.bamboohr.com/careers/123", ("bamboohr", "acme")),
        ("https://jobs.ashbyhq.com/Acme/123", ("ashby", "acme")),
        (
            "https://acme.wd5.myworkdayjobs.com/en-US/External/job/123",
            ("workday", "acme.wd5/external"),
        ),
    ],
)
def test_real_urls_reuse_provider_tokens(url, key):
    assert discovery.board_keys(url) == [key]


@pytest.mark.parametrize(
    "host",
    [
        "boards.greenhouse.io",
        "job-boards.greenhouse.io",
        "boards.eu.greenhouse.io",
        "job-boards.eu.greenhouse.io",
    ],
)
def test_greenhouse_embed_board_parameter(host):
    url = f"https://{host}/embed/job_app?token=12345&for=Acme"
    assert discovery.board_keys(url) == [("greenhouse", "acme")]


@pytest.mark.parametrize(
    "query",
    [
        "token=12345",
        "for=",
        "for=acme&for=other",
        "for=acme&for=",
        "for=acme%2Fother",
        "for=https%3A%2F%2Fjobs.lever.co%2Facme",
    ],
)
def test_greenhouse_embed_rejects_invalid_board_parameters(query):
    assert discovery.board_keys(f"https://boards.greenhouse.io/embed/job_app?{query}") == []


@pytest.mark.parametrize(
    "host",
    [
        "evilboards.greenhouse.io",
        "boards.greenhouse.io.evil.com",
        "example.com",
    ],
)
def test_greenhouse_embed_rejects_untrusted_hosts(host):
    assert discovery.board_keys(f"https://{host}/embed/job_app?for=acme") == []


@pytest.mark.parametrize(
    "url",
    [
        "https://example.com/apply?url=https://jobs.lever.co/acme",
        "https://example.com/apply?next=//jobs.ashbyhq.com/acme",
        "https://jobs.ashbyhq.com/acme@other",
    ],
)
def test_a_board_named_inside_a_query_or_mid_name_is_no_board(url):
    assert discovery.board_keys(url) == []


def test_a_query_after_the_board_still_names_it():
    assert discovery.board_keys("https://jobs.lever.co/acme/123?lever-source=x") == [
        ("lever", "acme")
    ]


def test_embedded_jobs_from_different_companies_stay_separate():
    rows = discovery.candidates(
        [
            Evidence(
                f"https://boards.greenhouse.io/embed/job_app?for={name}&token=123", name, "list"
            )
            for name in ("acme", "other")
        ]
    )
    assert [(r.token, r.companies) for r in rows] == [
        ("acme", ["acme"]),
        ("other", ["other"]),
    ]


def test_deduplicate_preserves_evidence_and_flags_conflicting_names():
    rows = discovery.candidates(
        [
            Evidence("https://jobs.lever.co/acme/1", "Acme", "one"),
            Evidence("https://jobs.lever.co/ACME/2", "Other", "two"),
        ]
    )
    assert len(rows) == 1
    assert rows[0].companies == ["Acme", "Other"]
    assert len(rows[0].evidence) == 2


def test_empty_complete_board_is_valid(swap_provider):
    swap_provider("lever", read=lambda *_: [])
    row = discovery.Candidate("lever", "acme", ["Acme"])
    discovery.validate(row, Robots())
    assert row.status == "validated"
    assert row.postings == 0


@pytest.mark.parametrize(
    ("error", "status"),
    [
        (BoardNotFound(), "not_found"),
        (Incomplete(), "unread:incomplete"),
        (TimeoutError(), "unread:timeout"),
    ],
)
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
    args = [
        "--url",
        "https://jobs.lever.co/acme",
        "--company",
        "Acme, Inc.",
        "--boards",
        str(boards),
        "--report",
        str(report),
    ]
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
    monkeypatch.setattr(
        discovery,
        "collect",
        lambda *_a, **_k: CollectionResult(
            [Evidence("https://jobs.lever.co/acme", "", "search")], []
        ),
    )
    boards = tmp_path / "boards.csv"
    report = tmp_path / "report.json"
    assert (
        discovery.main(
            [
                "--channel",
                "ddg",
                "--query",
                "fintech",
                "--apply",
                "--boards",
                str(boards),
                "--report",
                str(report),
            ]
        )
        == 0
    )
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
    assert (
        discovery.main(
            [
                "--channel",
                "hn",
                "--channel",
                "curated",
                "--boards",
                str(tmp_path / "boards.csv"),
                "--report",
                str(report),
            ]
        )
        == 1
    )
    payload = json.loads(report.read_text())
    assert payload["candidates"][0]["status"] == "validated"
    assert payload["channel_failures"] == [
        {"channel": "hn", "source": "hn", "error": "TimeoutError"},
    ]


def test_validation_limit_follows_deduplication(tmp_path, monkeypatch, swap_provider):
    monkeypatch.setattr(discovery, "Robots", Robots)
    links = [
        Evidence(f"https://jobs.lever.co/{slug}", name, "curated")
        for slug, name in [
            ("known", "Known"),
            ("conflict", "First"),
            ("conflict", "Second"),
            ("new", "New"),
            ("later", "Later"),
        ]
    ]
    monkeypatch.setattr(discovery, "collect", lambda *_a, **_k: CollectionResult(links, []))
    called = []

    def read(token, company):
        called.append(token)
        return []

    swap_provider("lever", read=read)
    boards = tmp_path / "boards.csv"
    boards.write_text("ats,token,company\nlever,known,Original\n")
    report = tmp_path / "report.json"
    discovery.main(
        [
            "--channel",
            "curated",
            "--limit",
            "1",
            "--apply",
            "--boards",
            str(boards),
            "--report",
            str(report),
        ]
    )
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
    assert (
        web.get(
            "https://api.github.com/search/code",
            timeout=3,
            headers={"Authorization": "Bearer test", "User-Agent": "other"},
        )
        == b"{}"
    )


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
    args = [
        "--url",
        "https://jobs.lever.co/acme",
        "--company",
        "Acme",
        "--boards",
        str(boards),
        "--report",
        str(report),
    ]
    with pytest.raises(SystemExit) as error:
        discovery.main(args + (["--apply"] if apply else []))
    assert error.value.code == 2
    assert boards.read_bytes() == original


def test_partial_source_results_reach_report_and_catalog(tmp_path, monkeypatch, swap_provider):
    from workit_scraper.discovery_channels import SourceFailure

    monkeypatch.setattr(discovery, "Robots", Robots)
    monkeypatch.setattr(
        discovery,
        "collect",
        lambda *_a, **_k: CollectionResult(
            [Evidence("https://jobs.lever.co/acme", "Acme", "https://example.com/good")],
            [SourceFailure("curated", "https://example.com/broken", "TimeoutError")],
        ),
    )
    swap_provider("lever", read=lambda *_: [])
    boards, report = tmp_path / "boards.csv", tmp_path / "report.json"
    assert (
        discovery.main(
            ["--channel", "curated", "--apply", "--boards", str(boards), "--report", str(report)]
        )
        == 1
    )
    assert "lever,acme,Acme" in boards.read_text()
    data = json.loads(report.read_text())
    assert data["channel_failures"][0]["source"] == "https://example.com/broken"
    assert data["candidates"][0]["evidence"][0]["company"] == "Acme"


@pytest.mark.parametrize(
    "offset, expected", [(0, "first"), (1, "second"), (2, "first"), (101, "second")]
)
def test_offset_rotates_only_eligible_candidates(
    tmp_path, monkeypatch, swap_provider, offset, expected
):
    monkeypatch.setattr(discovery, "Robots", Robots)
    monkeypatch.setattr(
        discovery,
        "collect",
        lambda *_a, **_k: CollectionResult(
            [
                Evidence("https://jobs.lever.co/known", "Known", "source"),
                Evidence("https://jobs.lever.co/nameless", "", "source"),
                Evidence("https://jobs.lever.co/first", "First", "source"),
                Evidence("https://jobs.lever.co/second", "Second", "source"),
            ]
        ),
    )
    called = []
    swap_provider("lever", read=lambda token, company: called.append(token) or [])
    boards, report = tmp_path / "boards.csv", tmp_path / "report.json"
    boards.write_text("ats,token,company\nlever,known,Known\n")
    discovery.main(
        [
            "--channel",
            "curated",
            "--boards",
            str(boards),
            "--report",
            str(report),
            "--limit",
            "1",
            "--offset",
            str(offset),
        ]
    )
    assert called == [expected]
    result = json.loads(report.read_text())
    assert [r["token"] for r in result["candidates"]] == ["known", "nameless", "first", "second"]
    assert result["generated_at"].endswith("+00:00")
    assert next(r for r in result["candidates"] if r["token"] == expected)["status"] == "validated"
    assert "lever,first" not in boards.read_text()


def test_rejections_are_excluded_before_validation_budget(tmp_path, monkeypatch, swap_provider):
    monkeypatch.setattr(discovery, "Robots", Robots)
    monkeypatch.setattr(
        discovery,
        "collect",
        lambda *_a, **_k: CollectionResult(
            [
                Evidence("https://jobs.lever.co/rejected", "Rejected", "source"),
                Evidence("https://jobs.lever.co/new", "New", "source"),
            ]
        ),
    )
    ledger = tmp_path / "review.json"
    ledger.write_text(
        json.dumps(
            {"lever/rejected": {"decision": "rejected"}, "lever/new": {"decision": "proposed"}}
        )
    )
    called = []
    swap_provider("lever", read=lambda token, company: called.append(token) or [])
    boards, report = tmp_path / "boards.csv", tmp_path / "report.json"
    discovery.main(
        [
            "--channel",
            "curated",
            "--exclude",
            str(ledger),
            "--boards",
            str(boards),
            "--report",
            str(report),
            "--limit",
            "1",
            "--apply",
        ]
    )
    assert called == ["new"]
    assert "rejected" not in boards.read_text()
    assert "lever,new,New" in boards.read_text()
    assert json.loads(report.read_text())["candidates"][0]["status"] == "rejected"


@pytest.mark.parametrize(
    "content",
    [
        "[]",
        "{",
        '{"bad": {"decision": "rejected"}}',
        '{"lever/a": {"decision": []}}',
        '{"lever/a": {"decision": "unknown"}}',
    ],
)
def test_invalid_review_ledger_fails_before_network(tmp_path, monkeypatch, content):
    ledger = tmp_path / "review.json"
    ledger.write_text(content)
    monkeypatch.setattr(discovery, "Robots", lambda: pytest.fail("must not initialize network"))
    with pytest.raises(SystemExit) as error:
        discovery.main(
            ["--url", "https://jobs.lever.co/acme", "--company", "Acme", "--exclude", str(ledger)]
        )
    assert error.value.code == 2


@pytest.mark.parametrize("target", ["--report", "--boards"])
@pytest.mark.parametrize("alias", ["same", "relative", "hardlink"])
def test_review_ledger_cannot_alias_output(tmp_path, monkeypatch, target, alias):
    ledger = tmp_path / "review.json"
    ledger.write_text('{"lever/acme": {"decision": "rejected"}}')
    before = ledger.read_bytes()
    output = ledger
    if alias == "relative":
        monkeypatch.chdir(tmp_path)
        output = ledger.relative_to(tmp_path)
    elif alias == "hardlink":
        output = tmp_path / "alias.json"
        os.link(ledger, output)
    monkeypatch.setattr(discovery, "Robots", lambda: pytest.fail("must not initialize network"))
    with pytest.raises(SystemExit) as error:
        discovery.main(
            [
                "--url",
                "https://jobs.lever.co/acme",
                "--company",
                "Acme",
                "--apply",
                "--exclude",
                str(ledger),
                target,
                str(output),
            ]
        )
    assert error.value.code == 2
    assert ledger.read_bytes() == before


def test_negative_offset_rejected_before_network(monkeypatch):
    monkeypatch.setattr(discovery, "Robots", lambda: pytest.fail("must not initialize network"))
    with pytest.raises(SystemExit) as error:
        discovery.main(
            ["--url", "https://jobs.lever.co/acme", "--company", "Acme", "--offset", "-1"]
        )
    assert error.value.code == 2


# --- Resolve step -----------------------------------------------------------


class ResolveWeb:
    """Answers by URL: bytes for a 200, a str for a redirect (raised as a 302),
    else a 404."""

    def __init__(self, answers):
        self.answers = answers
        self.asked = []

    def __call__(self, url):
        import urllib.error

        self.asked.append(url)
        answer = self.answers.get(url)
        if isinstance(answer, bytes):
            return answer
        if isinstance(answer, str):
            raise urllib.error.HTTPError(answer, 302, "redirect", None, None)
        raise urllib.error.HTTPError(url, 404, "Not Found", None, None)


def test_resolve_short_link_to_board(tmp_path, monkeypatch, swap_provider):
    """A short link that redirects to a known board URL adds it as evidence."""
    monkeypatch.setattr(discovery, "Robots", Robots)
    swap_provider("greenhouse", read=lambda *_: [])
    web = ResolveWeb({"https://go.vansh.nyc/o": "https://job-boards.greenhouse.io/acme/jobs/123"})
    monkeypatch.setattr(
        discovery,
        "collect",
        lambda *_a, **_k: CollectionResult(
            [Evidence("https://go.vansh.nyc/o", "Acme", "curated")], []
        ),
    )
    boards, report = tmp_path / "boards.csv", tmp_path / "report.json"
    monkeypatch.setattr(discovery.web, "get", lambda url, **kw: web(url))
    discovery.main(
        [
            "--channel",
            "curated",
            "--resolve",
            "--apply",
            "--boards",
            str(boards),
            "--report",
            str(report),
        ]
    )
    assert "greenhouse,acme,Acme" in boards.read_text()


def test_resolve_greenhouse_careers_page(tmp_path, monkeypatch, swap_provider):
    """A ?gh_jid= URL proved against the Greenhouse API adds the board."""
    monkeypatch.setattr(discovery, "Robots", Robots)
    swap_provider("greenhouse", read=lambda *_: [])
    api_url = "https://boards-api.greenhouse.io/v1/boards/waymo/jobs/8189848"
    web = ResolveWeb({api_url: b"{}"})
    monkeypatch.setattr(
        discovery,
        "collect",
        lambda *_a, **_k: CollectionResult(
            [Evidence("https://careers.withwaymo.com/jobs?gh_jid=8189848", "Waymo", "curated")], []
        ),
    )
    boards, report = tmp_path / "boards.csv", tmp_path / "report.json"
    monkeypatch.setattr(discovery.web, "get", lambda url, **kw: web(url))
    discovery.main(
        [
            "--channel",
            "curated",
            "--resolve",
            "--apply",
            "--boards",
            str(boards),
            "--report",
            str(report),
        ]
    )
    assert "greenhouse,waymo,Waymo" in boards.read_text()


def test_resolve_unresolvable_stays_unmatched(tmp_path, monkeypatch):
    """A URL that cannot be resolved stays in unmatched, no board is added."""
    monkeypatch.setattr(discovery, "Robots", Robots)
    web = ResolveWeb({})
    monkeypatch.setattr(
        discovery,
        "collect",
        lambda *_a, **_k: CollectionResult(
            [Evidence("https://example.com/careers/apply", "Unknown", "curated")], []
        ),
    )
    boards, report = tmp_path / "boards.csv", tmp_path / "report.json"
    monkeypatch.setattr(discovery.web, "get", lambda url, **kw: web(url))
    discovery.main(
        [
            "--channel",
            "curated",
            "--resolve",
            "--apply",
            "--boards",
            str(boards),
            "--report",
            str(report),
        ]
    )
    assert not boards.exists()
    data = json.loads(report.read_text())
    assert any(u["url"] == "https://example.com/careers/apply" for u in data["unmatched"])


def test_resolve_not_called_without_flag(tmp_path, monkeypatch):
    """Without --resolve, unmatched evidence is not resolved."""
    monkeypatch.setattr(discovery, "Robots", Robots)
    monkeypatch.setattr(
        discovery,
        "collect",
        lambda *_a, **_k: CollectionResult(
            [Evidence("https://go.vansh.nyc/o", "Acme", "curated")], []
        ),
    )
    boards, report = tmp_path / "boards.csv", tmp_path / "report.json"
    discovery.main(
        [
            "--channel",
            "curated",
            "--boards",
            str(boards),
            "--report",
            str(report),
        ]
    )
    assert not boards.exists()
    data = json.loads(report.read_text())
    assert data["unmatched"][0]["url"] == "https://go.vansh.nyc/o"


def test_resolution_limit_does_not_block_direct_boards(tmp_path, monkeypatch, swap_provider):
    monkeypatch.setattr(discovery, "Robots", Robots)
    swap_provider("lever", read=lambda *_: [])
    monkeypatch.setattr(
        discovery,
        "collect",
        lambda *_a, **_k: CollectionResult(
            [
                Evidence("https://careers.acme.com/?gh_jid=1", "Acme", "curated"),
                Evidence("https://jobs.lever.co/delta/123", "Delta", "curated"),
            ],
            [],
        ),
    )
    monkeypatch.setattr(discovery.web, "get", lambda *_a, **_k: pytest.fail("budget is zero"))
    boards, report = tmp_path / "boards.csv", tmp_path / "report.json"
    assert (
        discovery.main(
            [
                "--channel",
                "curated",
                "--resolve",
                "--resolve-limit",
                "0",
                "--apply",
                "--boards",
                str(boards),
                "--report",
                str(report),
            ]
        )
        == 0
    )
    assert "lever,delta,Delta" in boards.read_text()
    assert json.loads(report.read_text())["resolution"] == {
        "total": 1,
        "attempted": 0,
        "deferred": 1,
        "timed_out": False,
        "next_offset": 0,
    }


def test_resolution_deadline_keeps_successes_and_continues_validation(
    tmp_path,
    monkeypatch,
    swap_provider,
):
    monkeypatch.setattr(discovery, "Robots", Robots)
    swap_provider("greenhouse", read=lambda *_: [])
    swap_provider("lever", read=lambda *_: [])
    monkeypatch.setattr(
        discovery,
        "collect",
        lambda *_a, **_k: CollectionResult(
            [
                Evidence("https://careers.acme.com/?gh_jid=1", "Acme", "curated"),
                Evidence("https://careers.beta.com/?gh_jid=2", "Beta", "curated"),
                Evidence("https://jobs.lever.co/delta/123", "Delta", "curated"),
            ],
            [],
        ),
    )
    clock = [0.0]
    monkeypatch.setattr(board_resolve.time, "monotonic", lambda: clock[0])
    asked = []

    def get(url, **kwargs):
        asked.append(url)
        clock[0] = 2.0
        return b"{}"

    monkeypatch.setattr(discovery.web, "get", get)
    boards, report = tmp_path / "boards.csv", tmp_path / "report.json"
    assert (
        discovery.main(
            [
                "--channel",
                "curated",
                "--resolve",
                "--resolve-seconds",
                "1",
                "--apply",
                "--boards",
                str(boards),
                "--report",
                str(report),
            ]
        )
        == 0
    )
    catalog = boards.read_text()
    assert "greenhouse,acme,Acme" in catalog
    assert "lever,delta,Delta" in catalog
    assert "Beta" not in catalog
    assert len(asked) == 1
    resolution = json.loads(report.read_text())["resolution"]
    assert resolution["timed_out"] is True
    assert resolution["deferred"] == 1
