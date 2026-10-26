"""Workable, Recruitee and BambooHR: each one's JSON mapped onto `Job` (KAN-171).

A misread field is silent -- a card in the wrong city, a hybrid job filed as on
site -- so every row below is a real response from 2026-10-10, trimmed to the
fields the reader uses. The one exception is marked where it appears.
"""

from __future__ import annotations

import urllib.error
from dataclasses import replace
from types import SimpleNamespace

import pytest

from workit_scraper import __main__ as run
from workit_scraper import polite, providers, store
from workit_scraper.details import Facts, Pay
from workit_scraper.providers import BoardNotFound, Job, Page
from workit_scraper.store import RunStats


def serve(monkeypatch, payload: object) -> list[str]:
    """Answer every `_get_json` with `payload`, and record the URLs asked for."""
    asked: list[str] = []
    monkeypatch.setattr(providers, "_get_json", lambda url: asked.append(url) or payload)
    return asked


class TestWorkable:
    # Trexquant lists its C++ engineer once per office, under one shortcode.
    TREXQUANT = {
        "name": "Trexquant Investment",
        "jobs": [
            {
                "title": "C++ Trading & Simulator Engineer (USA)",
                "shortcode": "B0ADC2FB1B",
                "employment_type": "Full-time",
                "telecommuting": False,
                "department": "Technology",
                "url": "https://apply.workable.com/j/B0ADC2FB1B",
                "published_on": "2026-04-28",
                "created_at": "2026-04-28",
                "country": "United States",
                "city": city,
                "state": state,
                "locations": [
                    {"country": "United States", "city": city, "region": state, "hidden": False}
                ],
            }
            for city, state in (("Stamford", "Connecticut"), ("New York", "New York"))
        ],
    }
    # DataVisor's own page: hybrid and a salary, neither in the widget.
    DATAVISOR = {
        "shortcode": "CA0522510B",
        "title": "Business Operations Analyst",
        "remote": False,
        "type": "full",
        "workplace": "hybrid",
        "salary_from": 75000,
        "salary_to": 100000,
        "salary_currency_iso_code": "USD",
        "salary_frequency": "year",
        "description": "<p>About DataVisor</p>",
        "requirements": "<ul><li>1–2 years of relevant work experience is preferred.</li></ul>",
        "benefits": "<h3></h3><p>Why Join DataVisor?</p>",
    }

    def test_one_job_in_two_offices_is_one_posting(self, monkeypatch) -> None:
        asked = serve(monkeypatch, self.TREXQUANT)
        [job] = providers.workable("trexquant", "Trexquant")
        assert asked == ["https://apply.workable.com/api/v1/widget/accounts/trexquant"]
        assert job.key == "workable/trexquant#B0ADC2FB1B"
        # New York's region is "New York" too, named once like Ely's.
        assert job.location == "Stamford, Connecticut, United States; New York, United States"
        assert job.apply_url == "https://apply.workable.com/j/B0ADC2FB1B"
        assert job.posted_at == "2026-04-28T00:00:00+00:00"
        # Its page is read once it is kept, like a Greenhouse posting's.
        assert job.page is None

    def test_a_hidden_location_stays_hidden(self, monkeypatch) -> None:
        # Hugging Face hides Paris on its "EMEA Remote" roles.
        row = {
            "title": "Senior Machine Learning Engineer, Voice Agents - EMEA Remote",
            "shortcode": "9E2A4C02C7",
            "url": "https://apply.workable.com/j/9E2A4C02C7",
            "published_on": "2026-09-02",
            "city": "Paris",
            "country": "France",
            "locations": [
                {"country": "France", "city": "Paris", "region": "Île-de-France", "hidden": True}
            ],
        }
        serve(monkeypatch, {"jobs": [row]})
        [job] = providers.workable("huggingface", "Hugging Face")
        assert job.location is None

    def test_ely_is_named_once(self) -> None:
        # Thorlabs' Ely has the region "Ely".
        assert providers._place("Ely", "Ely", "United Kingdom") == "Ely, United Kingdom"

    def test_its_page_states_work_model_pay_and_type(self, monkeypatch) -> None:
        asked = serve(monkeypatch, self.DATAVISOR)
        listed = Job(
            ats="workable",
            token="datavisor-jobs",
            company="DataVisor",
            external_id="CA0522510B",
            title="Business Operations Analyst",
            apply_url="https://apply.workable.com/j/CA0522510B",
            location="Mountain View, California, United States",
        )
        job = providers.describe(listed)
        assert asked == [
            "https://apply.workable.com/api/v2/accounts/datavisor-jobs/jobs/CA0522510B"
        ]
        facts = job.facts
        assert (facts.work_style, facts.job_type) == ("Hybrid", "full_time")
        assert facts.pay == Pay("USD", 75000, 100000, "year")
        # Requirements keep the heading the posting shows them under.
        assert job.description == (
            "About DataVisor\nRequirements\n1–2 years of relevant work experience is preferred.\n"
            "Benefits\nWhy Join DataVisor?"
        )

    def test_part_time_is_spelled_part(self, monkeypatch) -> None:
        # RAVE Aerospace's "Intern - Software Engineering (Summer 2027)".
        serve(monkeypatch, {"type": "part", "workplace": "on_site", "description": "<p>x</p>"})
        listed = Job("workable", "raveaerospace", "RAVE", "1", "Intern", "https://example.test")
        assert providers.describe(listed).facts.job_type == "part_time"

    def test_on_site_is_spelled_with_an_underscore(self) -> None:
        # Trexquant's counsel: `"workplace": "on_site"`.
        assert providers._work_style("on_site", None) == "On site"

    def test_no_such_account_is_a_404(self, monkeypatch) -> None:
        def missing(url: str):
            raise BoardNotFound(url)

        monkeypatch.setattr(providers, "_get_json", missing)
        with pytest.raises(BoardNotFound):
            providers.workable("no-such-board", "Nobody")


