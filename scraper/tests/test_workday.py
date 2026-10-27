"""Workday (KAN-134): a board read whole, 20 postings a request, or not at all.

Every row and record below is a real response from 2026-10-10 (Axos, Bose,
General Motors, NVIDIA), trimmed to the fields the reader uses. Where a test needs
a board small enough to page by hand, the page size or the cap is shrunk instead
of the data; those are marked.
"""

from __future__ import annotations

import json
import threading
import urllib.error
from dataclasses import replace
from datetime import date
from http.server import BaseHTTPRequestHandler, HTTPServer
from types import SimpleNamespace

import pytest

from build_boards import tokens
from workit_scraper import __main__ as run
from workit_scraper import polite, providers, shortlist, store, web
from workit_scraper.details import Facts, Pay
from workit_scraper.providers import BoardNotFound, Incomplete, Job, Page, TooLarge
from workit_scraper.store import BoardReads, RunStats, Store

AXOS = "axos.wd5/axos"
BOSE = "boseallaboutme.wd503/bose_careers"

# Axos's board, its first rows in the order Workday sent them (of 243).
AXOS_ROWS = [
    {
        "title": "Commercial Lending Operations Lead",
        "externalPath": "/job/Remote-USA/Commercial-Lending-Operations-Lead_JR5061",
        "locationsText": "Remote, USA",
        "postedOn": "Posted Yesterday",
        "remoteType": "Remote",
        "bulletFields": ["JR5061"],
    },
    {
        "title": "Accounting Intern",
        "externalPath": "/job/Omaha-NE/Accounting-Intern_JR5618",
        "locationsText": "Omaha, NE",
        "postedOn": "Posted 2 Days Ago",
        "remoteType": "Onsite",
        "bulletFields": ["JR5618"],
    },
    {
        "title": "Commercial Lending Intern",
        "externalPath": "/job/Menlo-Park-CA/Commercial-Lending-Intern_JR5695",
        "locationsText": "2 Locations",
        "postedOn": "Posted 2 Days Ago",
        "remoteType": "Onsite",
        "bulletFields": ["JR5695"],
    },
]

# Bose's Data Engineer co-op, from its own record: three places, an hourly range.
BOSE_RECORD = {
    "jobPostingInfo": {
        "title": "Data Engineer Co-Op",
        "jobDescription": (
            "<h1><b><u>Job Description</u></b></h1><p><b>ABOUT BOSE</b></p>"
            "<p>You know the moment.</p><br />"
            "At Bose, you're inspired to be and do your best and are rewarded for your "
            "unique talents! The hiring range for this position in the primary work "
            "location of Framingham, Massachusetts is: $21.15-$29.09 per hour.The hiring "
            "range for other Bose work locations may vary."
        ),
        "location": "US, MA - Framingham",
        "additionalLocations": ["US, MI - Bloomfield Hills", "US, GA - Atlanta"],
        "postedOn": "Posted 3 Days Ago",
        "startDate": "2026-10-07",
        "timeType": "Full time",
        "jobReqId": "R29270",
        "externalUrl": "https://boseallaboutme.wd503.myworkdayjobs.com/Bose_Careers/job/US-MA---Framingham/Data-Engineer-Co-Op_R29270",
    },
    "hiringOrganization": {"name": "Bose Corporation, U.S.A", "url": ""},
}

# General Motors' AI research internship: `remoteType` says Hybrid, and the text
# says both ("Hybrid: This internship is categorized as on-site ... 3 days a week").
GM_RECORD = {
    "jobPostingInfo": {
        "title": "2027 Summer Intern, AI Research, Embodied AI",
        "jobDescription": (
            "<p><b>Job Description</b></p><p><b>Work Arrangement:</b></p>"
            "<p>Hybrid: This internship is categorized as on-site. The selected intern "
            "is expected to report to the office 3 days a week.</p>"
        ),
        "location": "Sunnyvale, California, United States of America",
        "postedOn": "Posted Yesterday",
        "startDate": "2026-10-09",
        "timeType": "Full time",
        "remoteType": "Hybrid",
    }
}

