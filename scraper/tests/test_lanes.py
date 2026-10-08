"""What makes a run fast without making it rude or forgetful.

A run took 9.5 minutes, most of it every worker queued behind Lever's one-second
Crawl-delay. Lanes and quiet boards cut that; each case below is a way the cut
could silently drop or misreport a board.
"""

from __future__ import annotations

from dataclasses import replace
from types import SimpleNamespace

from workit_scraper import __main__ as run
from workit_scraper import providers, store
from workit_scraper.details import Facts
from workit_scraper.providers import Board, Job, Page
from workit_scraper.store import BoardReads, RunStats, Store

MONDAY = "2026-10-05T09:00:00+00:00"


def board(ats: str, token: str) -> Board:
    return Board(ats, token, token.title())


def job(b: Board, eid: str = "1", title: str = "Software Engineer Intern") -> Job:
    return Job(
        ats=b.ats,
        token=b.token,
        company=b.company,
        external_id=eid,
        title=title,
        apply_url=f"https://example.test/{b.token}/{eid}",
    )


def stored(*, read_at: str, jobs: list[Job], boards: list[Board]) -> Store:
    reads = {b.key: BoardReads(first_read_at=read_at, last_read_at=read_at) for b in boards}
    return Store(scraped_at=read_at, stats=RunStats(), jobs=jobs, boards=reads)


class TestQuietBoards:
    hot = board("lever", "neighbor")
    quiet = [board("lever", f"quiet{i}") for i in range(30)]

    def store(self, read_at: str = MONDAY) -> Store:
        return stored(read_at=read_at, jobs=[job(self.hot)], boards=[self.hot, *self.quiet])

    def test_a_board_with_a_kept_posting_is_always_read(self) -> None:
        for day in range(5, 12):
            now = f"2026-10-{day:02d}T09:00:00+00:00"
            assert self.hot in self.store().to_read([self.hot], now)

    def test_a_board_never_read_is_read(self) -> None:
        new = board("ashby", "brand-new")
        assert self.store().to_read([new], MONDAY) == [new]

    def test_each_run_takes_its_own_third(self) -> None:
        # Read on Monday; the next three days split the quiet boards between them.
        days = ["2026-10-06T09:00:00+00:00", "2026-10-07T09:00:00+00:00"]
        reads = [set(self.store().to_read(self.quiet, day)) for day in days]
        assert reads[0].isdisjoint(reads[1])
        assert 0 < len(reads[0]) < len(self.quiet)

    def test_no_quiet_board_waits_past_its_turn(self) -> None:
        # Runs missed for three days: every quiet board is due, whatever its slot.
        later = "2026-10-08T09:00:00+00:00"
        assert self.store().to_read(self.quiet, later) == self.quiet


class TestLanes:
    def test_results_come_back_in_boards_csv_order(self, monkeypatch) -> None:
        boards = [board("lever", "a"), board("ashby", "b"), board("lever", "c")]
        monkeypatch.setattr(run, "_scrape_one", lambda b, robots: (run.Outcome.OK, [job(b)]))
        scanned, stats, read = run.scrape(boards, SimpleNamespace(), {})
        assert [j.token for j in scanned] == ["a", "b", "c"]
        assert read == [b.key for b in boards]
        assert stats.boards_ok == 3

    def test_greenhouse_pages_already_read_are_not_read_again(self, monkeypatch) -> None:
        gh = board("greenhouse", "cloudflare")
        known = replace(job(gh, "1"), page=Page(providers.PAGE_VERSION, "Old.", Facts()))
        fetched: list[str] = []

        def describe_greenhouse(j: Job) -> Job:
            fetched.append(j.external_id)
            return replace(j, page=Page(providers.PAGE_VERSION, None, Facts()))

        monkeypatch.setattr(
            run, "_scrape_one", lambda b, robots: (run.Outcome.OK, [job(b, "1"), job(b, "2")])
        )
        monkeypatch.setattr(providers, "describe_greenhouse", describe_greenhouse)
        robots = SimpleNamespace(allows=lambda url: True, pace=lambda url: None)
        scanned, _, _ = run.scrape([gh], robots, {known.key: known})
        assert fetched == ["2"]
        # The page read before still speaks for posting 1.
        assert {j.external_id: j.description for j in scanned} == {"1": "Old.", "2": None}

    def test_postings_we_do_not_keep_have_no_page_read(self, monkeypatch) -> None:
        gh = board("greenhouse", "stripe")
        monkeypatch.setattr(
            run,
            "_scrape_one",
            lambda b, robots: (run.Outcome.OK, [job(b, "9", title="Account Executive")]),
        )
        fetched: list[Job] = []
        monkeypatch.setattr(providers, "describe_greenhouse", fetched.append)
        run.scrape([gh], SimpleNamespace(allows=lambda url: True, pace=lambda url: None), {})
        assert fetched == []


def test_carry_brings_the_page_forward() -> None:
    gh = board("greenhouse", "cloudflare")
    read = Page(providers.PAGE_VERSION, None, Facts(), ("Lisbon, Portugal",))
    known = replace(job(gh), page=read)
    assert store.carry(job(gh), {known.key: known}).page == read


def test_a_listing_never_overwrites_what_the_page_said(monkeypatch) -> None:
    # A listing's title-only "2027" once replaced the page's "Summer 2027" on
    # every run that did not re-read the page. A listing now has no page at all.
    listing = {
        "jobs": [
            {
                "id": 1,
                "title": "Software Engineer Intern (2027)",
                "absolute_url": "https://example.test/cloudflare/1",
                "location": {"name": "In-Office"},
            }
        ]
    }
    monkeypatch.setattr(providers, "_get_json", lambda url: listing)
    [fresh] = providers.greenhouse("cloudflare", "Cloudflare")
    read = replace(fresh, page=Page(providers.PAGE_VERSION, None, Facts(start_term="Summer 2027")))
    assert store.carry(fresh, {read.key: read}).facts.start_term == "Summer 2027"