def offer(id: int, title: str, location: str, names: list[str], **changes: object) -> dict:
    """One of Hard Rock Digital's 58 offers, as its fields were on 2026-10-10."""
    return {
        "id": id,
        "title": title,
        "careers_url": f"https://hardrockdigital.recruitee.com/o/{id}",
        "location": location,
        "locations": [{"name": name} for name in names],
        "remote": False,
        "hybrid": False,
        "on_site": False,
        "employment_type_code": "fulltime_permanent",
        "description": None,
        "requirements": None,
        "salary": {"max": None, "min": None, "period": None, "currency": None},
        **changes,
    }


class TestRecruitee:
    OFFERS = {
        "offers": [
            offer(
                2776212,
                "Director - Technical Implementations",
                "Remote job",
                ["United States"],
                remote=True,
                hybrid=True,
                published_at="2026-10-08 10:41:07 UTC",
                created_at="2026-10-08 10:34:56 UTC",
                description="<p><strong>What are we building?</strong></p>",
                requirements="<p><strong>What are we looking for?</strong></p>",
            ),
            offer(
                2684144,
                "VIP Account Manager",
                "Tallahassee, Florida, United States",
                ["Tallahassee, FL", "Orlando, FL", "Tampa, FL", "Jacksonville, FL"],
                hybrid=True,
            ),
            offer(
                2730914,
                "Specialist - Retail Support",
                "Tampa, Florida, United States",
                ["Tampa, FL"],
                on_site=True,
            ),
            offer(
                2774299,
                "Senior Web & Mobile Developer",
                "Remote job",
                ["Gdansk, PL"],
                remote=True,
                employment_type_code="contract",
            ),
        ]
    }

    def jobs(self, monkeypatch) -> list[Job]:
        serve(monkeypatch, self.OFFERS)
        return providers.recruitee("hardrockdigital", "Hard Rock Digital")

    def test_an_offer_reads_whole_from_the_list(self, monkeypatch) -> None:
        asked = serve(monkeypatch, self.OFFERS)
        director, *_, contract = providers.recruitee("hardrockdigital", "Hard Rock Digital")
        assert asked == ["https://hardrockdigital.recruitee.com/api/offers/"]
        assert director.key == "recruitee/hardrockdigital#2776212"
        assert director.posted_at == "2026-10-08T10:41:07+00:00"
        assert director.description == "What are we building?\nWhat are we looking for?"
        assert director.facts.job_type == "full_time"
        assert contract.facts.job_type == "contract"

    def test_the_place_is_the_name_the_employer_typed(self, monkeypatch) -> None:
        # Not "Remote job", and not the director's form-default city "United
        # States" in Florida.
        places = [job.location for job in self.jobs(monkeypatch)]
        assert places == [
            "United States",
            "Tallahassee, FL; Orlando, FL; Tampa, FL; Jacksonville, FL",
            "Tampa, FL",
            "Gdansk, PL",
        ]

    def test_remote_or_hybrid_is_remote(self, monkeypatch) -> None:
        styles = [job.facts.work_style for job in self.jobs(monkeypatch)]
        assert styles == ["Remote", "Hybrid", "On site", "Remote"]

    def test_pay_arrives_as_strings(self) -> None:
        # Constructed: no board we read states a salary yet. The shape is the
        # example in Recruitee's API reference (docs.recruitee.com, `/offers/`).
        row = {"salary": {"min": "100", "max": "1000", "period": "hour", "currency": "EUR"}}
        assert providers._recruitee_pay(row) is None  # €1,000 an hour is no wage
        row = {"salary": {"min": "25", "max": "30", "period": "hour", "currency": "EUR"}}
        assert providers._recruitee_pay(row) == Pay("EUR", 25, 30, "hour")