# NVIDIA's first page's filters: it reports 2,000 postings and has 2,676. Three
# filters agree on that, and only the job family has no value at the cap.
NVIDIA_FACETS = [
    {
        "facetParameter": "jobFamilyGroup",
        "values": [
            {"descriptor": "Engineering", "id": "0c40f6bd1d8f10ae43ffaefd46dc7e78", "count": 1723},
            {"descriptor": "Sales", "id": "0c40f6bd1d8f10ae43ffcac5bbec7e90", "count": 329},
            {
                "descriptor": "Univ Employment",
                "id": "0c40f6bd1d8f10ae43ffda1e8d447e94",
                "count": 142,
            },
            {"descriptor": "Operations", "id": "0c40f6bd1d8f10ae43ffc3fc7d8c7e8a", "count": 118},
            {
                "descriptor": "Program Manager",
                "id": "0c40f6bd1d8f10ae43ffc668c6847e8c",
                "count": 103,
            },
            {"descriptor": "Marketing", "id": "0c40f6bd1d8f10ae43ffc19725ec7e88", "count": 91},
            {
                "descriptor": "IT - Information Technology",
                "id": "0c40f6bd1d8f10ae43ffbd1459047e84",
                "count": 45,
            },
            {"descriptor": "Research", "id": "0c40f6bd1d8f10ae43ffc8817cf47e8e", "count": 35},
            {"descriptor": "Finance", "id": "0c40f6bd1d8f10ae43ffb5dd06f47e7e", "count": 33},
            {
                "descriptor": "Professional Services",
                "id": "e8bdc341a93101bd5f4d2b0a1c005e36",
                "count": 32,
            },
            {"descriptor": "Human Resources", "id": "0c40f6bd1d8f10ae43ffbac3680c7e82", "count": 8},
            {
                "descriptor": "Business Development",
                "id": "0c40f6bd1d8f10ae43ffac5fdfac7e76",
                "count": 8,
            },
            {"descriptor": "Legal", "id": "0c40f6bd1d8f10ae43ffbf4412147e86", "count": 4},
            {"descriptor": "Facilities", "id": "0c40f6bd1d8f10ae43ffb3a6aaac7e7c", "count": 4},
            {"descriptor": "Administration", "id": "0c40f6bd1d8f10ae43ffaa1e1d6c7e74", "count": 1},
        ],
    },
    {
        "facetParameter": "workerSubType",
        "values": [
            {
                "descriptor": "Regular Employee",
                "id": "0c40f6bd1d8f10adf6dae161b1844a15",
                "count": 2267,
            },
            {"descriptor": "Management", "id": "0c40f6bd1d8f10adf6dae2cd57444a16", "count": 207},
            {
                "descriptor": "Intern (Fixed Term)",
                "id": "0c40f6bd1d8f10adf6dae42e46d44a17",
                "count": 140,
            },
            {
                "descriptor": "New College Graduate",
                "id": "ab40a98049581037a3ada55b087049b7",
                "count": 59,
            },
            {
                "descriptor": "Regular Employee (Fixed Term)",
                "id": "cc40d60d614c01809d56fe967144ce2c",
                "count": 2,
            },
            {
                "descriptor": "Academic (Fixed Term)",
                "id": "ec9560ee6dc71001d6f3cf17ea640000",
                "count": 1,
            },
        ],
    },
    {
        "facetParameter": "timeType",
        "values": [
            {"descriptor": "Full time", "id": "5509c0b5959810ac0029943377d47364", "count": 2674},
            {"descriptor": "Part time", "id": "5509c0b5959810ac00299430e7947363", "count": 2},
        ],
    },
]


def board_pages(monkeypatch, pages: dict[tuple[str, int], dict]) -> list[tuple[str, int]]:
    """Answer each list request by (filter value, offset); record what was asked."""
    asked: list[tuple[str, int]] = []

    def post(url: str, payload: dict) -> dict:
        facets = payload["appliedFacets"]
        value = next(iter(facets.values()))[0] if facets else ""
        asked.append((value, payload["offset"]))
        assert payload["limit"] == providers.WORKDAY_PAGE and payload["searchText"] == ""
        return pages[(value, payload["offset"])]

    monkeypatch.setattr(providers, "_post_json", post)
    return asked


class TestTokens:
    def test_a_token_names_tenant_data_centre_and_site(self) -> None:
        assert providers.listing_url("workday", "nvidia.wd5/nvidiaexternalcareersite") == (
            "https://nvidia.wd5.myworkdayjobs.com/wday/cxs/nvidia/nvidiaexternalcareersite/jobs"
        )
        assert providers.job_url("workday", BOSE, "/job/US-MA---Framingham/X_R1") == (
            "https://boseallaboutme.wd503.myworkdayjobs.com"
            "/wday/cxs/boseallaboutme/bose_careers/job/US-MA---Framingham/X_R1"
        )

    def test_robots_must_allow_the_careers_site_too(self) -> None:
        assert providers.robots_urls("workday", "cat.wd5/caterpillarcareers") == [
            "https://cat.wd5.myworkdayjobs.com/wday/cxs/cat/caterpillarcareers/jobs",
            "https://cat.wd5.myworkdayjobs.com/caterpillarcareers/",
        ]
        assert providers.robots_urls("lever", "palantir") == [
            "https://api.lever.co/v0/postings/palantir?mode=json"
        ]


