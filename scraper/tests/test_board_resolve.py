"""Bounded shared resolution keeps useful results without repeating a company."""

import urllib.error
from types import SimpleNamespace

import pytest

from workit_scraper import board_resolve as resolve
from workit_scraper.board_resolve import ResolveLink, resolve_links

ROBOTS = SimpleNamespace(allows=lambda _: True, pace=lambda _: None)


def link(number, company="Acme", source="list"):
    return ResolveLink(
        f"https://careers.{company.lower()}.com/job?gh_jid={number}", company, source
    )


class Web:
    def __init__(self, answers=None):
        self.answers = answers or {}
        self.calls = []

    def __call__(self, url):
        self.calls.append(url)
        answer = self.answers.get(url)
        if isinstance(answer, bytes):
            return answer
        if isinstance(answer, str):
            raise urllib.error.HTTPError(answer, 302, "redirect", None, None)
        raise urllib.error.HTTPError(url, 404, "missing", None, None)


def api(company, number):
    return f"https://boards-api.greenhouse.io/v1/boards/{company}/jobs/{number}"


def test_hundred_postings_need_one_successful_proof():
    web = Web({api("acme", 0): b"{}"})
    result = resolve_links([link(i) for i in range(100)], ROBOTS, web)
    assert web.calls == [api("acme", 0)]
    assert [(hit.ats, hit.token) for hit in result.hits] == [("greenhouse", "acme")]
    assert (result.total, result.attempted, result.deferred) == (1, 1, 0)


def test_retry_after_stale_posting_and_only_keep_proved_provenance():
    web = Web({api("acme", 2): b"{}"})
    result = resolve_links([link(1), link(2, source="one"), link(2, source="two")], ROBOTS, web)
    assert [hit.link.source for hit in result.hits] == ["one", "two"]
    assert web.calls.count(api("acme", 2)) == 1
    assert not any(hit.link.url == link(1).url for hit in result.hits)


def test_no_more_than_three_distinct_postings_per_group():
    web = Web({api("acme", 4): b"{}"})
    result = resolve_links([link(1), link(1), link(2), link(3), link(4)], ROBOTS, web)
    assert not result.hits
    assert api("acme", 4) not in web.calls
    assert web.calls.count(api("acme", 1)) == 1


def test_active_postings_are_tried_first():
    first = link(1)
    closed = ResolveLink(first.url, first.company, first.source, active=False)
    web = Web({api("acme", 2): b"{}"})
    result = resolve_links([closed, link(2)], ROBOTS, web)
    assert web.calls == [api("acme", 2)]
    assert result.hits[0].link == link(2)


@pytest.mark.parametrize("limit", [None, 1])
def test_conflicting_names_remain_separate_evidence_even_outside_budget(limit):
    original = link(1)
    other = ResolveLink(original.url, "Other", "other-list")
    web = Web({api("acme", 1): b"{}"})
    result = resolve_links([original, other], ROBOTS, web, limit=limit)
    assert result.total == 2
    assert {hit.link.company for hit in result.hits} == {"Acme", "Other"}
    assert {hit.token for hit in result.hits} == {"acme"}
    assert web.calls == [api("acme", 1)]


def test_short_links_can_reveal_two_boards_for_one_company():
    a = ResolveLink("https://go.vansh.nyc/a", "Acme", "source-a")
    b = ResolveLink("https://go.vansh.nyc/b", "Acme", "source-b")
    web = Web({a.url: "https://jobs.lever.co/acme", b.url: "https://jobs.ashbyhq.com/acme"})
    result = resolve_links([a, b], ROBOTS, web)
    assert {hit.ats for hit in result.hits} == {"lever", "ashby"}
    assert result.total == 2


def test_duplicate_short_link_preserves_sources_and_names_with_one_request():
    a = ResolveLink("https://go.vansh.nyc/a", "Acme", "one")
    b = ResolveLink(a.url, "Different claim", "two")
    web = Web({a.url: "https://jobs.lever.co/acme"})
    result = resolve_links([a, b, a], ROBOTS, web)
    assert web.calls == [a.url]
    assert [hit.link for hit in result.hits] == [a, b]