class TestBambooHR:
    LIST = {
        "meta": {"totalCount": 2},
        "result": [
            {
                "id": "24",
                "jobOpeningName": "Software Engineer - New Grad [Santa Clara & Bellevue]",
                "departmentLabel": "3210 - Engr SW",
                "employmentStatusLabel": "Full-Time",
                "location": {"city": "Santa Clara", "state": "California"},
                "atsLocation": {"country": None, "state": None, "province": None, "city": None},
                "isRemote": None,
                "locationType": "0",
            },
            {
                "id": "117",
                "jobOpeningName": "Test Engineer",
                "departmentLabel": None,
                "employmentStatusLabel": "Full-Time",
                "location": {"city": None, "state": None},
                "atsLocation": {
                    "country": "United States",
                    "state": "North Carolina",
                    "province": None,
                    "city": "US East",
                },
                "isRemote": None,
                "locationType": "1",
            },
        ],
    }
    # Alkira's Datapath engineer, from its own page.
    DETAIL = {
        "result": {
            "jobOpening": {
                "jobOpeningName": "Software Engineer - Datapath",
                "employmentStatusLabel": "Full-Time",
                "description": "<p><span>JOB SUMMARY<br></span>Alkira’s Data Path team</p>",
                "compensation": "$125,000 - $150,000",
                "datePosted": "2026-07-06",
                "locationType": "2",
            }
        }
    }

    def listed(self) -> Job:
        return Job(
            ats="bamboohr",
            token="alkira",
            company="Alkira",
            external_id="232",
            title="Software Engineer - Datapath",
            apply_url="https://alkira.bamboohr.com/careers/232",
            location="San Jose, California",
        )

    def test_the_list_has_places_but_no_page_or_date(self, monkeypatch) -> None:
        asked = serve(monkeypatch, self.LIST)
        office, remote = providers.bamboohr("nexthopai", "Nexthop AI")
        assert asked == ["https://nexthopai.bamboohr.com/careers/list"]
        assert office.apply_url == "https://nexthopai.bamboohr.com/careers/24"
        assert office.location == "Santa Clara, California"
        # A remote job names no office, only the area it is open to.
        assert remote.location == "US East, North Carolina, United States"
        assert (office.page, office.posted_at) == (None, None)

    def test_its_page_gives_date_pay_and_work_model(self, monkeypatch) -> None:
        asked = serve(monkeypatch, self.DETAIL)
        job = providers.describe(self.listed())
        assert asked == ["https://alkira.bamboohr.com/careers/232/detail"]
        assert job.posted_at == "2026-07-06T00:00:00+00:00"
        assert job.facts.work_style == "Hybrid"
        assert job.facts.job_type == "full_time"
        # Free text, with no label of its own.
        assert job.facts.pay == Pay("USD", 125_000, 150_000, "year")

    def test_hourly_pay_in_the_compensation_field(self, monkeypatch) -> None:
        # BinSentry's part-time field technicians.
        detail = {"result": {"jobOpening": {"compensation": "$25-$30/hour"}}}
        serve(monkeypatch, detail)
        assert providers.describe(self.listed()).facts.pay == Pay("USD", 25, 30, "hour")

    def test_no_such_company_redirects_and_is_not_found(self, monkeypatch) -> None:
        def redirected(url: str):
            raise urllib.error.HTTPError(
                "https://www.bamboohr.com/", 302, "refused cross-origin redirect", None, None
            )

        monkeypatch.setattr(providers, "_get_json", redirected)
        with pytest.raises(BoardNotFound):
            providers.bamboohr("no-such-company", "Nobody")

    def test_the_date_its_page_gave_outlives_the_next_listing(self, monkeypatch) -> None:
        # The next run's list has no date; the page is not read again.
        serve(monkeypatch, self.DETAIL)
        read = providers.describe(self.listed())
        monday = store.update(None, [read], [], RunStats(), "2026-10-05T09:00:00+00:00")
        tuesday = store.update(monday, [self.listed()], [], RunStats(), "2026-10-06T09:00:00+00:00")
        [job] = tuesday.jobs
        assert job.posted_at == "2026-07-06T00:00:00+00:00"
        assert job.facts.pay == Pay("USD", 125_000, 150_000, "year")