class TestList:
    def test_a_board_is_read_page_by_page_and_each_page_is_paced(self, monkeypatch) -> None:
        # Shrunk: two postings a page, so three postings take two requests.
        monkeypatch.setattr(providers, "WORKDAY_PAGE", 2)
        asked = board_pages(
            monkeypatch,
            {
                ("", 0): {"total": 3, "jobPostings": AXOS_ROWS[:2]},
                # Workday sends the count on the first page only.
                ("", 2): {"total": 0, "jobPostings": AXOS_ROWS[2:]},
            },
        )
        paced: list[str] = []
        jobs = providers.workday(AXOS, "Axos", pace=paced.append)
        assert asked == [("", 0), ("", 2)]
        # The first request is paced by the caller, like every board's.
        assert paced == ["https://axos.wd5.myworkdayjobs.com/wday/cxs/axos/axos/jobs"]
        assert [j.external_id for j in jobs] == [r["externalPath"] for r in AXOS_ROWS]
        lead, intern, two_places = jobs
        assert lead.apply_url == (
            "https://axos.wd5.myworkdayjobs.com/axos"
            "/job/Remote-USA/Commercial-Lending-Operations-Lead_JR5061"
        )
        assert (lead.location, intern.location) == ("Remote, USA", "Omaha, NE")
        # "2 Locations" is no place; the posting's own record names them.
        assert two_places.location is None
        assert lead.page is None and lead.key.startswith("workday/axos.wd5/axos#/job/")

    def test_an_empty_board_is_a_board(self, monkeypatch) -> None:
        board_pages(monkeypatch, {("", 0): {"total": 0, "jobPostings": []}})
        assert providers.workday(AXOS, "Axos") == []

    def test_a_row_with_no_path_counts_but_is_no_posting(self, monkeypatch) -> None:
        # AT&T's list, offset 640: a requisition number and nothing else. Workday
        # counts it in the total, so the read adds up only if we count it too.
        unlinked = {"bulletFields": ["R-123620"]}
        board_pages(monkeypatch, {("", 0): {"total": 3, "jobPostings": [*AXOS_ROWS[:2], unlinked]}})
        jobs = providers.workday("att.wd1/attgeneral", "AT&T")
        assert [j.title for j in jobs] == [
            "Commercial Lending Operations Lead",
            "Accounting Intern",
        ]

    def test_pages_that_do_not_add_up_are_no_read(self, monkeypatch) -> None:
        # Shrunk page. A posting added mid-read pushes one along: page two repeats
        # the last of page one, and one posting is never seen.
        monkeypatch.setattr(providers, "WORKDAY_PAGE", 2)
        board_pages(
            monkeypatch,
            {
                ("", 0): {"total": 4, "jobPostings": AXOS_ROWS[:2]},
                ("", 2): {"total": 0, "jobPostings": AXOS_ROWS[1:3]},
            },
        )
        with pytest.raises(Incomplete):
            providers.workday(AXOS, "Axos")

    def test_a_later_page_not_found_is_no_read(self, monkeypatch) -> None:
        # Only the first request can say the board is gone; a 404 on a later page
        # is a page we could not read, and closes nothing.
        monkeypatch.setattr(providers, "WORKDAY_PAGE", 2)

        def post(url: str, payload: dict) -> dict:
            if payload["offset"]:
                raise BoardNotFound(url)
            return {"total": 3, "jobPostings": AXOS_ROWS[:2]}

        monkeypatch.setattr(providers, "_post_json", post)
        with pytest.raises(Incomplete):
            providers.workday(AXOS, "Axos")

    def test_a_board_past_the_limit_is_skipped_after_one_request(self, monkeypatch) -> None:
        # Dollar Tree's count.
        asked = board_pages(monkeypatch, {("", 0): {"total": 25026, "jobPostings": AXOS_ROWS}})
        with pytest.raises(TooLarge):
            providers.workday("dollartree.wd5/dollartreeus", "Dollar Tree")
        assert asked == [("", 0)]

    def test_no_such_tenant_is_a_422(self, monkeypatch) -> None:
        def post(url: str, payload: dict) -> dict:
            raise urllib.error.HTTPError(url, 422, "Unprocessable Entity", None, None)

        monkeypatch.setattr(providers, "_post_json", post)
        with pytest.raises(BoardNotFound):
            providers.workday("nosuchtenant123.wd5/external", "Nobody")


