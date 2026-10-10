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

    def test_workable_and_bamboohr_pages_are_read_recruitee_never(self, monkeypatch) -> None:
        read: list[str] = []

        def describe(job: Job) -> Job:
            read.append(job.ats)
            return replace(job, page=Page(providers.PAGE_VERSION, "Read.", Facts()))

        for ats in ("workable", "bamboohr"):
            monkeypatch.setattr(providers, f"describe_{ats}", describe)
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
