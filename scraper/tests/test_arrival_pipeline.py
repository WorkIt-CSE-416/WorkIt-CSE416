"""Arrival mode must preserve closure evidence and respect provider ordering."""

from dataclasses import replace
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace

import pytest

from workit_scraper import __main__ as run
from workit_scraper import providers, store
from workit_scraper.board_read import ReadStatus, read_board
from workit_scraper.providers import Board, Job
from workit_scraper.providers.text import _page

ROBOTS = SimpleNamespace(allows=lambda url: True, pace=lambda url: None)
NOW = "2026-10-30T09:00:00+00:00"


def job(board, id="1", date="2026-10-30", title="Software Engineer Intern"):
    return Job(
        board.ats,
        board.token,
        board.company,
        id,
        title,
        f"https://example.test/{id}",
        posted_at=date,
    )


def baseline(board, **kwargs):
    return store.Store(NOW, store.RunStats(), [], {board.key: store.BoardReads(NOW, NOW, **kwargs)})


def test_planning_requires_order_and_honors_audit_disable():
    wd = Board("workday", "a.wd1/site", "A")
    oracle = Board("oracle", "a/site", "A")
    sf = Board("successfactors", "a.test", "A")
    tt = Board("tiktok", "tiktok", "TikTok")
    assert run.planned_arrivals([wd, oracle, sf, tt], None) == {oracle.key}
    assert run.planned_arrivals([wd], baseline(wd, arrival_safe=True)) == {wd.key}
    assert not run.planned_arrivals([oracle], baseline(oracle, arrival_disabled=True))


def test_partial_reads_never_become_complete_even_for_empty_board(swap_provider):
    b = Board("oracle", "a/site", "A")
    swap_provider("oracle", arrival=lambda *a, **kw: [])
    result = read_board(b, ROBOTS, arrival=True)
    assert result.status is ReadStatus.PARTIAL
    scanned, stats, complete, missing = run.scrape([b], ROBOTS, {}, mode="arrivals")
    assert scanned == complete == missing == []
    assert stats.arrival_boards == [b.key]
    assert stats.boards_partial == 1


def test_broken_prefix_order_retries_full_and_disables_shortcut(swap_provider):
    b = Board("oracle", "a/site", "A")
    calls = []
    reversed_dates = [job(b, "1", "2026-10-28"), job(b, "2", "2026-10-30")]
    swap_provider(
        "oracle",
        arrival=lambda *a, **kw: reversed_dates,
        read=lambda *a, **kw: calls.append("full") or list(reversed(reversed_dates)),
        describe=lambda j: replace(j, page=_page(j.title, "Internship.")),
    )
    _, stats, complete, _ = run.scrape([b], ROBOTS, {}, mode="arrivals")
    assert calls == ["full"]
    assert complete == [b.key]
    assert stats.ordering[b.key] is False
    assert stats.arrival_boards == []


def test_full_read_records_order_before_detail_dates_change(swap_provider):
    b = Board("workday", "a.wd1/site", "A")
    swap_provider(
        "workday",
        read=lambda *a, **kw: [job(b, "1"), job(b, "2", "2026-10-29")],
        describe=lambda j: replace(j, posted_at="2026-01-01", page=_page(j.title, "Intern")),
    )
    _, stats, complete, _ = run.scrape([b], ROBOTS, {})
    assert stats.ordering[b.key] is True
    assert complete == [b.key]


def test_daily_full_audit_flags_older_unseen_kept_postings(swap_provider):
    b = Board("oracle", "a/site", "A")
    prior = replace(baseline(b), arrivals={b.key: NOW})
    swap_provider(
        "oracle",
        read=lambda *a, **kw: [job(b, "new", "2026-10-28")],
        describe=lambda j: replace(j, page=_page(j.title, "Intern")),
    )
    _, stats, _, _ = run.scrape([b], ROBOTS, {}, previous=prior, mode="sweep")
    assert stats.arrival_misses == [b.key]


@pytest.mark.parametrize("ats", ["workday", "oracle", "successfactors"])
def test_ambiguous_paged_titles_get_description_fallback(ats, swap_provider):
    b = Board(ats, "a.wd1/site" if ats == "workday" else "a/site", "A")
    j = job(b, title="Software Engineer")
    calls = []

    def describe(j):
        calls.append(j.key)
        return replace(
            j,
            page=_page(j.title, "No experience required."),
            shortlist_tags=("new-grad", "software"),
        )

    swap_provider(ats, describe=describe)
    assert run.needs_page(j)
    assert run.classify_job(run.with_page(j, ROBOTS))
    assert calls == [j.key]
    assert not run.needs_page(replace(j, title="Senior Software Engineer"))
    assert not run.needs_page(replace(j, title="Recruiter"))


