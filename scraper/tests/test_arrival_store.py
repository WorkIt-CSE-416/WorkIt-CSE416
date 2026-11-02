"""Partial observations must never serve as evidence that an old posting closed."""

import json
import zlib
from dataclasses import replace
from datetime import UTC, datetime, timedelta

import pytest

from workit_scraper import details, store
from workit_scraper.providers import Board, Job, Page
from workit_scraper.store import BoardHealth, BoardReads, RunStats, Store

BOARD = Board("workday", "acme.wd5/external", "Acme")
KEY = BOARD.key


def at(hours):
    return (datetime(2026, 10, 1, tzinfo=UTC) + timedelta(hours=hours)).isoformat()


def job(eid="1"):
    return Job(
        ats=BOARD.ats,
        token=BOARD.token,
        company=BOARD.company,
        external_id=eid,
        title="Software Engineer Intern",
        apply_url=f"https://example.test/{eid}",
    )


def complete(previous, hours, *jobs, ordering=None):
    return store.update(previous, list(jobs), [KEY], RunStats(ordering={KEY: ordering}), at(hours))


def partial(previous, hours, *jobs):
    return store.update(
        previous, list(jobs), [], RunStats(boards_partial=1, arrival_boards=[KEY]), at(hours)
    )


def listed(run):
    return {j.external_id for j in run.jobs if run.is_listed(j)}


def test_partial_never_closes_old_jobs_or_moves_complete_times():
    baseline = complete(None, 0, job(), job("2"), ordering=True)
    run = partial(baseline, 1, job("3"))
    assert listed(run) == {"1", "2", "3"}
    assert run.boards[KEY] == replace(baseline.boards[KEY], last_arrival_at=at(1))
    assert run.arrivals == {KEY: at(1)}
    run = complete(run, 2, job("3"))
    assert listed(run) == {"1", "2", "3"}
    run = partial(run, 3, job("3"))
    assert listed(run) == {"1", "2", "3"}
    run = complete(run, 4, job("3"))
    assert listed(run) == {"3"}
    assert run.boards[KEY].last_arrival_at == at(3)


def test_partial_refresh_between_complete_reads_counts_as_observed():
    run = complete(None, 0, job())
    run = partial(run, 1, job())
    run = complete(run, 2)
    assert listed(run) == {"1"}
    assert run.missed_once() == {KEY}
    run = complete(run, 3)
    assert listed(run) == set()


def test_partial_reopens_closed_job_and_keeps_first_seen():
    run = complete(complete(complete(None, 0, job()), 1), 2)
    assert not listed(run)
    before = run.boards[KEY]
    run = partial(run, 3, job())
    assert listed(run) == {"1"}
    assert run.jobs[0].first_seen_at == at(0)
    assert run.boards[KEY] == replace(before, last_arrival_at=at(3))
    assert listed(complete(run, 4)) == {"1"}
    assert not listed(complete(complete(run, 4), 5))


def test_first_partial_has_visible_jobs_without_inventing_baseline():
    failed = store.update(None, [], [], RunStats(unread={KEY: "timeout"}), at(-1))
    run = partial(failed, 0, job())
    assert run.health == {}
    assert run.boards == {}
    assert run.arrivals == {KEY: at(0)}
    assert listed(run) == {"1"}
    run = complete(run, 1)
    assert listed(run) == {"1"}
    assert run.boards[KEY].first_read_at == at(1)
    assert run.boards[KEY].last_arrival_at == at(0)


def test_partial_after_missing_resets_health_and_consecutive_missing():
    run = complete(None, 0, job())
    run = store.update(run, [], [], RunStats(unread={KEY: "no such board"}), at(1), missing=[KEY])
    assert run.boards[KEY].missing_at == at(1)
    assert run.health[KEY].failures == 1
    run = partial(run, 2)
    assert run.boards[KEY].missing_at is None
    assert run.boards[KEY].last_read_at == at(0)
    assert run.health == {}
    run = store.update(run, [], [], RunStats(), at(3), missing=[KEY])
    assert listed(run) == {"1"}
    assert run.boards[KEY].last_read_at == at(0)
    run = store.update(run, [], [], RunStats(), at(4), missing=[KEY])
    assert not listed(run)


