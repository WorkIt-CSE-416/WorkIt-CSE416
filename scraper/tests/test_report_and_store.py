"""The page's "new today" and "open roles" claims, and the store that backs them.

Both fail silently: a wrong flag still renders a plausible page, and a lost
first_seen_at just makes every role look new again. Each case below is one of the
ways the count was, or could have been, wrong.
"""

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from workit_scraper import report, store
from workit_scraper.providers import Job
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


class TestNewToday(unittest.TestCase):
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


class TestOpenRoles(unittest.TestCase):
    def test_a_posting_gone_from_a_complete_read_is_kept_but_not_listed(self):
        run = scrape(scrape(None, MON, job("1"), job("2")), TUE, job("1"))
        assert {j.external_id for j in run.jobs} == {"1", "2"}
        assert {j.external_id for j in run.jobs if run.is_listed(j)} == {"1"}

    def test_a_board_that_failed_this_run_keeps_its_postings_listed(self):
        run = scrape(scrape(None, MON, job("1")), TUE, boards=())
        assert all(run.is_listed(j) for j in run.jobs)

    def test_first_seen_at_never_moves(self):
        run = scrape(scrape(None, MON, job("1")), TUE, job("1"))
        assert (run.jobs[0].first_seen_at, run.jobs[0].last_seen_at) == (MON, TUE)


class TestPage(unittest.TestCase):
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


class TestFile(unittest.TestCase):
    def test_round_trip(self):
        saved = Store(
            TUE, RunStats(postings=3, boards_ok=1), [job("1")], {STRIPE: BoardReads(MON, TUE)}
        )
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "jobs.json"
            store.save(saved, path)
            assert store.load(path) == saved