def test_rejected_detail_cache_prevents_repeated_requests_and_expires(swap_provider):
    b = Board("oracle", "a/site", "A")
    j = job(b, title="Software Engineer")
    calls = []

    def describe(j):
        calls.append(j.key)
        return replace(j, page=_page(j.title, "5+ years of experience."), shortlist_tags=())

    swap_provider("oracle", read=lambda *a, **kw: [j], describe=describe)
    _, stats, _, _ = run.scrape([b], ROBOTS, {})
    assert list(stats.rejected_details) == [j.key]
    prior = replace(baseline(b), screened=stats.rejected_details)
    scanned, cached_stats, _, _ = run.scrape([b], ROBOTS, {}, previous=prior)
    assert cached_stats.by_provider["oracle"]["pages"] == 0
    assert not run.classify_job(scanned[0])
    assert calls == [j.key]
    expired = {
        j.key: {
            **stats.rejected_details[j.key],
            "checked_at": (datetime.now(UTC) - timedelta(days=2)).isoformat(),
        }
    }
    run.scrape([b], ROBOTS, {}, previous=replace(prior, screened=expired))
    assert calls == [j.key, j.key]


def test_detail_failure_is_not_cached_as_rejection(swap_provider):
    b = Board("oracle", "a/site", "A")

    def fail(j):
        raise TimeoutError()

    swap_provider(
        "oracle", read=lambda *a, **kw: [job(b, title="Software Engineer")], describe=fail
    )
    scanned, stats, _, _ = run.scrape([b], ROBOTS, {})
    assert scanned[0].page is None
    assert stats.rejected_details == {}


def test_sweep_removes_lane_budget_but_still_honors_global_deadline(swap_provider):
    b = Board("oracle", "a/site", "A")
    swap_provider("oracle", budget_s=-1, read=lambda *a, **kw: [])
    _, stats, _, _ = run.scrape([b], ROBOTS, {}, mode="full")
    assert stats.boards_deferred == 1
    _, stats, complete, _ = run.scrape([b], ROBOTS, {}, mode="sweep")
    assert complete == [b.key]
    assert stats.boards_deferred == 0
    results, *_ = run._lane([b], ROBOTS, {}, boards_until=-1, sweep=True)
    assert results == [(run.Outcome.DEFERRED, [])]


def test_detail_budget_is_reported_without_caching_a_rejection(monkeypatch, swap_provider):
    b = Board("oracle", "a/site", "A")
    monkeypatch.setattr(run, "PAGES_UNTIL_S", -1)
    swap_provider(
        "oracle",
        read=lambda *a, **kw: [job(b, title="Software Engineer")],
        describe=lambda j: pytest.fail("requested after detail deadline"),
    )
    _, stats, _, _ = run.scrape([b], ROBOTS, {})
    assert stats.by_provider["oracle"]["pending_details"] == 1
    assert stats.rejected_details == {}


def test_changed_title_and_parser_version_invalidate_rejection_cache(swap_provider):
    b = Board("oracle", "a/site", "A")
    j = job(b, title="Software Engineer")
    calls = []
    swap_provider("oracle", read=lambda *a, **kw: [j], describe=lambda j: calls.append(j.key) or j)
    for title, version in [
        ("Data Analyst", providers.PAGE_VERSION),
        (j.title, providers.PAGE_VERSION - 1),
    ]:
        cached = {
            j.key: {
                "title": title,
                "page_version": version,
                "checked_at": datetime.now(UTC).isoformat(),
            }
        }
        run.scrape([b], ROBOTS, {}, previous=replace(baseline(b), screened=cached))
    assert calls == [j.key, j.key]


@pytest.mark.parametrize(
    "arguments,expected",
    [
        (["--scan-mode", "arrivals"], "arrivals"),
        (["--scan-mode", "sweep"], "sweep"),
        (["--scan-mode", "arrivals", "--full"], "sweep"),
    ],
)
def test_cli_passes_scan_mode_and_saves_state(monkeypatch, tmp_path, arguments, expected):
    b = Board("oracle", "a/site", "A")
    for name in ("JOBS_JSON", "PAGE_HTML", "FEED_JSON", "CLOSINGS_JSON", "METRICS_JSON"):
        monkeypatch.setattr(run, name, tmp_path / name)
    monkeypatch.setattr(run, "load_boards", lambda path: [b])
    monkeypatch.setattr(run, "Robots", lambda urls: ROBOTS)
    monkeypatch.setattr(run.logos, "fetch", lambda boards: {})
    calls = []

    def scrape(boards, robots, before, *, previous, mode):
        calls.append(mode)
        return [], store.RunStats(), [], []

    monkeypatch.setattr(run, "scrape", scrape)
    assert run.main(["--boards", str(tmp_path / "boards.csv"), *arguments]) == 0
    assert calls == [expected]
    assert store.load(tmp_path / "JOBS_JSON") is not None


def test_invalid_prefix_does_not_start_full_retry_after_deadline(monkeypatch):
    b = Board("oracle", "a/site", "A")
    now = [0.0]
    monkeypatch.setattr(run.time, "monotonic", lambda: now[0])

    def read(board, robots, *, arrival=False):
        assert arrival
        now[0] = 10.0
        return run.Outcome.PARTIAL, [job(b, date=None)], None

    monkeypatch.setattr(run, "_scrape_one", read)
    observations = {}
    results, *_ = run._lane(
        [b], ROBOTS, {}, boards_until=5, arrival_keys={b.key}, observations=observations
    )
    assert results == [(run.Outcome.DEFERRED, [])]
    assert observations == {b.key: False}