@pytest.mark.parametrize("audit_miss", [False, True])
def test_disabled_is_sticky_across_later_ordered_complete_reads(audit_miss):
    run = complete(None, 0, ordering=True)
    assert run.boards[KEY].arrival_safe
    stats = RunStats(arrival_misses=[KEY]) if audit_miss else RunStats(ordering={KEY: False})
    run = store.update(run, [], [KEY], stats, at(1))
    run = complete(run, 2, ordering=True)
    assert run.boards[KEY].arrival_disabled
    assert not run.boards[KEY].arrival_safe


def test_only_true_complete_order_enables_safety():
    run = complete(None, 0)
    assert not run.boards[KEY].arrival_safe
    run = store.update(run, [], [], RunStats(arrival_boards=[KEY], ordering={KEY: True}), at(1))
    assert not run.boards[KEY].arrival_safe
    run = complete(run, 2, ordering=True)
    assert run.boards[KEY].arrival_safe
    assert not complete(run, 3).boards[KEY].arrival_safe


def test_screened_cache_merges_expires_and_fresh_kept_wins():
    def rejection(hours):
        return {"title": "Senior Engineer", "checked_at": at(hours), "page_version": 1}

    run = store.update(
        None,
        [],
        [],
        RunStats(rejected_details={"expired": rejection(0), "boundary": rejection(1)}),
        at(1),
    )
    run = store.update(
        run,
        [job()],
        [],
        RunStats(rejected_details={job().key: rejection(25), "new": rejection(25)}),
        at(25),
    )
    assert run.screened == {"boundary": rejection(1), "new": rejection(25)}
    run = store.update(run, [], [], RunStats(), at(25.01))
    assert run.screened == {"new": rejection(25)}


