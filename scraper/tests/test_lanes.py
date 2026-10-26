"""What makes a run fast without making it rude or forgetful.

A run took 9.5 minutes, most of it every worker queued behind Lever's one-second
Crawl-delay. Lanes and quiet boards cut that; each case below is a way the cut
could silently drop or misreport a board.
"""

from __future__ import annotations

import json
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
        # Read on Monday; the next three scheduled runs, three hours apart, split the
        # quiet boards between them. By day, one day's eight runs read the same third
        # eight times and the next two days read none of it.
        runs = [f"2026-10-05T{hour}:17:00+00:00" for hour in (12, 15, 18)]
        reads = [set(self.store().to_read(self.quiet, at)) for at in runs]
        assert all(a.isdisjoint(b) for i, a in enumerate(reads) for b in reads[i + 1 :])
        assert set().union(*reads) == set(self.quiet)
        assert all(0 < len(r) < len(self.quiet) for r in reads)

    def test_no_quiet_board_waits_past_its_turn(self) -> None:
        # A day of missed runs: every quiet board is due, whatever its slot.
        later = "2026-10-06T09:00:00+00:00"
        assert self.store().to_read(self.quiet, later) == self.quiet


class TestLanes:
    def test_results_come_back_in_boards_csv_order(self, monkeypatch) -> None:
        boards = [board("lever", "a"), board("ashby", "b"), board("lever", "c")]
        monkeypatch.setattr(run, "_scrape_one", lambda b, robots: (run.Outcome.OK, [job(b)]))
        scanned, stats, read = run.scrape(boards, SimpleNamespace(), {})
        assert [j.token for j in scanned] == ["a", "b", "c"]
        assert read == [b.key for b in boards]
        assert stats.boards_ok == 3

    def test_greenhouse_pages_already_read_are_not_read_again(
        self, monkeypatch, swap_provider
    ) -> None:
        gh = board("greenhouse", "cloudflare")
        known = replace(job(gh, "1"), page=Page(providers.PAGE_VERSION, "Old.", Facts()))
        fetched: list[str] = []

        def describe_greenhouse(j: Job) -> Job:
            fetched.append(j.external_id)
            return replace(j, page=Page(providers.PAGE_VERSION, None, Facts()))

        monkeypatch.setattr(
            run, "_scrape_one", lambda b, robots: (run.Outcome.OK, [job(b, "1"), job(b, "2")])
        )
        swap_provider("greenhouse", describe=describe_greenhouse)
        robots = SimpleNamespace(allows=lambda url: True, pace=lambda url: None)
        scanned, _, _ = run.scrape([gh], robots, {known.key: known})
        assert fetched == ["2"]
        # The page read before still speaks for posting 1.
        assert {j.external_id: j.description for j in scanned} == {"1": "Old.", "2": None}

    def test_postings_we_do_not_keep_have_no_page_read(self, monkeypatch, swap_provider) -> None:
        gh = board("greenhouse", "stripe")
        monkeypatch.setattr(
            run,
            "_scrape_one",
            lambda b, robots: (run.Outcome.OK, [job(b, "9", title="Account Executive")]),
        )
        fetched: list[Job] = []
        swap_provider("greenhouse", describe=fetched.append)
        run.scrape([gh], SimpleNamespace(allows=lambda url: True, pace=lambda url: None), {})
        assert fetched == []


class TestVanishedBoards:
    """A board that answered once and now says it does not exist (a 404; Workday's
    422; BambooHR's redirect home) has nothing open. Counted as no read at all, its
    postings stayed on the page for good, since only a complete read moves them."""

    gone = board("greenhouse", "left-greenhouse")

    def test_a_known_board_now_missing_is_read_with_nothing_open(self, monkeypatch) -> None:
        listed = replace(job(self.gone), first_seen_at=MONDAY, last_seen_at=MONDAY)
        monday = stored(read_at=MONDAY, jobs=[listed], boards=[self.gone])
        monkeypatch.setattr(run, "_scrape_one", lambda b, robots: (run.Outcome.MISSING, []))
        scanned, stats, read = run.scrape([self.gone], SimpleNamespace(), {listed.key: listed})
        assert read == [self.gone.key]
        assert stats.boards_missing == 1
        tuesday = store.update(monday, scanned, read, stats, "2026-10-06T09:00:00+00:00")
        assert not tuesday.is_listed(tuesday.jobs[0])

    def test_a_board_never_read_stays_unread(self, monkeypatch) -> None:
        # A typo in boards.csv: it has nothing stored, so nothing to close, and it
        # must not look read (`Store.is_new` reads its first read).
        typo = board("greenhouse", "stirpe")
        monkeypatch.setattr(run, "_scrape_one", lambda b, robots: (run.Outcome.MISSING, []))
        _, _, read = run.scrape([typo], SimpleNamespace(), {})
        assert read == []

    def test_a_failed_read_is_still_evidence_of_nothing(self, monkeypatch) -> None:
        listed = job(self.gone)
        monkeypatch.setattr(run, "_scrape_one", lambda b, robots: (run.Outcome.FAILED, []))
        _, _, read = run.scrape([self.gone], SimpleNamespace(), {listed.key: listed})
        assert read == []


class TestMetrics:
    """Each provider's share of a run, so a change to one can be measured: what it
    read, what it kept, what it cost."""

    def test_each_provider_counts_its_own_boards_and_pages(
        self, monkeypatch, swap_provider
    ) -> None:
        boards = [board("lever", "a"), board("greenhouse", "b"), board("lever", "gone")]

        def scrape_one(b: Board, robots) -> tuple:
            if b.token == "gone":
                return run.Outcome.MISSING, []
            return run.Outcome.OK, [job(b, "1"), job(b, "2", title="Account Executive")]

        monkeypatch.setattr(run, "_scrape_one", scrape_one)
        swap_provider("greenhouse", describe=lambda j: replace(j, page=Page(1, "Read.", Facts())))
        robots = SimpleNamespace(allows=lambda url: True, pace=lambda url: None)
        _, stats, _ = run.scrape(boards, robots, {})
        lever, greenhouse = stats.by_provider["lever"], stats.by_provider["greenhouse"]
        assert (lever["boards"], lever["ok"], lever["missing"], lever["postings"]) == (2, 1, 1, 2)
        # Only the kept Greenhouse posting's page is read; Lever sends it with the list.
        assert (greenhouse["pages"], lever["pages"]) == (1, 0)
        assert lever["seconds"] >= 0

    def test_metrics_file_adds_what_each_provider_kept(self, tmp_path) -> None:
        stats = RunStats(
            postings=3,
            kept=2,
            boards_ok=1,
            by_provider={"lever": {"boards": 1, "ok": 1, "postings": 3, "pages": 0}},
        )
        kept = [job(board("lever", "a")), job(board("lever", "a"), "2")]
        path = tmp_path / "metrics.json"
        run.write_metrics(stats, kept, {"lever": 1}, MONDAY, path)
        written = json.loads(path.read_text(encoding="utf-8"))
        assert written["scraped_at"] == MONDAY
        assert written["totals"]["postings"] == 3
        assert written["by_provider"]["lever"] == {
            "boards": 1,
            "ok": 1,
            "postings": 3,
            "pages": 0,
            "kept": 2,
            "roles": 1,
        }


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
    monkeypatch.setattr(providers.fetch, "_get_json", lambda url: listing)
    [fresh] = providers.greenhouse("cloudflare", "Cloudflare")
    read = replace(fresh, page=Page(providers.PAGE_VERSION, None, Facts(start_term="Summer 2027")))
    assert store.carry(fresh, {read.key: read}).facts.start_term == "Summer 2027"
