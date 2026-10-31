"""TikTok, iCIMS on its Jibe career sites (`jibe`) and SuccessFactors (on its
career-site builder): each one's response mapped onto `Job`. Oracle and iCIMS's
own sitemaps are tested in `test_providers.py`.

Every fixture in `fixtures/providers/` is a real response from 2026-10-26, trimmed
to a few postings and the fields the reader uses (styles stripped from HTML). Where
a test pages, the page size is shrunk, never the data.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from build_boards import tokens
from workit_scraper import providers
from workit_scraper.providers import TooLarge
from workit_scraper.providers.systems.jibe import JIBE_MAX

FIXTURES = Path(__file__).parent / "fixtures" / "providers"


def fixture(name: str) -> object:
    text = (FIXTURES / name).read_text(encoding="utf-8")
    return json.loads(text) if name.endswith(".json") else text


class TestTikTok:
    def serve(self, monkeypatch, pages: list[dict]) -> list[tuple[str, dict]]:
        asked: list[tuple[str, dict]] = []
        answers = iter(pages)
        monkeypatch.setattr(
            providers.fetch,
            "_post_json",
            lambda url, body, headers=None: asked.append((url, body, headers)) or next(answers),
        )
        return asked

    def test_a_post_reads_whole_from_the_search(self, monkeypatch) -> None:
        asked = self.serve(monkeypatch, [fixture("tiktok-list.json")])
        jobs = providers.tiktok("lifeattiktok", "TikTok")
        url, body, headers = asked[0]
        assert url == "https://api.lifeattiktok.com/api/v1/public/supplier/search/job/posts"
        assert (body["limit"], body["offset"], body["keyword"]) == (200, 0, "")
        # Without it the search answers "invalid request".
        assert headers == {"website-path": "tiktok"}
        first = jobs[0]
        assert first.title == "Software Engineer Intern (TikTok-Social-Friending) - 2027 Summer"
        assert first.apply_url == f"https://lifeattiktok.com/search/{first.external_id}"
        assert first.location == "San Jose, California, United States of America"
        assert first.department == "R&D"  # the root of its job category
        # The description and requirements come with the list, under the kept
        # sections' headings.
        assert "commit to a 12-week internship" in (first.description or "")
        assert first.facts.start_term == "Summer 2027"
        assert len(jobs) == 3

    def test_an_error_code_is_a_failed_read(self, monkeypatch) -> None:
        self.serve(monkeypatch, [{"code": 1, "message": "invalid request", "data": None}])
        with pytest.raises(RuntimeError):
            providers.tiktok("lifeattiktok", "TikTok")


class TestJibe:
    def test_a_jibe_site_lists_its_icims_postings(self, monkeypatch) -> None:
        asked: list[str] = []
        payload = fixture("icims-jibe-list.json")
        monkeypatch.setattr(providers.fetch, "_get_json", lambda url: asked.append(url) or payload)
        jobs = providers.jibe("careers.amd.com", "AMD")
        assert asked == ["https://careers.amd.com/api/jobs?page=1&limit=100"]
        intern = jobs[0]
        assert intern.title == "2027 PhD AI Model Optimization & Software Engineer Intern/Co-op"
        assert intern.apply_url == f"https://careers.amd.com/jobs/{intern.external_id}?icims=1"
        assert intern.location == "San Jose, California, United States"
        assert intern.posted_at is not None and intern.posted_at.startswith("2026-")
        assert "At AMD, we believe technology" in (intern.description or "")
        assert len(jobs) == 2

    def test_a_posting_listed_twice_is_kept_once(self, monkeypatch) -> None:
        payload = fixture("icims-jibe-list.json")
        payload["jobs"].append(payload["jobs"][0])
        payload["totalCount"] = 3
        monkeypatch.setattr(providers.fetch, "_get_json", lambda url: payload)
        assert len(providers.jibe("careers.amd.com", "AMD")) == 2

    def test_a_posting_on_another_system_is_left_out(self, monkeypatch) -> None:
        payload = fixture("icims-jibe-list.json")
        payload["jobs"][1]["data"]["ats_code"] = "workday"
        monkeypatch.setattr(providers.fetch, "_get_json", lambda url: payload)
        assert len(providers.jibe("careers.amd.com", "AMD")) == 1

    def test_a_board_past_the_cap_is_skipped_after_its_first_page(self, monkeypatch) -> None:
        # H&R Block's site counted 18,576 postings (2026-10-30): 186 pages at 5 s each.
        asked: list[str] = []
        payload = fixture("icims-jibe-list.json")
        payload["totalCount"] = JIBE_MAX + 1
        monkeypatch.setattr(providers.fetch, "_get_json", lambda url: asked.append(url) or payload)
        with pytest.raises(TooLarge):
            providers.jibe("careers.hrblock.com", "H&R Block")
        assert asked == ["https://careers.hrblock.com/api/jobs?page=1&limit=100"]


class TestSuccessFactors:
    def test_the_search_page_lists_title_place_and_date(self, monkeypatch) -> None:
        asked: list[str] = []
        page = fixture("successfactors-search.html")
        monkeypatch.setattr(providers.fetch, "_get_text", lambda url: asked.append(url) or page)
        jobs = providers.successfactors("jobs.grainger.com", "Grainger")
        assert asked == [
            "https://jobs.grainger.com/search/?q=&sortColumn=sort_title&sortDirection=asc&startrow=0"
        ]
        assert [job.title for job in jobs] == [
            "District Sales Representative",
            "Global Command Center Manager (IT Operations)",
        ]
        first = jobs[0]
        # The posting's path, as on Workday: the job page is read by it, and a
        # bare id is no address on these sites (it redirects to an error page).
        assert first.external_id == (
            "/ImperialSupplies/job/MIAMI-District-Sales-Representative-FL-33147-5838/1388175400/"
        )
        assert first.apply_url == f"https://jobs.grainger.com{first.external_id}"
        assert first.location == "MIAMI, FL, US, 33147-5838"
        assert first.posted_at == "2026-10-26T00:00:00+00:00"
        assert first.page is None

    def test_overlapping_pages_that_still_saw_every_posting_are_whole(self, monkeypatch) -> None:
        # Sonepar, 2026-10-26: ties on one title swap between pages, so a posting
        # can show twice; all 938 counted were still read.
        page = fixture("successfactors-search.html")
        rows = page.split('<tr class="data-row">')
        first = page.replace('<tr class="data-row">' + rows[2], "")  # row 1 only
        answers = iter([first, page])  # then rows 1 and 2: row 1 again, row 2 new
        monkeypatch.setattr(providers.fetch, "_get_text", lambda url: next(answers))
        assert len(providers.successfactors("jobs.grainger.com", "Grainger")) == 2

    def test_its_own_page_has_the_description(self, monkeypatch) -> None:
        job = providers.Job(
            ats="successfactors",
            token="jobs.grainger.com",
            company="Grainger",
            external_id="/job/CHICAGO-GTG-Intern-Software-Engineer-IL-60661-4555/1419930800/",
            title="GTG Intern - Software Engineer",
            apply_url="https://jobs.grainger.com/job/CHICAGO-GTG-Intern-Software-Engineer-IL-60661-4555/1419930800/",
        )
        page = fixture("successfactors-job.html")
        asked: list[str] = []
        monkeypatch.setattr(providers.fetch, "_get_text", lambda url: asked.append(url) or page)
        described = providers.describe(job)
        assert asked == [job.apply_url]
        assert described.posted_at == "2026-10-13T07:00:00+00:00"
        assert "10-week, paid program" in (described.description or "")
        assert (described.facts.pay.low, described.facts.pay.period) == (36.0, "hour")


class TestBoardsFromLinks:
    @pytest.mark.parametrize(
        ("link", "board"),
        [
            ("https://lifeattiktok.com/search/7611950589973186821", ("tiktok", "lifeattiktok")),
            (
                "https://careers.medpace.com/jobs/12729?lang=en-us&icims=1",
                ("jibe", "careers.medpace.com"),
            ),
            (
                "https://jobs.grainger.com/job/CHICAGO-GTG-Intern-Software-Engineer-IL-60661-4555/1419930800/?ats=successfactors",
                ("successfactors", "jobs.grainger.com"),
            ),
        ],
    )
    def test_an_apply_link_names_its_board(self, link: str, board: tuple[str, str]) -> None:
        assert tokens(link) == [board]

    def test_a_board_is_read_where_its_robots_txt_was_checked(self) -> None:
        for ats, token in [
            ("tiktok", "lifeattiktok"),
            ("jibe", "careers.amd.com"),
            ("successfactors", "jobs.grainger.com"),
        ]:
            assert providers.robots_urls(ats, token) == [providers.listing_url(ats, token)]
