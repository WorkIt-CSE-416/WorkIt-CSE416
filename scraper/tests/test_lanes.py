"""What makes a run fast without making it rude or forgetful.

A run took 9.5 minutes, most of it every worker queued behind Lever's one-second
Crawl-delay. Lanes and quiet boards cut that; each case below is a way the cut
could silently drop or misreport a board.
"""

from __future__ import annotations

import json
import urllib.error
from dataclasses import replace
from types import SimpleNamespace

import pytest

from workit_scraper import __main__ as run
from workit_scraper import providers, store
from workit_scraper.board_read import failure_reason
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


class TestSecondRead:
    """A posting missed once is still shown, and the next complete read of its board
    closes it or keeps it. In a lane with a time budget that read must not wait a
    whole sweep of the lane (about a day on Workday), so the board goes first."""

    def test_a_board_with_a_posting_missed_once_is_read_first(self) -> None:
        sunday = "2026-10-04T09:00:00+00:00"
        steady, missed = board("workday", "a.wd1/site"), board("workday", "b.wd1/site")
        new = board("workday", "c.wd1/site")
        reads = {
            b.key: BoardReads(first_read_at=sunday, last_read_at=MONDAY, prior_read_at=sunday)
            for b in (steady, missed)
        }
        jobs = [
            replace(job(steady), last_seen_at=MONDAY),
            replace(job(missed), last_seen_at=sunday),
        ]
        run = Store(scraped_at=MONDAY, stats=RunStats(), jobs=jobs, boards=reads)
        assert run.missed_once() == {missed.key}
        later = "2026-10-05T12:17:00+00:00"
        assert run.to_read([steady, new, missed], later) == [missed, new, steady]