class TestRippling:
    """Real responses from 2026-10-26, trimmed. Rippling's list states the work
    model and its job's own record does not, so the list's is carried to the page."""

    # Kraken Robotics lists one internship once per office, under one id.
    KRAKEN = {
        "items": [
            {
                "id": "cf84fc0e-616f-4c5a-8f44-1ba6ab761e87",
                "name": "Internships Opportunities",
                "url": "https://ats.rippling.com/kraken-robotics-inc/jobs/cf84fc0e-616f-4c5a-8f44-1ba6ab761e87",
                "department": {"name": "People & Culture"},
                "locations": [{"name": city, "workplaceType": "ON_SITE"}],
            }
            for city in ("Mount Pearl, Canada", "Dartmouth, Canada")
        ],
        "page": 0,
        "pageSize": 1000,
        "totalItems": 2,
        "totalPages": 1,
    }
    # Tavern Research's Data Scientist I, from its own record.
    TAVERN = {
        "uuid": "1a3cfbeb-973a-4528-8fc6-43c04e179ea8",
        "name": "Data Scientist I",
        "description": {
            "company": "<meta><p><b><strong>Data Scientist I</strong></b></p>"
            "<p>Location: Chicago, IL</p><p><b><strong>About Tavern Research</strong></b></p>"
            "<p>Tavern Research is a political tech startup building tools and insights.</p>",
            "role": "<meta><p><b><strong>About You</strong></b></p>"
            "<ul><li><span>You love rolling up your sleeves to wrestle messy data into shape."
            "</span></li></ul>",
        },
        "workLocations": ["Chicago, IL"],
        "employmentType": {"label": "SALARIED_FT", "id": "Salaried, full-time"},
        "createdOn": "2026-01-19T07:59:15.209000-08:00",
        "payRangeDetails": [
            {
                "location": "Chicago, IL",
                "currency": "USD",
                "frequency": "YEAR",
                "rangeStart": 95500.0,
                "rangeEnd": 113500.0,
                "isRemote": False,
            }
        ],
    }

    def listed(self, work_style: str | None = "On site") -> Job:
        return Job(
            ats="rippling",
            token="tavernresearch",
            company="Tavern Research",
            external_id="1a3cfbeb-973a-4528-8fc6-43c04e179ea8",
            title="Data Scientist I",
            apply_url="https://ats.rippling.com/tavernresearch/jobs/1a3cfbeb-973a-4528-8fc6-43c04e179ea8",
            location="Chicago, IL",
            work_style=work_style,
        )

    def test_one_job_in_two_offices_is_one_posting(self, monkeypatch) -> None:
        asked = serve(monkeypatch, self.KRAKEN)
        [job] = providers.rippling("kraken-robotics-inc", "Kraken Robotics")
        assert asked == [
            "https://ats.rippling.com/api/v2/board/kraken-robotics-inc/jobs?page=0&pageSize=1000"
        ]
        assert job.key == "rippling/kraken-robotics-inc#cf84fc0e-616f-4c5a-8f44-1ba6ab761e87"
        assert job.location == "Mount Pearl, Canada; Dartmouth, Canada"
        assert job.department == "People & Culture"
        assert job.work_style == "On site"
        # Its record is read once it is kept, like a Greenhouse posting's page.
        assert (job.page, job.posted_at) == (None, None)

    def test_a_job_remote_in_one_office_is_remote(self, monkeypatch) -> None:
        # As on Recruitee: one that can be done remotely is what a remote filter wants.
        rows = [dict(row) for row in self.KRAKEN["items"]]
        rows[1]["locations"] = [{"name": "NY", "workplaceType": "REMOTE"}]
        serve(monkeypatch, {**self.KRAKEN, "items": rows})
        [job] = providers.rippling("kraken-robotics-inc", "Kraken Robotics")
        assert job.work_style == "Remote"

    def test_its_record_gives_text_date_type_and_pay(self, monkeypatch) -> None:
        asked = serve(monkeypatch, self.TAVERN)
        job = providers.describe(self.listed())
        assert asked == [
            "https://ats.rippling.com/api/v2/board/tavernresearch/jobs/1a3cfbeb-973a-4528-8fc6-43c04e179ea8"
        ]
        assert job.posted_at == "2026-01-19T15:59:15.209000+00:00"
        facts = job.facts
        assert (facts.work_style, facts.job_type) == ("On site", "full_time")
        assert facts.pay == Pay("USD", 95_500, 113_500, "year")
        # Both parts are read, the company's first, as the posting's page shows them;
        # the sections then file each line under its heading.
        assert job.description == (
            "Data Scientist I\nRequirements\n"
            "• You love rolling up your sleeves to wrestle messy data into shape.\n"
            "Details\nChicago, IL\n"
            "About the Company\n"
            "Tavern Research is a political tech startup building tools and insights."
        )

    def test_no_such_board_is_not_found(self, monkeypatch) -> None:
        def missing(url: str):
            raise BoardNotFound(url)

        monkeypatch.setattr(providers, "_get_json", missing)
        with pytest.raises(BoardNotFound):
            providers.rippling("no-such-board", "Nobody")

    def test_a_board_past_one_page_is_too_large(self, monkeypatch) -> None:
        # Constructed: no board read had more than 102 postings. A partial list
        # would be evidence of nothing, so it is not read at all.
        serve(monkeypatch, {**self.KRAKEN, "totalItems": 1500, "totalPages": 2})
        with pytest.raises(providers.TooLarge):
            providers.rippling("kraken-robotics-inc", "Kraken Robotics")

    def test_an_apply_link_names_its_board(self) -> None:
        from build_boards import tokens

        link = "https://ats.rippling.com/en-GB/foundation-robotics/jobs/6be9c342-d335-4955-83c9-3d4482811307"
        assert tokens(link) == [("rippling", "foundation-robotics")]
        assert tokens("https://ats.rippling.com/tavernresearch/jobs/1a3cfbeb") == [
            ("rippling", "tavernresearch")
        ]


