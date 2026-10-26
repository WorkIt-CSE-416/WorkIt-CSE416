"""Oracle Recruiting Cloud, TikTok, iCIMS (on its Jibe career sites) and
SuccessFactors (on its career-site builder): each one's response mapped onto `Job`.

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
from workit_scraper.providers import Incomplete

FIXTURES = Path(__file__).parent / "fixtures" / "providers"


def fixture(name: str) -> object:
    text = (FIXTURES / name).read_text(encoding="utf-8")
    return json.loads(text) if name.endswith(".json") else text


class TestOracle:
    TOKEN = "ecnf.fa.us2/CX"

    def serve(self, monkeypatch, pages: list[dict]) -> list[str]:
        asked: list[str] = []
        answers = iter(pages)
        monkeypatch.setattr(providers, "_get_json", lambda url: asked.append(url) or next(answers))
        return asked

    def test_a_requisition_links_its_candidate_page(self, monkeypatch) -> None:
        asked = self.serve(monkeypatch, [fixture("oracle-list.json")])
        jobs = providers.oracle(self.TOKEN, "Tradeweb")
        assert asked == [
            "https://ecnf.fa.us2.oraclecloud.com/hcmRestApi/resources/latest/"
            "recruitingCEJobRequisitions?onlyData=true&expand=requisitionList.secondaryLocations"
            "&finder=findReqs;siteNumber=CX,limit=200,offset=0,sortBy=POSTING_DATES_DESC"
        ]
        first = jobs[0]
        assert (first.ats, first.external_id, first.company) == ("oracle", "301986", "Tradeweb")
        assert first.title == "Summer 2027 Human Resources Internship"
        assert first.apply_url == (
            "https://ecnf.fa.us2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX/job/301986"
        )
        assert first.location == "New York, NY, United States"
        assert first.posted_at == "2026-10-26T00:00:00+00:00"
        # The list has only a short summary: its own record is read once.
        assert first.page is None
        assert len(jobs) == 3

    def test_a_board_pages_until_its_count_and_paces_each_page(self, monkeypatch) -> None:
        payload = fixture("oracle-list.json")
        rows = payload["items"][0]["requisitionList"]
        pages = [
            {"items": [{**payload["items"][0], "requisitionList": rows[:2]}]},
            {"items": [{**payload["items"][0], "requisitionList": rows[2:]}]},
        ]
        monkeypatch.setattr(providers, "ORACLE_PAGE", 2)
        asked = self.serve(monkeypatch, pages)
        paced: list[str] = []
        jobs = providers.oracle(self.TOKEN, "Tradeweb", pace=paced.append)
        assert [job.external_id for job in jobs] == [row["Id"] for row in rows]
        assert ["offset=0" in asked[0], "offset=2" in asked[1]] == [True, True]
        assert len(paced) == 1

    def test_pages_that_overlap_are_incomplete(self, monkeypatch) -> None:
        # The board changed under us: the second page repeats the first's rows.
        payload = fixture("oracle-list.json")
        payload["items"][0]["TotalJobsCount"] = 4
        monkeypatch.setattr(providers, "ORACLE_PAGE", 3)
        rows = payload["items"][0]["requisitionList"]
        again = {"items": [{**payload["items"][0], "requisitionList": rows[:1]}]}
        self.serve(monkeypatch, [payload, again])
        with pytest.raises(Incomplete):
            providers.oracle(self.TOKEN, "Tradeweb")

    def test_a_count_a_few_over_what_the_last_page_serves_is_whole(self, monkeypatch) -> None:
        # Live, 2026-10-26: ebwg.fa.us2/CX counted 115 and served 113 on one page of
        # 200, with nothing past it; edel.fa.us2/CX_2001 1,040 and 1,039. The count
        # includes requisitions the search never serves. A short last page with no
        # overlap is the whole board.
        payload = fixture("oracle-list.json")
        payload["items"][0]["TotalJobsCount"] = 5
        self.serve(monkeypatch, [payload])
        assert len(providers.oracle(self.TOKEN, "Tradeweb")) == 3

    def test_a_board_past_the_deepest_page_is_too_large(self, monkeypatch) -> None:
        payload = fixture("oracle-list.json")
        payload["items"][0]["TotalJobsCount"] = 13_426  # ejwl.fa.us2/CX
        self.serve(monkeypatch, [payload])
        with pytest.raises(providers.TooLarge):
            providers.oracle(self.TOKEN, "Tradeweb")

    def test_a_site_with_nothing_open_is_empty(self, monkeypatch) -> None:
        # A site number the pod does not have answers the same way: a search
        # with a count of 0 (checked live). Only a pod that does not exist 404s.
        payload = fixture("oracle-list.json")
        payload["items"][0].update(TotalJobsCount=0, requisitionList=[])
        self.serve(monkeypatch, [payload])
        assert providers.oracle("ecnf.fa.us2/NOPE", "Tradeweb") == []

    def test_its_own_record_has_the_description_and_exact_date(self, monkeypatch) -> None:
        self.serve(monkeypatch, [fixture("oracle-list.json")])
        job = providers.oracle(self.TOKEN, "Tradeweb")[0]
        asked = self.serve(monkeypatch, [fixture("oracle-detail.json")])
        described = providers.describe(job)
        assert asked == [
            "https://ecnf.fa.us2.oraclecloud.com/hcmRestApi/resources/latest/"
            'recruitingCEJobRequisitionDetails?expand=all&onlyData=true&finder=ById;Id="301986",'
            "siteNumber=CX"
        ]
        assert described.posted_at == "2026-10-26T15:44:51+00:00"
        assert "Tradeweb" in (described.description or "")
        assert described.page is not None and described.page.version == providers.PAGE_VERSION


class TestTikTok:
    def serve(self, monkeypatch, pages: list[dict]) -> list[tuple[str, dict]]:
        asked: list[tuple[str, dict]] = []
        answers = iter(pages)
        monkeypatch.setattr(
            providers,
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


class TestICIMS:
    def test_a_jibe_site_lists_its_icims_postings(self, monkeypatch) -> None:
        asked: list[str] = []
        payload = fixture("icims-jibe-list.json")
        monkeypatch.setattr(providers, "_get_json", lambda url: asked.append(url) or payload)
        jobs = providers.icims("careers.amd.com", "AMD")
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
        monkeypatch.setattr(providers, "_get_json", lambda url: payload)
        assert len(providers.icims("careers.amd.com", "AMD")) == 2

    def test_a_posting_on_another_system_is_left_out(self, monkeypatch) -> None:
        payload = fixture("icims-jibe-list.json")
        payload["jobs"][1]["data"]["ats_code"] = "workday"
        monkeypatch.setattr(providers, "_get_json", lambda url: payload)
        assert len(providers.icims("careers.amd.com", "AMD")) == 1


class TestSuccessFactors:
    def test_the_search_page_lists_title_place_and_date(self, monkeypatch) -> None:
        asked: list[str] = []
        page = fixture("successfactors-search.html")
        monkeypatch.setattr(providers, "_get_text", lambda url: asked.append(url) or page)
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
        monkeypatch.setattr(providers, "_get_text", lambda url: asked.append(url) or page)
        described = providers.describe(job)
        assert asked == [job.apply_url]
        assert described.posted_at == "2026-10-13T07:00:00+00:00"
        assert "10-week, paid program" in (described.description or "")
        assert (described.facts.pay.low, described.facts.pay.period) == (36.0, "hour")


class TestBoardsFromLinks:
    @pytest.mark.parametrize(
        ("link", "board"),
        [
            (
                "https://fa-exki-saasfaprod1.fa.ocs.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1/job/27180",
                ("oracle", "fa-exki-saasfaprod1.fa.ocs/CX_1"),
            ),
            (
                "https://ecnf.fa.us2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX/job/301721",
                ("oracle", "ecnf.fa.us2/CX"),
            ),
            ("https://lifeattiktok.com/search/7611950589973186821", ("tiktok", "lifeattiktok")),
            (
                "https://careers.medpace.com/jobs/12729?lang=en-us&icims=1",
                ("icims", "careers.medpace.com"),
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
            ("oracle", "ecnf.fa.us2/CX"),
            ("tiktok", "lifeattiktok"),
            ("icims", "careers.amd.com"),
            ("successfactors", "jobs.grainger.com"),
        ]:
            assert providers.robots_urls(ats, token) == [providers.listing_url(ats, token)]