class TestLanes:
    def test_results_come_back_in_boards_csv_order(self, monkeypatch) -> None:
        boards = [board("lever", "a"), board("ashby", "b"), board("lever", "c")]
        monkeypatch.setattr(run, "_scrape_one", lambda b, robots: (run.Outcome.OK, [job(b)], None))
        scanned, stats, read, _ = run.scrape(boards, SimpleNamespace(), {})
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
            run, "_scrape_one", lambda b, robots: (run.Outcome.OK, [job(b, "1"), job(b, "2")], None)
        )
        swap_provider("greenhouse", describe=describe_greenhouse)
        robots = SimpleNamespace(allows=lambda url: True, pace=lambda url: None)
        scanned, _, _, _ = run.scrape([gh], robots, {known.key: known})
        assert fetched == ["2"]
        # The page read before still speaks for posting 1.
        assert {j.external_id: j.description for j in scanned} == {"1": "Old.", "2": None}

    def test_postings_we_do_not_keep_have_no_page_read(self, monkeypatch, swap_provider) -> None:
        gh = board("greenhouse", "stripe")
        monkeypatch.setattr(
            run,
            "_scrape_one",
            lambda b, robots: (run.Outcome.OK, [job(b, "9", title="Account Executive")], None),
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
    listed = replace(job(gone), first_seen_at=MONDAY, last_seen_at=MONDAY)
    days = [f"2026-10-{day:02d}T09:00:00+00:00" for day in (6, 7, 8)]

    def answer(self, monkeypatch, previous: Store, at: str) -> Store:
        """One run in which the board says it does not exist."""
        monkeypatch.setattr(
            run, "_scrape_one", lambda b, robots: (run.Outcome.MISSING, [], "no such board")
        )
        before = {job.key: job for job in previous.jobs}
        scanned, stats, read, missing = run.scrape([self.gone], SimpleNamespace(), before)
        return store.update(previous, scanned, read, stats, at, missing=missing)

    def monday(self) -> Store:
        return stored(read_at=MONDAY, jobs=[self.listed], boards=[self.gone])

    def test_one_answer_closes_nothing(self, monkeypatch) -> None:
        # One tenant's bad minute must not close its postings in Supabase.
        tuesday = self.answer(monkeypatch, self.monday(), self.days[0])
        assert tuesday.stats.boards_missing == 1
        assert tuesday.is_listed(tuesday.jobs[0])

    def test_a_second_answer_in_a_row_closes_its_postings(self, monkeypatch) -> None:
        tuesday = self.answer(monkeypatch, self.monday(), self.days[0])
        wednesday = self.answer(monkeypatch, tuesday, self.days[1])
        assert not wednesday.is_listed(wednesday.jobs[0])

    def test_a_complete_read_between_starts_the_count_again(self, monkeypatch) -> None:
        tuesday = self.answer(monkeypatch, self.monday(), self.days[0])
        wednesday = store.update(tuesday, [self.listed], [self.gone.key], RunStats(), self.days[1])
        thursday = self.answer(monkeypatch, wednesday, self.days[2])
        assert thursday.is_listed(thursday.jobs[0])

    def test_most_of_a_lane_gone_at_once_closes_nothing(self, monkeypatch) -> None:
        # Every Workday tenant answering 422 is Workday changing, not every company
        # leaving it; the import's half-the-feed guard would let one lane through.
        boards = [board("greenhouse", f"gone{i}") for i in range(4)]
        before = {j.key: j for j in map(job, boards)}

        def scrape_one(b: Board, robots) -> tuple:
            if b == boards[0]:
                return run.Outcome.OK, [], None
            return run.Outcome.MISSING, [], "no such board"

        monkeypatch.setattr(run, "_scrape_one", scrape_one)
        _, stats, read, missing = run.scrape(boards, SimpleNamespace(), before)
        assert (read, missing) == ([boards[0].key], [])
        assert stats.boards_missing == 3

    def empty_lane(self, monkeypatch, empty: int, listing: int) -> list[str]:
        """The boards read whole in a lane where `empty` boards we hold postings from
        list nothing and `listing` list one posting each."""
        boards = [board("greenhouse", f"co{i}") for i in range(empty + listing)]
        before = {j.key: j for j in map(job, boards)}
        answers = {b.key: [] for b in boards[:empty]} | {b.key: [job(b)] for b in boards[empty:]}
        monkeypatch.setattr(
            run, "_scrape_one", lambda b, robots: (run.Outcome.OK, answers[b.key], None)
        )
        # Refused, so no posting's own page is asked for.
        _, _, read, _ = run.scrape(boards, SimpleNamespace(allows=lambda url: False), before)
        return read

    def test_most_of_a_lane_empty_at_once_is_no_read(self, monkeypatch) -> None:
        # A hiring system answering every board with an empty list for two runs
        # would otherwise close every posting it holds.
        assert self.empty_lane(monkeypatch, empty=3, listing=1) == ["greenhouse/co3"]

    def test_a_few_empty_boards_are_still_read(self, monkeypatch) -> None:
        # A company that closed its last posting: its two empty reads close it.
        assert len(self.empty_lane(monkeypatch, empty=1, listing=3)) == 4
        assert len(self.empty_lane(monkeypatch, empty=3, listing=3)) == 6

    def test_a_board_never_read_stays_unread(self, monkeypatch) -> None:
        # A typo in boards.csv: it has nothing stored, so nothing to close, and it
        # must not look read (`Store.is_new` reads its first read).
        typo = board("greenhouse", "stirpe")
        monkeypatch.setattr(
            run, "_scrape_one", lambda b, robots: (run.Outcome.MISSING, [], "no such board")
        )
        _, _, read, missing = run.scrape([typo], SimpleNamespace(), {})
        assert read == missing == []

    def test_a_failed_read_is_still_evidence_of_nothing(self, monkeypatch) -> None:
        listed = job(self.gone)
        monkeypatch.setattr(
            run, "_scrape_one", lambda b, robots: (run.Outcome.FAILED, [], "timeout")
        )
        _, _, read, missing = run.scrape([self.gone], SimpleNamespace(), {listed.key: listed})
        assert read == missing == []


class TestMetrics:
    """Each provider's share of a run, so a change to one can be measured: what it
    read, what it kept, what it cost."""

    def test_each_provider_counts_its_own_boards_and_pages(
        self, monkeypatch, swap_provider
    ) -> None:
        boards = [board("lever", "a"), board("greenhouse", "b"), board("lever", "gone")]

        def scrape_one(b: Board, robots) -> tuple:
            if b.token == "gone":
                return run.Outcome.MISSING, [], "no such board"
            return run.Outcome.OK, [job(b, "1"), job(b, "2", title="Account Executive")], None

        monkeypatch.setattr(run, "_scrape_one", scrape_one)
        swap_provider("greenhouse", describe=lambda j: replace(j, page=Page(1, "Read.", Facts())))
        robots = SimpleNamespace(allows=lambda url: True, pace=lambda url: None)
        _, stats, _, _ = run.scrape(boards, robots, {})
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


class TestListOrder:
    """Whether a paged list names its newest postings first decides whether an
    arrival scan, which would read only a list's first pages, can work
    (docs/coverage.md). Each run measures it on the lists it reads whole."""

    NEWER, OLDER = "2026-10-05T00:00:00+00:00", "2026-10-02T00:00:00+00:00"

    def dated(self, b: Board, *dates: str | None) -> list[Job]:
        return [
            replace(job(b, str(i), title="Account Executive"), posted_at=d)
            for i, d in enumerate(dates)
        ]

    def test_a_list_is_newest_first_when_no_date_follows_an_older_one(self) -> None:
        b = board("workday", "acme.wd1/site")
        # None is Workday's "Posted 30+ Days Ago": the oldest, so last.
        assert run.newest_first(self.dated(b, self.NEWER, self.NEWER, self.OLDER, None)) is True
        assert run.newest_first(self.dated(b, self.OLDER, self.NEWER)) is False
        assert run.newest_first(self.dated(b, None, self.NEWER)) is False
        assert run.newest_first(self.dated(b, self.NEWER)) is None
        assert run.newest_first(self.dated(b, None, None)) is None

    def test_a_paged_lane_counts_its_lists_by_order(self, monkeypatch) -> None:
        ordered, unordered = board("workday", "a.wd1/site"), board("workday", "b.wd1/site")
        lists = {
            ordered.key: self.dated(ordered, self.NEWER, self.OLDER),
            unordered.key: self.dated(unordered, self.OLDER, self.NEWER),
        }
        monkeypatch.setattr(
            run, "_scrape_one", lambda b, robots: (run.Outcome.OK, lists[b.key], None)
        )
        robots = SimpleNamespace(allows=lambda url: True, pace=lambda url: None)
        _, stats, _, _ = run.scrape([ordered, unordered], robots, {})
        workday = stats.by_provider["workday"]
        assert (workday["newest_first"], workday["not_newest_first"]) == (1, 1)
        assert workday["order_unclear"] == 0

    def test_a_provider_that_does_not_page_is_not_measured(self, monkeypatch) -> None:
        lever = board("lever", "a")
        monkeypatch.setattr(
            run, "_scrape_one", lambda b, robots: (run.Outcome.OK, self.dated(b, self.OLDER), None)
        )
        _, stats, _, _ = run.scrape([lever], SimpleNamespace(), {})
        assert "newest_first" not in stats.by_provider["lever"]


class TestWhyUnread:
    """Why a board went unread reaches metrics.json by kind, so a site that refuses
    us is a count there, not only a log line (docs/coverage.md)."""

    def test_each_failure_is_named_by_its_kind(self) -> None:
        moved = "refused cross-origin redirect to https://example.test/"
        for error, why in (
            (urllib.error.HTTPError("https://a.test", 403, "Forbidden", None, None), "403"),
            (urllib.error.HTTPError("https://a.test", 429, "Too Many Requests", None, None), "429"),
            (urllib.error.HTTPError("https://example.test/", 302, moved, None, None), "redirect"),
            (TimeoutError("timed out"), "timeout"),
            (urllib.error.URLError(TimeoutError("timed out")), "timeout"),
            (urllib.error.URLError("Name or service not known"), "connection"),
            (ConnectionResetError(), "connection"),
            (providers.Incomplete("read 19 distinct postings of 20"), "incomplete"),
            (json.JSONDecodeError("Expecting value", "<html>", 0), "unreadable answer"),
            (AssertionError(), "unreadable answer"),
            (KeyError("id"), "KeyError"),
        ):
            assert failure_reason(error) == why, error

    def test_metrics_count_unread_boards_by_provider_and_why(self, monkeypatch, tmp_path) -> None:
        refused = [board("workday", "a.wd1/site"), board("workday", "b.wd1/site")]
        whys = {b.key: "403" for b in refused}

        def scrape_one(b: Board, robots) -> tuple:
            if b.key in whys:
                return run.Outcome.FAILED, [], whys[b.key]
            return run.Outcome.OK, [], None

        monkeypatch.setattr(run, "_scrape_one", scrape_one)
        _, stats, _, _ = run.scrape([*refused, board("lever", "c")], SimpleNamespace(), {})
        assert stats.unread == whys
        path = tmp_path / "metrics.json"
        run.write_metrics(stats, [], {}, MONDAY, path)
        written = json.loads(path.read_text(encoding="utf-8"))
        assert written["unread"] == {
            "workday": {"403": {"boards": 2, "examples": [b.key for b in refused]}}
        }
        assert "unread" not in written["totals"]


class TestWidening:
    def test_the_metrics_file_says_what_a_wider_shortlist_would_keep(self, tmp_path) -> None:
        b = board("lever", "a")
        scanned = [
            job(b, "1"),
            job(b, "2", title="Legal Intern"),
            job(b, "3", title="Senior Software Engineer"),
            job(b, "4", title="Senior Software Engineer"),
            job(b, "5", title="Data Analyst"),
        ]
        steps = run.widening(scanned)
        assert steps == {"kept": 2, "no_stage": 1, "senior": 2}
        path = tmp_path / "metrics.json"
        run.write_metrics(RunStats(), [], {}, MONDAY, path, steps=steps, missed=2)
        written = json.loads(path.read_text(encoding="utf-8"))
        assert (written["widening"], written["boards_missed_once"]) == (steps, 2)


def test_carry_brings_the_page_forward() -> None:
    gh = board("greenhouse", "cloudflare")
    read = Page(providers.PAGE_VERSION, None, Facts(), ("Lisbon, Portugal",))
    known = replace(job(gh), page=read)
    assert store.carry(job(gh), {known.key: known}).page == read


@pytest.mark.parametrize(
    "ledger",
    [
        '{"lever/acme": {"decision": "rejected"}}',
        "{broken json",
    ],
)
def test_invalid_review_stops_live_scrape_before_network(tmp_path, monkeypatch, capsys, ledger):
    catalog = tmp_path / "boards.csv"
    catalog.write_text("ats,token,company\nlever,acme,Acme\n")
    (tmp_path / "discovery-review.json").write_text(ledger)
    monkeypatch.setattr(run.store, "load", lambda _: None)

    def no_network(*_a, **_k):
        pytest.fail("invalid review must stop before network reads")

    monkeypatch.setattr(run, "Robots", no_network)
    assert run.main(["--boards", str(catalog)]) == 1
    assert "Invalid discovery review" in capsys.readouterr().err


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