def test_arrivals_include_quiet_paged_boards_but_honor_rest():
    run = complete(None, 0, ordering=True)
    # Choose a quiet slot where ordinary scheduling deliberately excludes this board.
    hours = next(
        h
        for h in (1, 4, 7)
        if zlib.crc32(KEY.encode()) % store.QUIET_EVERY
        != int(datetime.fromisoformat(at(h)).timestamp() // store.RUN_EVERY.total_seconds())
        % store.QUIET_EVERY
    )
    assert run.to_read([BOARD], at(hours)) == []
    assert run.to_read([BOARD], at(hours), arrivals=True) == [BOARD]
    run = replace(run, health={KEY: BoardHealth(3, "timeout", at(10))})
    assert run.to_read([BOARD], at(hours), arrivals=True, everything=True) == []


def test_arrival_priority_uses_partial_time_and_unsafe_boards_use_full_time():
    safe = Board("workday", "safe", "Safe")
    unsafe = Board("workday", "unsafe", "Unsafe")
    prefix = Board("oracle", "prefix", "Prefix")
    run = Store(
        at(10),
        RunStats(),
        [],
        {
            KEY: BoardReads(at(0), at(0), arrival_safe=True, last_arrival_at=at(9)),
            safe.key: BoardReads(at(0), at(8), arrival_safe=True, last_arrival_at=at(2)),
            unsafe.key: BoardReads(at(0), at(1), arrival_disabled=True),
        },
        arrivals={KEY: at(9), safe.key: at(2), unsafe.key: at(9), prefix.key: at(3)},
    )
    assert run.to_read([BOARD, safe, unsafe, prefix], at(10), arrivals=True) == [
        unsafe,
        safe,
        prefix,
        BOARD,
    ]


def test_state_round_trip_and_legacy_defaults(tmp_path):
    run = partial(complete(None, 0, job(), ordering=True), 1, job("2"))
    stats = RunStats(
        boards_partial=1,
        arrival_boards=[KEY],
        ordering={KEY: False},
        arrival_misses=[KEY],
        rejected_details={"rejected": {"title": "Senior", "checked_at": at(2), "page_version": 2}},
    )
    run = store.update(run, [], [], stats, at(2))
    path = tmp_path / "jobs.json"
    store.save(run, path)
    assert store.load(path) == replace(run, jobs=sorted(run.jobs, key=lambda j: j.key))
    payload = json.loads(path.read_text(encoding="utf-8"))
    for name in ("arrivals", "screened", "arrival_blocked"):
        payload.pop(name)
    payload["stats"] = {}
    for name in ("last_arrival_at", "arrival_safe", "arrival_disabled"):
        payload["boards"][KEY].pop(name)
    path.write_text(json.dumps(payload), encoding="utf-8")
    legacy = store.load(path)
    assert legacy.arrivals == legacy.screened == {}
    assert legacy.arrival_blocked == []
    assert legacy.stats == RunStats()
    assert legacy.boards[KEY] == BoardReads(at(0), at(0))


def test_listing_compares_instants_not_iso_string_format():
    run = complete(complete(None, 0, job()), 1)
    observed = replace(run.jobs[0], last_seen_at="2026-09-30T20:00:00-04:00")
    assert run.is_listed(observed)


@pytest.mark.parametrize("tags", [("internship",), ()])
def test_carried_detail_page_keeps_full_text_decision_only_for_same_title(tags):
    page = Page(version=17, description="Trimmed display text", facts=details.Facts())
    old = replace(job(), page=page, shortlist_tags=tags)
    carried = store.carry(job(), {old.key: old})
    assert carried.page == page
    assert carried.shortlist_tags == tags
    changed = store.carry(replace(job(), title="Changed title"), {old.key: old})
    assert changed.shortlist_tags is None
    fresh = replace(job(), page=replace(page, description="Fresh text"))
    assert store.carry(fresh, {old.key: old}).shortlist_tags is None


@pytest.mark.parametrize("audit_miss", [False, True])
def test_unsafe_first_prefix_persists_without_complete_baseline(tmp_path, audit_miss):
    stats = RunStats(arrival_misses=[KEY]) if audit_miss else RunStats(ordering={KEY: False})
    run = store.update(None, [], [], stats, at(0))
    assert run.boards == {}
    assert run.arrival_blocked == [KEY]
    path = tmp_path / "jobs.json"
    store.save(run, path)
    run = store.load(path)
    assert run.arrival_blocked == [KEY]
    run = complete(run, 1, ordering=True)
    assert run.boards[KEY].arrival_disabled
    assert not run.boards[KEY].arrival_safe
    assert run.arrival_blocked == [KEY]


def test_priority_matches_provider_support_and_newest_first_guarantee():
    oracle = Board("oracle", "acme", "Acme")
    unsupported = Board("tiktok", "acme", "Acme")
    run = Store(
        at(10),
        RunStats(),
        [],
        {
            oracle.key: BoardReads(at(0), at(0)),
            unsupported.key: BoardReads(at(1), at(1), arrival_safe=True),
        },
        arrivals={oracle.key: at(9), unsupported.key: at(10)},
    )
    assert run.to_read([oracle, unsupported], at(10), arrivals=True) == [unsupported, oracle]
    run = replace(run, arrival_blocked=[oracle.key])
    assert run.to_read([oracle, unsupported], at(10), arrivals=True) == [oracle, unsupported]


def test_complete_read_with_unclear_order_revokes_previous_observation():
    run = complete(None, 0, ordering=True)
    assert run.boards[KEY].arrival_safe
    run = complete(run, 1, ordering=None)
    assert not run.boards[KEY].arrival_safe
    assert not run.boards[KEY].arrival_disabled
    run = complete(run, 2, ordering=True)
    assert run.boards[KEY].arrival_safe
