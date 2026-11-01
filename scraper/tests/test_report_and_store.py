"""The page's "new today" and "open roles" claims, and the store that backs them.

Both fail silently: a wrong flag still renders a plausible page, and a lost
first_seen_at just makes every role look new again. Each case below is one of the
ways the count was, or could have been, wrong.
"""

from __future__ import annotations

import json
from datetime import datetime, timedelta
from pathlib import Path

from workit_scraper import report, store
from workit_scraper.providers import Board, Job
from workit_scraper.shortlist import pick
from workit_scraper.store import BoardReads, RunStats, Store

MON = "2026-09-28T09:00:00+00:00"
MON_PM = "2026-09-28T17:00:00+00:00"
TUE = "2026-09-29T09:00:00+00:00"
THU = "2026-10-01T09:00:00+00:00"
STRIPE = "greenhouse/stripe"


def job(eid: str, title: str = "Software Engineer, Intern", token: str = "stripe") -> Job:
    return Job(
        ats="greenhouse",
        token=token,
        company=token.title(),
        external_id=eid,
        title=title,
        apply_url=f"https://example.test/{eid}",
    )


def scrape(previous: Store | None, now: str, *listed: Job, boards: tuple[str, ...] = (STRIPE,)):
    return store.update(previous, list(listed), list(boards), RunStats(), now)


def new_ids(run: Store) -> set[str]:
    return {j.external_id for j in run.jobs if run.is_listed(j) and run.is_new(j)}


class TestNewToday:
    def test_a_first_run_has_no_number_to_report(self):
        run = scrape(None, MON, job("1"))
        assert not run.counts_new
        assert new_ids(run) == set()

    def test_a_posting_that_appears_on_a_watched_board_is_new(self):
        run = scrape(scrape(None, MON, job("1")), TUE, job("1"), job("2"))
        assert run.counts_new
        assert new_ids(run) == {"2"}

    def test_a_second_run_the_same_day_still_counts_the_first_runs_arrivals(self):
        # "New since the last run" would have dropped posting 2 here.
        monday = scrape(scrape(None, MON, job("1")), TUE, job("1"), job("2"))
        run = scrape(monday, TUE.replace("09:", "10:"), job("1"), job("2"))
        assert new_ids(run) == {"2"}

    def test_the_window_is_24_hours_not_since_the_last_run(self):
        # Runs days apart must not sum days of arrivals into one "today".
        run = scrape(scrape(None, MON, job("1")), MON_PM, job("1"), job("2"))
        run = scrape(run, THU, job("1"), job("2"), job("3"))
        assert new_ids(run) == {"3"}

    def test_a_board_added_to_boards_csv_brings_no_new_postings(self):
        acme = "greenhouse/acme"
        run = scrape(
            scrape(None, MON, job("1")),
            TUE,
            job("1"),
            job("9", token="acme"),
            boards=(STRIPE, acme),
        )
        assert new_ids(run) == set()
        run = scrape(
            run,
            THU,
            job("1"),
            job("9", token="acme"),
            job("10", token="acme"),
            boards=(STRIPE, acme),
        )
        assert new_ids(run) == {"10"}


def listed_ids(run: Store) -> set[str]:
    return {j.external_id for j in run.jobs if run.is_listed(j)}


class TestOpenRoles:
    def test_a_posting_gone_from_one_complete_read_is_still_listed(self):
        run = scrape(scrape(None, MON, job("1"), job("2")), TUE, job("1"))
        assert listed_ids(run) == {"1", "2"}
        assert run.missed_once() == {STRIPE}

    def test_gone_from_two_complete_reads_in_a_row_it_is_kept_but_not_listed(self):
        run = scrape(scrape(scrape(None, MON, job("1"), job("2")), TUE, job("1")), THU, job("1"))
        assert {j.external_id for j in run.jobs} == {"1", "2"}
        assert listed_ids(run) == {"1"}
        assert run.missed_once() == set()

    def test_one_empty_answer_closes_nothing(self):
        # A hiring system mid-outage answering with an empty list reads as a real
        # board with nothing open. Before two reads, that one answer closed every
        # posting on the board in Supabase until the next read.
        run = scrape(scrape(None, MON, job("1"), job("2")), TUE)
        assert listed_ids(run) == {"1", "2"}
        run = scrape(run, THU, job("1"), job("2"))
        assert listed_ids(run) == {"1", "2"}
        assert run.missed_once() == set()

    def test_back_on_the_second_read_starts_the_count_again(self):
        run = scrape(scrape(None, MON, job("1"), job("2")), TUE, job("1"))
        run = scrape(run, THU, job("1"), job("2"))
        run = scrape(run, "2026-10-02T09:00:00+00:00", job("1"))
        assert listed_ids(run) == {"1", "2"}

    def test_a_failed_read_between_the_two_is_no_read(self):
        run = scrape(scrape(None, MON, job("1"), job("2")), TUE, job("1"))
        run = scrape(run, THU, boards=())
        assert listed_ids(run) == {"1", "2"}
        run = scrape(run, "2026-10-02T09:00:00+00:00", job("1"))
        assert listed_ids(run) == {"1"}

    def test_a_board_that_failed_this_run_keeps_its_postings_listed(self):
        run = scrape(scrape(None, MON, job("1")), TUE, boards=())
        assert all(run.is_listed(j) for j in run.jobs)

    def test_first_seen_at_never_moves(self):
        run = scrape(scrape(None, MON, job("1")), TUE, job("1"))
        assert (run.jobs[0].first_seen_at, run.jobs[0].last_seen_at) == (MON, TUE)