class TestCappedBoards:
    def test_nvidias_filters_give_its_real_size_and_slices(self) -> None:
        size, slices = providers._workday_slices({"total": 2000, "facets": NVIDIA_FACETS})
        assert size == 2676
        # Job family: its largest value, Engineering's 1,723, is under the cap.
        # Job type would not do: Regular Employee alone is 2,267.
        assert slices is not None and len(slices) == 15
        assert slices[0] == {"jobFamilyGroup": ["0c40f6bd1d8f10ae43ffaefd46dc7e78"]}

    def test_one_filter_alone_is_not_trusted(self) -> None:
        alone = {"total": 2000, "facets": NVIDIA_FACETS[:1]}
        assert providers._workday_slices(alone) == (2000, None)

    def test_a_capped_board_is_read_in_slices(self, monkeypatch) -> None:
        # Shrunk cap (3): NVIDIA's shape, three postings in two job families.
        monkeypatch.setattr(providers, "WORKDAY_CAP", 3)
        facets = [
            {"facetParameter": "jobFamilyGroup", "values": [
                {"id": "eng", "count": 2}, {"id": "univ", "count": 1}]},
            {"facetParameter": "timeType", "values": [{"id": "full", "count": 3}]},
        ]  # fmt: skip
        asked = board_pages(
            monkeypatch,
            {
                ("", 0): {"total": 3, "jobPostings": AXOS_ROWS[:2], "facets": facets},
                ("eng", 0): {"total": 2, "jobPostings": AXOS_ROWS[:2]},
                ("univ", 0): {"total": 1, "jobPostings": AXOS_ROWS[2:]},
            },
        )
        paced: list[str] = []
        jobs = providers.workday(AXOS, "Axos", pace=paced.append)
        assert asked == [("", 0), ("eng", 0), ("univ", 0)]
        assert len(paced) == 2 and len(jobs) == 3

    def test_a_capped_board_no_filter_splits_is_too_large(self, monkeypatch) -> None:
        board_pages(
            monkeypatch,
            {("", 0): {"total": 2000, "jobPostings": AXOS_ROWS, "facets": NVIDIA_FACETS[:1]}},
        )
        with pytest.raises(TooLarge):
            providers.workday("citi.wd5/2", "Citi")


class TestPostedOn:
    @pytest.mark.parametrize(
        ("text", "posted"),
        [
            ("Posted Today", "2026-10-10T00:00:00+00:00"),
            ("Posted Yesterday", "2026-10-09T00:00:00+00:00"),
            ("Posted 3 Days Ago", "2026-10-07T00:00:00+00:00"),
            ("Posted 29 Days Ago", "2026-09-11T00:00:00+00:00"),
            # Older than 30 days, by how much it does not say.
            ("Posted 30+ Days Ago", None),
            # Some tenants put another field where the date goes.
            ("Tempe, AZ", None),
            (None, None),
        ],
    )
    def test_a_relative_date_counts_back_from_today(self, text, posted) -> None:
        assert providers._workday_posted(text, date(2026, 10, 10)) == posted

    def test_the_list_date_is_relative_to_the_day_of_the_read(self, monkeypatch) -> None:
        board_pages(monkeypatch, {("", 0): {"total": 1, "jobPostings": AXOS_ROWS[:1]}})
        [job] = providers.workday(AXOS, "Axos")
        assert job.posted_at is not None and job.posted_at.endswith("T00:00:00+00:00")