def test_short_link_careers_destination_is_proved():
    short = ResolveLink("https://go.vansh.nyc/a", "Acme", "one")
    web = Web({short.url: link(1).url, api("acme", 1): b"{}"})
    result = resolve_links([short], ROBOTS, web)
    assert result.hits[0].link == short
    assert result.hits[0].url == "https://job-boards.greenhouse.io/acme"


def test_short_link_careers_proof_keeps_all_name_claims():
    short = ResolveLink("https://go.vansh.nyc/a", "Acme", "one")
    other = ResolveLink(short.url, "Other", "two")
    web = Web({short.url: link(1).url, api("acme", 1): b"{}"})
    result = resolve_links([short, other], ROBOTS, web)
    assert [hit.link.company for hit in result.hits] == ["Acme", "Other"]
    assert web.calls == [short.url, api("acme", 1)]


def test_count_budget_rotates_stably_and_wraps():
    links = [link(1, company) for company in ("Gamma", "Acme", "Beta")]
    web = Web({api(company.lower(), 1): b"{}" for company in ("Acme", "Beta", "Gamma")})
    first = resolve_links(links, ROBOTS, web, limit=2)
    second = resolve_links(list(reversed(links)), ROBOTS, web, limit=2, offset=first.next_offset)
    assert [hit.link.company for hit in first.hits] == ["Acme", "Beta"]
    assert [hit.link.company for hit in second.hits] == ["Gamma", "Acme"]
    assert first.deferred == second.deferred == 1
    assert (first.next_offset, second.next_offset) == (2, 1)


def test_deadline_between_requests_keeps_completed_groups(monkeypatch):
    clock = [0.0]
    monkeypatch.setattr(resolve.time, "monotonic", lambda: clock[0])
    calls = []

    def get(url):
        calls.append(url)
        clock[0] += 1
        if "acme" in url:
            return b"{}"
        raise urllib.error.HTTPError(url, 404, "missing", None, None)

    result = resolve_links([link(1), link(1, "Beta"), link(1, "Gamma")], ROBOTS, get, seconds=2)
    assert [hit.token for hit in result.hits] == ["acme"]
    assert calls == [api("acme", 1), api("beta", 1)]
    assert result.timed_out
    assert (result.attempted, result.deferred) == (2, 2)
    assert result.next_offset == 2
    resumed = resolve_links(
        [link(1), link(1, "Beta"), link(1, "Gamma")],
        ROBOTS,
        get,
        seconds=2,
        offset=result.next_offset,
        limit=1,
    )
    assert calls[2] == api("gamma", 1)
    assert resumed.next_offset == 0


def test_deadline_after_robots_check_starts_no_http_request(monkeypatch):
    clock = [0.0]
    monkeypatch.setattr(resolve.time, "monotonic", lambda: clock[0])

    def allows(url):
        clock[0] = 3
        return True

    robots = SimpleNamespace(allows=allows, pace=lambda _: pytest.fail("deadline passed"))
    web = Web()
    result = resolve_links([link(1)], robots, web, seconds=2)
    assert result.timed_out and result.deferred == 1
    assert not web.calls


def test_zero_budget_and_direct_urls_need_no_network():
    web = Web()
    result = resolve_links([link(1)], ROBOTS, web, limit=0)
    assert (result.total, result.attempted, result.deferred) == (1, 0, 1)
    result = resolve_links([ResolveLink("https://jobs.lever.co/acme", "Acme")], ROBOTS, web)
    assert result.total == 0
    assert not web.calls


def test_malformed_careers_url_does_not_abort_other_groups():
    web = Web({api("acme", 1): b"{}"})
    result = resolve_links(
        [ResolveLink("https://[?gh_jid=1", "Broken"), link(1)],
        ROBOTS,
        web,
    )
    assert [hit.token for hit in result.hits] == ["acme"]
    assert web.calls == [api("acme", 1)]