class TestPage:
    def page(self, run: Store) -> str:
        roles = pick([j for j in run.jobs if run.is_listed(j)], is_new=run.is_new)
        return report.render(roles, run.stats, run.scraped_at, counts_new=run.counts_new)

    def test_only_new_roles_say_just_added(self):
        run = scrape(
            scrape(None, MON, job("1")), TUE, job("1"), job("2", "Software Engineer, New Grad")
        )
        assert self.page(run).count(">just added<") == 1

    def test_a_run_that_saw_nothing_new_marks_nothing(self):
        # The regression: every row once said "just added", because the row read the
        # module's always-truthy `is_new` function instead of its own flag.
        run = scrape(scrape(None, MON, job("1")), TUE, job("1"))
        assert ">just added<" not in self.page(run)

    def test_the_page_says_when_it_was_scraped(self):
        # An --offline render days later must not pass off an old count as today's.
        assert "Scraped Sep 29, 2026, 09:00 UTC" in self.page(scrape(None, TUE, job("1")))


class TestFile:
    def test_round_trip(self, tmp_path: Path):
        saved = Store(
            TUE,
            RunStats(postings=3, boards_ok=1),
            [job("1")],
            {STRIPE: BoardReads(MON, TUE, prior_read_at=MON)},
        )
        path = tmp_path / "jobs.json"
        store.save(saved, path)
        assert store.load(path) == saved

    def test_a_store_with_fields_this_code_lacks_still_loads(self, tmp_path: Path):
        # What newer code may write, read back by this code after a revert.
        saved = Store(TUE, RunStats(postings=3), [job("1")], {STRIPE: BoardReads(MON, TUE)})
        path = tmp_path / "jobs.json"
        store.save(saved, path)
        payload = json.loads(path.read_text(encoding="utf-8"))
        payload["boards"][STRIPE]["read_twice_at"] = TUE
        payload["stats"]["boards_resting"] = 4
        path.write_text(json.dumps(payload), encoding="utf-8")
        assert store.load(path) == saved


class TestRest:
    """A board that keeps going unread rests, and is asked again when its rest is up.

    The last run asked 191 boards that said "no such board" every run; none of these
    may rest a board that can be read, nor rest one for good."""

    gone = Board("greenhouse", "gone", "Gone")

    def unread(self, previous: Store | None, now: str, why: str = "no such board") -> Store:
        return store.update(previous, [], [], RunStats(unread={self.gone.key: why}), now)

    def runs(self, count: int, why: str = "no such board") -> Store:
        run = None
        for hours in range(count):
            run = self.unread(run, _plus(MON, hours * 3), why)
        return run

    def test_two_misses_in_a_row_are_no_rest(self):
        run = self.runs(2)
        assert run.health[self.gone.key].failures == 2
        assert run.resting(_plus(MON, 6)) == set()

    def test_the_third_rests_six_hours_then_twelve_then_a_day_at_most(self):
        rests = [store.rest_for(failures) for failures in range(3, 8)]
        assert rests == [timedelta(hours=h) for h in (6, 12, 24, 24, 24)]
        run = self.runs(3)
        assert run.health[self.gone.key].rest_until == _plus(MON, 6 + 6)

    def test_a_resting_board_is_not_read_even_with_full_and_is_after_its_rest(self):
        run = self.runs(3, why="403")
        assert run.to_read([self.gone], _plus(MON, 11), everything=True) == []
        assert run.to_read([self.gone], _plus(MON, 12)) == [self.gone]

    def test_one_complete_read_ends_it(self):
        run = store.update(self.runs(4), [], [self.gone.key], RunStats(), _plus(MON, 30))
        assert run.health == {}
        assert self.unread(run, _plus(MON, 33)).health[self.gone.key].failures == 1

    def test_a_board_left_for_a_later_run_keeps_its_count(self):
        run = store.update(self.runs(2), [], [], RunStats(), _plus(MON, 6))
        assert run.health[self.gone.key].failures == 2

    def test_it_survives_the_file(self, tmp_path: Path):
        run = self.runs(3)
        path = tmp_path / "jobs.json"
        store.save(run, path)
        assert store.load(path).health == run.health