class TestWithPage:
    robots = SimpleNamespace(allows=lambda url: True, pace=lambda url: None)

    def job(self, ats: str) -> Job:
        return Job(
            ats=ats,
            token="acme",
            company="Acme",
            external_id="1",
            title="Software Engineer Intern",
            apply_url=f"https://example.test/{ats}/1",
        )

    def test_workable_and_bamboohr_pages_are_read_recruitee_never(self, swap_provider) -> None:
        read: list[str] = []

        def describe(job: Job) -> Job:
            read.append(job.ats)
            return replace(job, page=Page(providers.PAGE_VERSION, "Read.", Facts()))

        for ats in ("workable", "bamboohr"):
            swap_provider(ats, describe=describe)
        for ats in ("workable", "bamboohr", "recruitee"):
            run.with_page(self.job(ats), self.robots)
        assert read == ["workable", "bamboohr"]


class TestSharedPace:
    def test_a_providers_subdomains_share_one_pace(self) -> None:
        # Each company is its own origin on BambooHR and Recruitee.
        assert polite._pace_key("https://alkira.bamboohr.com") == "bamboohr.com"
        assert polite._pace_key("https://nexthopai.bamboohr.com") == "bamboohr.com"
        assert polite._pace_key("https://hardrockdigital.recruitee.com") == "recruitee.com"

    def test_other_origins_keep_their_own(self) -> None:
        assert polite._pace_key("https://apply.workable.com") == "https://apply.workable.com"
        # Not a subdomain of bamboohr.com.
        assert polite._pace_key("https://notbamboohr.com") == "https://notbamboohr.com"


class TestProviderRecords:
    """A field one reader needs without its partner fails nowhere loudly: a page URL
    with no reader is never read, a logo pattern with no page never matches."""

    def test_a_page_url_comes_with_its_reader(self) -> None:
        for ats, provider in providers.PROVIDERS.items():
            assert (provider.job_url is None) == (provider.describe is None), ats

    def test_a_logo_pattern_comes_with_its_page(self) -> None:
        for ats, provider in providers.PROVIDERS.items():
            assert provider.logo_page or not provider.logo_pattern, ats

    def test_case_blind_names_its_domain(self) -> None:
        for ats, provider in providers.PROVIDERS.items():
            assert provider.subdomains or not provider.case_blind, ats
        assert polite.FOLD_CASE == ("myworkdayjobs.com",)
