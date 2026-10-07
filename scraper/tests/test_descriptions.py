"""Job descriptions: what Scout reads to answer "is this role a fit?".

A description that keeps markup, drops the requirements or runs unbounded fails
quietly -- Scout still answers, just from worse facts or at a higher price.
"""

from __future__ import annotations

from dataclasses import replace
from types import SimpleNamespace

from workit_scraper import __main__ as run
from workit_scraper import providers, store
from workit_scraper.details import Facts
from workit_scraper.providers import DESCRIPTION_CHARS, Job, Page, cap, plain_text
from workit_scraper.store import RunStats


def page(description: str | None, version: int = providers.PAGE_VERSION) -> Page:
    return Page(version=version, description=description, facts=Facts())


def job(ats: str = "greenhouse", eid: str = "1", description: str | None = None) -> Job:
    return Job(
        ats=ats,
        token="stripe",
        company="Stripe",
        external_id=eid,
        title="Software Engineer, Intern",
        apply_url=f"https://example.test/{ats}/{eid}",
        page=page(description) if description else None,
    )


def text(markup: str | None) -> str | None:
    return cap(plain_text(markup))


class TestText:
    def test_greenhouse_escaped_html_becomes_lines(self) -> None:
        # Greenhouse's `content` is HTML whose tags arrive entity-escaped.
        escaped = (
            "&lt;p&gt;R&amp;amp;D team&lt;/p&gt;"
            "&lt;ul&gt;&lt;li&gt;Python&lt;/li&gt;&lt;li&gt;C++&lt;/li&gt;&lt;/ul&gt;"
        )
        assert text(escaped) == "R&D team\nPython\nC++"

    def test_plain_text_survives(self) -> None:
        assert text("Build robots.\n\nShip them.") == "Build robots.\nShip them."

    def test_empty_is_none(self) -> None:
        assert text(None) is None
        assert text("<p> </p>") is None

    def test_long_text_is_cut_at_a_word(self) -> None:
        cut = text("word " * 2000)
        assert cut is not None
        assert len(cut) <= DESCRIPTION_CHARS + 2
        assert cut.endswith("word …")


class TestLever:
    def test_requirements_in_lists_are_kept(self) -> None:
        # Lever's intro is often a company blurb; the requirements live in `lists`.
        row = {
            "descriptionPlain": "About us.",
            "lists": [{"text": "Requirements", "content": "<li>Python</li><li>ROS</li>"}],
            "additionalPlain": "Equal opportunity employer.",
        }
        assert (
            providers._lever_description(row)
            == "About us.\nRequirements\nPython\nROS\nEqual opportunity employer."
        )


class TestStore:
    def test_a_page_is_carried_forward_when_a_read_lacks_one(self) -> None:
        # Greenhouse's list never has a page; the one read once must stick.
        monday = store.update(
            None, [job(description="Build robots.")], [], RunStats(), "2026-09-28T09:00:00+00:00"
        )
        tuesday = store.update(monday, [job()], [], RunStats(), "2026-09-29T09:00:00+00:00")
        assert tuesday.jobs[0].description == "Build robots."

    def test_a_fresh_page_wins(self) -> None:
        monday = store.update(
            None, [job(description="Old.")], [], RunStats(), "2026-09-28T09:00:00+00:00"
        )
        tuesday = store.update(
            monday, [job(description="New.")], [], RunStats(), "2026-09-29T09:00:00+00:00"
        )
        assert tuesday.jobs[0].description == "New."

    def test_a_page_survives_jobs_json(self, tmp_path) -> None:
        run_ = store.update(
            None, [job(description="Build robots.")], [], RunStats(), "2026-09-28T09:00:00+00:00"
        )
        store.save(run_, tmp_path / "jobs.json")
        assert store.load(tmp_path / "jobs.json").jobs == run_.jobs


class TestDescribe:
    def test_only_unread_greenhouse_postings_are_fetched(self, monkeypatch) -> None:
        robots = SimpleNamespace(allows=lambda url: True, pace=lambda url: None)
        jobs = [job("greenhouse", "1"), job("greenhouse", "2", "Known."), job("lever", "3")]
        fetched: list[str] = []

        def describe_greenhouse(j: Job) -> Job:
            fetched.append(j.external_id)
            return replace(j, page=page("Fetched."))

        monkeypatch.setattr(providers, "describe_greenhouse", describe_greenhouse)
        described = run.describe(jobs, robots)
        assert fetched == ["1"]
        assert [j.description for j in described] == ["Fetched.", "Known.", None]

    def test_a_page_read_under_an_older_version_is_read_again(self, monkeypatch) -> None:
        robots = SimpleNamespace(allows=lambda url: True, pace=lambda url: None)
        fetched: list[str] = []
        monkeypatch.setattr(
            providers, "describe_greenhouse", lambda j: fetched.append(j.external_id) or j
        )
        stale = replace(job("greenhouse", "1"), page=page("Known.", providers.PAGE_VERSION - 1))
        run.describe([stale], robots)
        assert fetched == ["1"]

    def test_robots_disallow_leaves_it_undescribed(self, monkeypatch) -> None:
        robots = SimpleNamespace(allows=lambda url: False)
        fetched: list[Job] = []
        monkeypatch.setattr(providers, "describe_greenhouse", fetched.append)
        described = run.describe([job()], robots)
        assert fetched == []
        assert described[0].description is None
