"""Discovery sources produce attributed evidence, never silently invented companies."""

import json

import pytest

from workit_scraper.discovery_channels import (
    CHANNELS,
    DiscoveryError,
    collect,
    curated_rows,
    hn_company,
    urls,
)
from workit_scraper.discovery_sources import CURATED_SOURCES, Source


def encoded(value):
    return json.dumps(value).encode()


def test_curated_keeps_explicit_names_and_does_not_guess_from_urls():
    found = curated_rows([
        {"company_name": "Acme", "url": "https://jobs.lever.co/acme/job"},
        {"url": "https://jobs.ashbyhq.com/other/job"},
    ], Source("public-list"))
    assert [(e.company, e.url) for e in found] == [
        ("Acme", "https://jobs.lever.co/acme/job"),
        ("", "https://jobs.ashbyhq.com/other/job"),
    ]


def test_hn_filters_sibling_threads_and_unescapes_links():
    reads = []

    def read(url):
        reads.append(url)
        if "search_by_date" in url:
            return encoded({"hits": [
                {"title": "Ask HN: Who wants to be hired?", "objectID": "1"},
                {"title": "Ask HN: Who is hiring? (October 2026)", "objectID": "2"},
            ]})
        return encoded({"children": [
            {"text": 'Acme | Engineer | '
                     '<a href="https:&#x2F;&#x2F;jobs.lever.co/acme/job">Apply</a>'},
            {"text": 'We are hiring: https://jobs.ashbyhq.com/example'},
        ]})

    found = collect("hn", read, limit=1).evidence
    assert [(e.company, e.url) for e in found] == [
        ("Acme", "https://jobs.lever.co/acme/job"),
        ("", "https://jobs.ashbyhq.com/example"),
    ]
    assert reads[1].endswith("/2")
    assert len(reads) == 2


def test_ddg_only_extracts_result_links_and_unwraps_redirects():
    page = b'''<a href="https://duckduckgo.com/settings">Settings</a>
    <a class="result__a"
       href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fjobs.lever.co%2Facme&amp;x=1">Acme</a>
    <a class="result__a" href="https://jobs.ashbyhq.com/second">Second</a>'''
    found = collect("ddg", lambda _: page, query="site:jobs.lever.co fintech", limit=1).evidence
    assert len(found) == 1
    assert found[0].url == "https://jobs.lever.co/acme"
    assert found[0].company == ""


def test_github_auth_stays_in_headers_and_fragments_have_file_provenance():
    def read(url, *, headers):
        assert "secret" not in url
        assert headers["Authorization"] == "Bearer secret"
        return encoded({"items": [{
            "html_url": "https://github.com/org/repo/blob/main/jobs.md",
            "text_matches": [{"fragment": "Apply: https://jobs.lever.co/acme/job"}],
        }]})

    found = collect("github", read, query="jobs.lever.co",
                    environ={"GITHUB_TOKEN": "secret"}).evidence
    assert found[0].source.endswith("/jobs.md")
    assert found[0].company == ""


def test_google_credentials_not_in_evidence_and_request_is_capped():
    def read(url, *, headers):
        assert "secret" not in url
        assert "num=10" in url
        assert headers == {"X-Goog-Api-Key": "secret"}
        return encoded({"items": [{"link": "https://jobs.ashbyhq.com/acme"}]})

    found = collect("google", read, query="internships", limit=100,
                    environ={"GOOGLE_CSE_KEY": "secret", "GOOGLE_CSE_CX": "engine"}).evidence
    assert "secret" not in found[0].source


@pytest.mark.parametrize("channel", ["github", "google"])
def test_missing_credentials_fail_before_network(channel):
    def read(*args, **kwargs):
        pytest.fail("must not request without credentials")

    with pytest.raises(DiscoveryError, match="needs"):
        collect(channel, read, query="jobs", environ={})


def test_failed_source_is_not_reported_as_successful_empty_search():
    def read(url):
        raise OSError("sensitive request details")

    result = collect("curated", read, sources=[Source("https://example.org/jobs.json")])
    assert result.evidence == []
    assert result.failures[0].error == "OSError"
    assert result.failures[0].source == "https://example.org/jobs.json"


def test_unknown_channel_and_invalid_bounds_are_rejected():
    with pytest.raises(DiscoveryError, match="unknown"):
        collect("cc", lambda _: b"")
    with pytest.raises(DiscoveryError, match="limit"):
        collect("hn", lambda _: b"", limit=0)
    with pytest.raises(DiscoveryError, match="explicit"):
        collect("ddg", lambda _: b"")