class TestRecord:
    def listed(self, token: str, path: str, title: str, location: str | None) -> Job:
        return Job(
            ats="workday",
            token=token,
            company="Bose",
            external_id=path,
            title=title,
            apply_url=f"https://example.test{path}",
            location=location,
            posted_at="2026-10-06T00:00:00+00:00",
        )

    def bose(self) -> Job:
        path = "/job/US-MA---Framingham/Data-Engineer-Co-Op_R29270"
        return self.listed(BOSE, path, "Data Engineer Co-Op", None)

    def test_its_record_gives_places_date_type_and_pay(self, monkeypatch) -> None:
        asked: list[str] = []
        monkeypatch.setattr(providers, "_get_json", lambda url: asked.append(url) or BOSE_RECORD)
        job = providers.describe(self.bose())
        assert asked == [
            "https://boseallaboutme.wd503.myworkdayjobs.com/wday/cxs/boseallaboutme"
            "/bose_careers/job/US-MA---Framingham/Data-Engineer-Co-Op_R29270"
        ]
        # `startDate` is the day it went up: the list said "Posted 3 Days Ago".
        assert job.posted_at == "2026-10-07T00:00:00+00:00"
        # One location, as Workable's are, which the backend splits on ";". Three
        # separate ones would print "3 locations" and resolve to no place at all.
        assert job.places == ("US, MA - Framingham; US, MI - Bloomfield Hills; US, GA - Atlanta",)
        assert job.facts.job_type == "full_time"
        assert job.facts.pay == Pay("USD", 21.15, 29.09, "hour")
        assert job.description is not None and job.description.startswith("Job Description")
        # The requisition, which a copy on another careers site shares.
        assert job.page is not None and job.page.requisition == "R29270"

    def test_remote_type_is_the_stated_work_style(self, monkeypatch) -> None:
        monkeypatch.setattr(providers, "_get_json", lambda url: GM_RECORD)
        listed = self.listed(
            "generalmotors.wd5/careers_gm",
            "/job/Sunnyvale-California-United-States-of-America/X_JR-202622146",
            "2027 Summer Intern, AI Research, Embodied AI",
            "Sunnyvale, California, United States of America",
        )
        job = providers.describe(listed)
        assert job.facts.work_style == "Hybrid"
        assert job.places == ("Sunnyvale, California, United States of America",)

    @pytest.mark.parametrize(
        ("value", "style"),
        [
            ("Hybrid", "Hybrid"),
            ("Onsite", "On site"),
            ("On-Site", "On site"),
            ("In Person", "On site"),
            ("Remote", "Remote"),
            ("Remote - Nationwide", "Remote"),
            ("Partially Remote", "Hybrid"),
            ("Hybrid or 100% Remote", "Hybrid"),
            ("Remote Type - Hybrid", "Hybrid"),
            ("Flex", "Hybrid"),
            ("Office Worker (NOT Remote)", "On site"),
            ("Remote work is not available", "On site"),
            ("Remote Type - Not eligible", "On site"),
            ("The work arrangement for the position is full-time on-site work", "On site"),
            ("Field", None),
            ("As Needed", None),
            (None, None),
        ],
    )
    def test_remote_type_wording(self, value, style) -> None:
        # Every value here was a `remoteType` on the first full sweep.
        assert providers._workday_work_style(value) == style

    def test_the_list_never_overwrites_the_records_date(self, monkeypatch) -> None:
        monkeypatch.setattr(providers, "_get_json", lambda url: BOSE_RECORD)
        described = providers.describe(self.bose())
        monday = store.update(None, [described], [], RunStats(), "2026-10-07T09:00:00+00:00")
        # The next run's list counts back a day off, then says "30+ Days Ago".
        for listed_at in ("2026-10-06T00:00:00+00:00", None):
            listing = replace(self.bose(), posted_at=listed_at)
            later = store.update(monday, [listing], [], RunStats(), "2026-11-09T09:00:00+00:00")
            [job] = later.jobs
            assert job.posted_at == "2026-10-07T00:00:00+00:00"
            assert job.places[0].startswith("US, MA - Framingham; ")


SEEN = "2026-10-10T20:50:07.916560+00:00"
KRAKOW = "/job/Krakw-POL/Intern--Software-Engineer_26WD101095"
CADENCE = "/job/SAN-JOSE/CST-Application-Engineer-Intern---Silicon_R56655"
SINGAPORE_PM = "/job/Singapore-SGP/Intern--Product-Manager--PSET-Access-PM-_26WD"
BOEING = (
    "/job/USA---El-Segundo-CA"
    "/Command-and-Data-Handling-Network--Autonomous-Navigation-Systems-_JR2026523750"
)


def copy(
    token: str,
    path: str,
    requisition: str | None,
    *,
    company: str = "Autodesk",
    title: str = "Intern, Software Engineer",
    location: str = "Kraków, POL",
    description: str | None = None,
    seen: str = SEEN,
) -> Job:
    """A Workday posting as `pick` sees it: listed, and its record read (a page
    with the requisition), or not (no page)."""
    host, site = token.split("/")
    page = Page(providers.PAGE_VERSION, description, Facts(), requisition=requisition)
    return Job(
        ats="workday",
        token=token,
        company=company,
        external_id=path,
        title=title,
        apply_url=f"https://{host}.myworkdayjobs.com/{site}{path}",
        location=location,
        page=page if requisition else None,
        first_seen_at=seen,
    )


def one_role(jobs: list[Job]) -> shortlist.Role:
    [role] = shortlist.pick(jobs, is_new=lambda job: False)
    return role