class TestFingerprint:
    """A board whose kept postings hash identically on consecutive reads rests,
    doubling from 4 hours to 24 hours. A changed fingerprint resets the count."""

    board = Board("greenhouse", "acme", "Acme")

    def read(
        self, previous: Store | None, now: str, *jobs: Job, fp: str | None = None,
    ) -> Store:
        key = self.board.key
        fingerprints = {key: fp} if fp is not None else None
        return store.update(
            previous, list(jobs), [key], RunStats(), now, fingerprints=fingerprints,
        )

    def test_first_read_gets_fingerprint_no_rest(self):
        fp = store.fingerprint(["a", "b"])
        run = self.read(None, MON, fp=fp)
        reads = run.boards[self.board.key]
        assert reads.fingerprint == fp
        assert reads.unchanged_reads == 0
        assert reads.fingerprint_until is None

    def test_second_read_same_ids_rests_four_hours(self):
        fp = store.fingerprint(["a", "b"])
        run = self.read(self.read(None, MON, fp=fp), TUE, fp=fp)
        reads = run.boards[self.board.key]
        assert reads.unchanged_reads == 1
        assert reads.fingerprint_until == _plus(TUE, 4)

    def test_third_unchanged_rests_eight_hours(self):
        fp = store.fingerprint(["x"])
        run = self.read(None, MON, fp=fp)
        run = self.read(run, TUE, fp=fp)
        run = self.read(run, _plus(TUE, 5), fp=fp)
        reads = run.boards[self.board.key]
        assert reads.unchanged_reads == 2
        assert reads.fingerprint_until == _plus(TUE, 5 + 8)

    def test_cap_at_24_hours(self):
        fp = store.fingerprint([])
        run = self.read(None, MON, fp=fp)
        for i in range(1, 8):
            run = self.read(run, _plus(MON, i * 25), fp=fp)
        reads = run.boards[self.board.key]
        assert reads.unchanged_reads == 7
        # 4h * 2^6 = 256h, capped to 24h
        assert reads.fingerprint_until == _plus(MON, 7 * 25 + 24)

    def test_changed_fingerprint_resets_count(self):
        fp1 = store.fingerprint(["a"])
        fp2 = store.fingerprint(["a", "b"])
        run = self.read(self.read(None, MON, fp=fp1), TUE, fp=fp1)
        assert run.boards[self.board.key].unchanged_reads == 1
        run = self.read(run, THU, fp=fp2)
        reads = run.boards[self.board.key]
        assert reads.unchanged_reads == 0
        assert reads.fingerprint == fp2
        assert reads.fingerprint_until is None

    def test_fingerprint_resting_board_excluded_from_to_read(self):
        fp = store.fingerprint(["a"])
        j = job("a", token="acme")
        run = self.read(self.read(None, MON, j, fp=fp), TUE, j, fp=fp)
        assert run.boards[self.board.key].fingerprint_until is not None
        # Within rest window: excluded
        assert run.to_read([self.board], _plus(TUE, 2)) == []
        # After rest window: included (board is hot, so quiet stagger does not apply)
        assert run.to_read([self.board], _plus(TUE, 5)) == [self.board]

    def test_full_reads_fingerprint_resting_boards(self):
        fp = store.fingerprint(["a"])
        j = job("a", token="acme")
        run = self.read(self.read(None, MON, j, fp=fp), TUE, j, fp=fp)
        assert run.to_read([self.board], _plus(TUE, 2), everything=True) == [self.board]

    def test_round_trip(self, tmp_path: Path):
        fp = store.fingerprint(["a", "b"])
        run = self.read(self.read(None, MON, fp=fp), TUE, fp=fp)
        path = tmp_path / "jobs.json"
        store.save(run, path)
        loaded = store.load(path)
        assert loaded.boards == run.boards

    def test_old_store_without_fingerprint_loads_and_does_not_rest(self, tmp_path: Path):
        run = scrape(None, MON, job("1"))
        path = tmp_path / "jobs.json"
        store.save(run, path)
        payload = json.loads(path.read_text(encoding="utf-8"))
        # Simulate an old store that has no fingerprint fields
        for reads in payload["boards"].values():
            reads.pop("fingerprint", None)
            reads.pop("unchanged_reads", None)
            reads.pop("fingerprint_until", None)
        path.write_text(json.dumps(payload), encoding="utf-8")
        loaded = store.load(path)
        for reads in loaded.boards.values():
            assert reads.fingerprint is None
            assert reads.unchanged_reads == 0
            assert reads.fingerprint_until is None
        # The first read after loading an old store must not trigger rest,
        # because old.fingerprint is None and the condition requires it not None.
        fp = store.fingerprint(["1"])
        updated = self.read(loaded, TUE, job("1", token="acme"), fp=fp)
        reads = updated.boards[self.board.key]
        assert reads.unchanged_reads == 0
        assert reads.fingerprint_until is None

    def test_empty_board_fingerprints_and_rests(self):
        # A board read OK with zero kept postings hashes the empty list.
        fp = store.fingerprint([])
        run = self.read(None, MON, fp=fp)
        assert run.boards[self.board.key].fingerprint == fp
        assert run.boards[self.board.key].unchanged_reads == 0
        # Second empty read: rests 4 hours.
        run = self.read(run, TUE, fp=fp)
        assert run.boards[self.board.key].unchanged_reads == 1
        assert run.boards[self.board.key].fingerprint_until == _plus(TUE, 4)

    def test_a_missed_posting_changes_the_fingerprint_so_it_cannot_rest(self):
        # A board with postings a and b. The next read sees only a: the fingerprint
        # changes (b is gone), so unchanged_reads resets and the board does not rest.
        # This proves missed-once and fingerprint rest are mutually exclusive.
        fp_ab = store.fingerprint(["a", "b"])
        fp_a = store.fingerprint(["a"])
        j_a = job("a", token="acme")
        j_b = job("b", token="acme")
        run = self.read(None, MON, j_a, j_b, fp=fp_ab)
        run = self.read(run, TUE, j_a, fp=fp_a)
        reads = run.boards[self.board.key]
        assert reads.unchanged_reads == 0
        assert reads.fingerprint_until is None
        assert run.missed_once() == {self.board.key}

    def test_fingerprint_is_order_independent(self):
        assert store.fingerprint(["b", "a"]) == store.fingerprint(["a", "b"])
        assert store.fingerprint(["c", "a", "b"]) == store.fingerprint(["a", "b", "c"])

    def test_health_rest_blocks_even_when_fingerprint_rest_expired(self):
        # A board that failed 3 times is health-resting. Even if its fingerprint
        # rest has expired, health rest still blocks it -- including with --full.
        fp = store.fingerprint(["a"])
        j = job("a", token="acme")
        run = self.read(self.read(None, MON, j, fp=fp), TUE, j, fp=fp)
        # Board is fingerprint-resting until TUE + 4h.
        assert run.fingerprint_resting(_plus(TUE, 2)) == {self.board.key}
        # Now make the board fail 3 times to enter health rest.
        for i in range(3):
            run = store.update(
                run, [], [], RunStats(unread={self.board.key: "403"}), _plus(TUE, 5 + i),
            )
        assert self.board.key in run.health
        # Fingerprint rest has expired (TUE + 4h < TUE + 8h), but health rest blocks.
        assert run.to_read([self.board], _plus(TUE, 8)) == []
        # Even --full cannot override health rest.
        assert run.to_read([self.board], _plus(TUE, 8), everything=True) == []

    def test_second_missing_clears_fingerprint_fields(self):
        fp = store.fingerprint(["a"])
        j = job("a", token="acme")
        run = self.read(self.read(None, MON, j, fp=fp), TUE, j, fp=fp)
        assert run.boards[self.board.key].fingerprint == fp
        # First "no such board": noted, fingerprint stays.
        run = store.update(run, [], [], RunStats(), THU, missing=[self.board.key])
        assert run.boards[self.board.key].fingerprint == fp
        # Second: closes its postings and clears fingerprint fields.
        run = store.update(
            run, [], [], RunStats(), _plus(THU, 3), missing=[self.board.key],
        )
        reads = run.boards[self.board.key]
        assert reads.fingerprint is None
        assert reads.unchanged_reads == 0
        assert reads.fingerprint_until is None

    def test_fingerprint_rest_doubling_sequence(self):
        rests = [store.fingerprint_rest(n) for n in range(6)]
        assert rests == [
            None,
            timedelta(hours=4),
            timedelta(hours=8),
            timedelta(hours=16),
            timedelta(hours=24),
            timedelta(hours=24),
        ]


def _plus(at: str, hours: int) -> str:
    return (datetime.fromisoformat(at) + timedelta(hours=hours)).isoformat()