def test_urls_unescape_and_deduplicate_without_following_anything():
    assert urls('https:\\/\\/jobs.lever.co/acme https://jobs.lever.co/acme') == [
        "https://jobs.lever.co/acme"
    ]


def test_ddg_challenge_is_not_a_successful_empty_search():
    with pytest.raises(DiscoveryError, match="possibly blocked"):
        collect("ddg", lambda _: b"<html>Please solve this challenge</html>", query="jobs")
    assert collect("ddg", lambda _: b'<div class="no-results">None</div>',
                   query="jobs").evidence == []


def test_curated_limit_does_not_hide_new_boards_behind_known_ones():
    payload = [
        {"company_name": "Existing", "url": "https://jobs.lever.co/known"},
        {"company_name": "New", "url": "https://jobs.lever.co/new"},
    ]
    found = collect("curated", lambda _: encoded(payload), limit=1,
                    sources=[Source("https://example.org/list.json")]).evidence
    assert len(found) == 2
    assert found[-1].company == "New"


@pytest.mark.parametrize("text", [
    "We are hiring | Engineer | Remote", "Senior Engineer | Acme | Remote",
    "I am seeking work | Engineer", "Join us | Intern",
])
def test_hn_prose_and_job_headers_are_not_company_names(text):
    assert hn_company(text) == ""


def test_company_source_ignores_homepage_and_nested_metadata():
    source = Source("company-list", "jobs_url", ("company_name",))
    found = curated_rows([{
        "company_name": "Acme", "company_url": "https://acme.example",
        "jobs_url": "https://jobs.lever.co/acme",
        "metadata": {"reference": "https://jobs.lever.co/other"},
    }], source)
    assert [(e.company, e.url) for e in found] == [("Acme", "https://jobs.lever.co/acme")]


@pytest.mark.parametrize("payload", [
    {"items": []}, [{"company_name": "Acme", "homepage": "https://acme.example"}],
    [{"url": ["https://jobs.lever.co/acme"]}], [{"url": "not a URL"}],
])
def test_unknown_curated_schema_is_explicit_error(payload):
    result = collect("curated", lambda _: encoded(payload), sources=[Source("test-source")])
    assert not result.evidence
    assert len(result.failures) == 1
    assert result.failures[0].source == "test-source"


def test_curated_failure_preserves_earlier_success_and_continues():
    visited = []
    def read(url):
        visited.append(url)
        if url == "broken":
            raise TimeoutError("sensitive")
        return encoded([{"company_name": url, "url": f"https://jobs.lever.co/{url}"}])
    result = collect("curated", read, sources=[Source(s) for s in ["good", "broken", "later"]])
    assert visited == ["good", "broken", "later"]
    assert [e.company for e in result.evidence] == ["good", "later"]
    assert [(f.source, f.error) for f in result.failures] == [("broken", "TimeoutError")]


def test_all_curated_sources_failing_remain_visible():
    def read(_):
        raise OSError("private")
    result = collect("curated", read, sources=[Source("one"), Source("two")])
    assert not result.evidence
    assert [f.source for f in result.failures] == ["one", "two"]


def test_hn_failed_thread_keeps_other_threads_and_comment_provenance():
    def read(url):
        if "search_by_date" in url:
            return encoded({"hits": [
                {"title": "Who is hiring?", "objectID": str(i)} for i in (1, 2, 3)
            ]})
        if url.endswith("/2"):
            raise TimeoutError()
        identifier = url.rsplit("/", 1)[-1]
        return encoded({"children": [{"id": int(identifier) + 10,
            "text": f"Acme | Engineer | https://jobs.lever.co/acme{identifier}"}]})
    result = collect("hn", read)
    assert [e.source for e in result.evidence] == [
        "https://news.ycombinator.com/item?id=11", "https://news.ycombinator.com/item?id=13",
    ]
    assert len(result.failures) == 1
    assert result.failures[0].source.endswith("/2")


def test_registry_declares_queries_and_curated_source_schemas():
    assert {name for name, channel in CHANNELS.items() if channel.requires_query} == {
        "ddg", "github", "google",
    }
    assert [source.url_field for source in CURATED_SOURCES] == ["url"] * 3 + ["jobs_url"] * 4