class TestOneJobOnTwoSites:
    """One requisition on several of a company's careers sites is one role
    (`shortlist.pick`). Sites, paths, titles, places and requisition numbers are
    the 2026-10-10 records'; descriptions are trimmed."""

    def test_two_sites_are_one_role_linking_the_student_site(self) -> None:
        ext = copy("autodesk.wd1/ext", f"{KRAKOW}-1", "26WD101095")
        uni = copy("autodesk.wd1/uni", KRAKOW, "26WD101095")
        for jobs in ([ext, uni], [uni, ext]):
            role = one_role(jobs)
            assert role.apply_url == uni.apply_url
            assert role.locations == ("Kraków, POL",)

    def test_three_sites_link_a_student_one(self) -> None:
        # Cadence's CST internship, on its main site and two university ones.
        main, univ, cst = (
            copy(
                f"cadence.wd1/{site}",
                CADENCE + suffix,
                "R56655",
                company="Cadence Design Systems",
                title="CST Application Engineer Intern - Silicon",
                location="SAN JOSE",
            )
            for site, suffix in [
                ("external_careers", "-1"),
                ("univ_careers", ""),
                ("university_cst", "-3"),
            ]
        )
        assert one_role([main, cst, univ]).apply_url == univ.apply_url

    def test_two_requisitions_with_one_title_are_two_roles(self) -> None:
        # Autodesk posts two product-management interns in Singapore under one
        # title, each on both sites.
        ext_a, uni_a, ext_b, uni_b = (
            copy(
                f"autodesk.wd1/{site}",
                SINGAPORE_PM + number + suffix,
                f"26WD{number}",
                title="Intern, Product Manager [PSET-Access-PM]",
                location="Singapore, SGP",
            )
            for site, number, suffix in [
                ("ext", "100993", "-2"),
                ("uni", "100993", "-1"),
                ("ext", "100994", "-2"),
                ("uni", "100994", ""),
            ]
        )
        roles = shortlist.pick([ext_a, uni_a, ext_b, uni_b], is_new=lambda job: False)
        assert sorted(role.apply_url for role in roles) == [uni_a.apply_url, uni_b.apply_url]

    def test_other_requisitions_stay_apart(self) -> None:
        # Booz Allen's two careers sites list one title under two requisitions:
        # two openings, not one posted twice.
        copies = [
            copy(
                f"bah.wd1/{site}",
                f"/job/San-Diego-CA/AI-Software-Developer--Junior_{number}",
                number,
                company="Booz Allen",
                title="AI Software Developer, Junior",
                location="San Diego, CA",
            )
            for site, number in [("bah_jobs", "R0248284"), ("confidential", "R0251196")]
        ]
        assert len(shortlist.pick(copies, is_new=lambda job: False)) == 2

    def test_only_one_company_and_a_read_record_merge(self) -> None:
        uni = copy("autodesk.wd1/uni", KRAKOW, "26WD101095")
        # Relabelled: one tenant can host several companies (Gilead and Kite).
        other = copy("autodesk.wd1/ext", f"{KRAKOW}-1", "26WD101095", company="Spacemaker")
        assert len(shortlist.pick([other, uni], is_new=lambda job: False)) == 2
        # No record read, so no requisition: the copy keeps its own URL.
        unread = copy("autodesk.wd1/ext", f"{KRAKOW}-1", None)
        assert len(shortlist.pick([unread, uni], is_new=lambda job: False)) == 2

    def test_with_no_student_site_the_oldest_copy_leads(self) -> None:
        # Boeing's El Segundo role, on its main site and its subsidiaries' site.
        main, subsidiary = (
            copy(
                f"boeing.wd1/{site}",
                BOEING + suffix,
                "JR2026523750",
                company="The Boeing Company",
                title="Entry Level Command and Data Handling Network Engineer",
                location="USA - El Segundo, CA",
            )
            for site, suffix in [("external_careers", "-1"), ("external_subsidiary", "")]
        )
        # Both seen in one run: the first URL, so the link holds from run to run.
        assert one_role([subsidiary, main]).apply_url == main.apply_url
        earlier = replace(subsidiary, first_seen_at="2026-10-09T20:50:07.916560+00:00")
        assert one_role([main, earlier]).apply_url == earlier.apply_url

    def test_the_lead_copy_is_the_one_described(self) -> None:
        # Autodesk's Oslo graduate role: one text, each site's own header.
        opening = "Join Autodesk in Oslo as a Graduate Software Engineer in August 2027"
        path = "/job/Norway---Oslo/Graduate-Software-Engineer_26WD100002"
        ext, uni = (
            copy(
                f"autodesk.wd1/{site}",
                path + suffix,
                "26WD100002",
                title="Graduate Software Engineer",
                location="Norway - Oslo",
                description=text,
            )
            for site, suffix, text in [
                ("ext", "-1", f"Job Requisition ID #\n26WD100002\n{opening}"),
                ("uni", "-3", opening),
            ]
        )
        assert one_role([ext, uni]).description == opening

    def test_the_requisition_is_kept_in_jobs_json(self, tmp_path) -> None:
        listed = copy("autodesk.wd1/uni", KRAKOW, "26WD101095")
        store.save(store.update(None, [listed], [], RunStats(), SEEN), tmp_path / "jobs.json")
        [job] = store.load(tmp_path / "jobs.json").jobs
        assert job.page is not None and job.page.requisition == "26WD101095"

    @pytest.mark.parametrize(
        ("site", "for_students"),
        [
            # Every name below is a careers site in boards.csv.
            ("uni", True),
            ("univ_careers", True),
            ("university_talent_intern", True),
            ("campus", True),
            ("intern", True),
            ("us_early_talent_site", True),
            ("bpearlycareers", True),
            ("futureforce_newgradroles", True),
            ("students-graduates", True),
            ("ext", False),
            ("external_careers", False),
            ("external_subsidiary", False),
            ("search", False),
            ("international_career_site", False),
            ("internaljobs", False),
            ("earlywarningcareers", False),
            ("novogradac", False),
            ("unilever_experienced_professionals", False),
            ("private_postings_intern_conversion_only", False),
        ],
    )
    def test_a_student_site_by_its_name(self, site: str, for_students: bool) -> None:
        job = copy(f"autodesk.wd1/{site}", KRAKOW, "26WD101095")
        assert shortlist._for_students(job) is for_students


class TestScrapeOne:
    board = providers.Board("workday", "cat.wd5/caterpillarcareers", "Caterpillar")

    def test_a_disallowed_careers_site_is_skipped(self, monkeypatch) -> None:
        monkeypatch.setattr(providers, "_post_json", lambda url, payload: pytest.fail("read"))
        robots = SimpleNamespace(
            allows=lambda url: "/caterpillarcareers/" not in url, pace=lambda url: None
        )
        assert run._scrape_one(self.board, robots) == (run.Outcome.SKIPPED, [])

    def test_too_large_is_skipped_and_incomplete_failed(self, swap_provider) -> None:
        robots = SimpleNamespace(allows=lambda url: True, pace=lambda url: None)
        for error, outcome in ((TooLarge, run.Outcome.SKIPPED), (Incomplete, run.Outcome.FAILED)):

            def fail(token: str, company: str, *, pace, error=error) -> list[Job]:
                raise error("x")

            swap_provider("workday", read=fail)
            assert run._scrape_one(self.board, robots) == (outcome, [])


class TestBudget:
    def test_a_lane_out_of_time_defers_its_boards_and_reads_none(
        self, monkeypatch, swap_provider
    ) -> None:
        boards = [
            providers.Board("workday", "a.wd1/x", "A"),
            providers.Board("lever", "b", "B"),
            providers.Board("workday", "c.wd5/y", "C"),
        ]
        swap_provider("workday", budget_s=-1)
        monkeypatch.setattr(run, "_scrape_one", lambda b, robots: (run.Outcome.OK, []))
        _, stats, read, _ = run.scrape(boards, SimpleNamespace(), {})
        assert read == ["lever/b"]
        assert (stats.boards_ok, stats.boards_deferred) == (1, 2)

    def test_boards_never_read_come_first_then_the_oldest(self) -> None:
        boards = [providers.Board("workday", f"t{i}.wd1/s", "T") for i in range(3)]
        reads = {
            boards[0].key: BoardReads("2026-10-01T00:00:00+00:00", "2026-10-09T00:00:00+00:00"),
            boards[1].key: BoardReads("2026-10-01T00:00:00+00:00", "2026-10-08T00:00:00+00:00"),
        }
        hot = [
            Job("workday", b.token, "T", "/job/1", "Software Engineer Intern", "u") for b in boards
        ]
        stored = Store("2026-10-09T00:00:00+00:00", RunStats(), hot, reads)
        order = stored.to_read(boards, "2026-10-10T00:00:00+00:00", everything=True)
        assert order == [boards[2], boards[1], boards[0]]


class TestPolite:
    ROBOTS = b"User-agent: *\nDisallow: /CaterpillarCareers/\nDisallow: /refreshFacet/\n"

    def test_an_origin_not_named_up_front_is_read_once_when_asked(self, monkeypatch) -> None:
        fetched: list[str] = []
        monkeypatch.setattr(
            polite.web, "get", lambda url, timeout: fetched.append(url) or self.ROBOTS
        )
        monkeypatch.setattr(polite.time, "sleep", lambda s: None)
        robots = polite.Robots()
        api = "https://cat.wd5.myworkdayjobs.com/wday/cxs/cat/caterpillarcareers/jobs"
        assert robots.allows(api)
        # Workday paths are case-blind, so its robots.txt is read that way too.
        assert not robots.allows("https://cat.wd5.myworkdayjobs.com/caterpillarcareers/")
        assert not robots.allows("https://cat.wd5.myworkdayjobs.com/CaterpillarCareers/")
        robots.pace(api)
        assert fetched == ["https://cat.wd5.myworkdayjobs.com/robots.txt"]

    def test_other_hosts_keep_case(self, monkeypatch) -> None:
        monkeypatch.setattr(polite.web, "get", lambda url, timeout: self.ROBOTS)
        monkeypatch.setattr(polite.time, "sleep", lambda s: None)
        robots = polite.Robots(["https://example.test/"])
        assert robots.allows("https://example.test/caterpillarcareers/")

    def test_all_of_workday_is_one_pace(self) -> None:
        assert polite._pace_key("https://nvidia.wd5.myworkdayjobs.com") == "myworkdayjobs.com"
        assert polite._pace_key("https://boeing.wd1.myworkdayjobs.com") == "myworkdayjobs.com"


class TestPost:
    def test_post_sends_json_with_our_agent_and_refuses_other_origins(self) -> None:
        seen: dict[str, object] = {}

        class Handler(BaseHTTPRequestHandler):
            def do_POST(self) -> None:  # noqa: N802 - the stdlib's name
                if self.path == "/away":
                    # A 302, which urllib would follow (as a GET) on its own.
                    self.send_response(302)
                    self.send_header("Location", "http://127.0.0.2:1/elsewhere")
                    self.end_headers()
                    return
                length = int(self.headers["Content-Length"])
                seen.update(
                    agent=self.headers["User-Agent"],
                    type=self.headers["Content-Type"],
                    body=json.loads(self.rfile.read(length)),
                )
                self.send_response(200)
                self.end_headers()
                self.wfile.write(b'{"total": 0, "jobPostings": []}')

            def log_message(self, *args: object) -> None:
                pass

        server = HTTPServer(("127.0.0.1", 0), Handler)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        base = f"http://127.0.0.1:{server.server_port}"
        try:
            body = web.post(f"{base}/jobs", {"limit": 20, "offset": 0}, timeout=5)
            assert json.loads(body) == {"total": 0, "jobPostings": []}
            assert seen == {
                "agent": web.USER_AGENT,
                "type": "application/json",
                "body": {"limit": 20, "offset": 0},
            }
            with pytest.raises(urllib.error.HTTPError):
                web.post(f"{base}/away", {}, timeout=5)
        finally:
            server.shutdown()


@pytest.mark.parametrize(
    ("link", "board"),
    [
        (
            "https://nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite/job/US-CA-Santa-Clara/Software-Engineer-Intern_JR2009",
            "nvidia.wd5/nvidiaexternalcareersite",
        ),
        # A locale before the site.
        (
            "https://intel.wd1.myworkdayjobs.com/en-us/external/job/US-Arizona-Phoenix/Metrology-Engineer_JR0283779-1",
            "intel.wd1/external",
        ),
        (
            "https://pae.wd1.myworkdayjobs.com/en-US/amentum_careers/job/US-TX-Houston/Summer-2026_R0162032",
            "pae.wd1/amentum_careers",
        ),
        # A two-letter site is a site, not a locale.
        (
            "https://jj.wd5.myworkdayjobs.com/jj/job/Raritan-New-Jersey-United-States/Intern_R-031415",
            "jj.wd5/jj",
        ),
        (
            "https://citi.wd5.myworkdayjobs.com/2/job/New-York-New-York-United-States/Junior-Developer_26962250",
            "citi.wd5/2",
        ),
        # Workday's other address names the same board.
        (
            "https://wd1.myworkdaysite.com/recruiting/snapchat/snap/job/Los-Angeles-California/Software-Engineer-Intern_R0044581-1",
            "snapchat.wd1/snap",
        ),
        (
            "https://wd5.myworkdaysite.com/en-US/recruiting/guidewire/external/job/Canada---Toronto/Front-End-Developer-Intern_JR_14453",
            "guidewire.wd5/external",
        ),
    ],
)
def test_a_workday_apply_link_names_its_board(link: str, board: str) -> None:
    assert tokens(link) == [("workday", board)]


def test_the_api_path_names_no_board() -> None:
    assert tokens("https://nvidia.wd5.myworkdayjobs.com/wday/cxs/nvidia/x/jobs") == []
