"""
GET /jobs: job_postings rows served in the feed's shape. The queries need
Postgres, which tests don't have, so the route is tested with its fetch stood
in for, and the row-to-listing mapping on its own.
"""

import datetime
import uuid
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from app.db import get_session
from app.main import app
from app.models import dto
from app.routers.jobs import (
    YEARLY,
    JobFilters,
    location_options,
    matching,
    offered_in,
    season_is_over,
    season_of,
    to_listing,
)
from app.schemas.jobs import FacetCount, JobFacets, JobListing

ROW = SimpleNamespace(
    id=uuid.UUID("6f1c0e2a-3b4d-4e5f-8a9b-0c1d2e3f4a5b"),
    title="Robot Software Intern",
    company_name="Rhoda AI",
    apply_url="https://jobs.example/1",
    experience_level=dto.experience_level.internship,
    work_style=dto.work_style.hybrid,
    location_raw="Mountain View, CA",
    posted_at=datetime.datetime(2026, 10, 6, 2, 42, 6, tzinfo=datetime.UTC),
    company_logo_url=None,
    job_type=None,
    min_years_experience=None,
    start_term="Summer 2027",
    sponsorship=dto.visa_sponsorship.sponsors,
    salary=None,
    salary_min=40.0,
    salary_max=46.0,
    salary_currency="USD",
    salary_period=dto.salary_period.hour,
)


@pytest.fixture
def no_database():
    app.dependency_overrides[get_session] = lambda: None
    yield
    app.dependency_overrides.clear()


def test_row_becomes_the_feed_shape():
    listing = to_listing(ROW, "ROS nodes.")
    assert listing.model_dump() == {
        "id": "6f1c0e2a-3b4d-4e5f-8a9b-0c1d2e3f4a5b",
        "title": "Robot Software Intern",
        "company": "Rhoda AI",
        "apply_url": "https://jobs.example/1",
        "experience_level": "internship",
        "work_style": dto.work_style.hybrid,
        "location": "Mountain View, CA",
        # The same string feed.json carried, so the frontend's dates don't move.
        "posted_at": "2026-10-06T02:42:06+00:00",
        "logo_url": None,
        "description": "ROS nodes.",
        "job_type": None,
        "salary": None,
        "salary_min": 40.0,
        "salary_max": 46.0,
        "salary_currency": "USD",
        "salary_period": dto.salary_period.hour,
        "min_years_experience": None,
        "start_term": "Summer 2027",
        "sponsorship": dto.visa_sponsorship.sponsors,
    }


def test_column_defaults_are_not_pay():
    # salary_currency and salary_period are NOT NULL with defaults (USD, year): a
    # job stating no pay must not read as "USD per year".
    unpaid = SimpleNamespace(**{**vars(ROW), "salary_min": None, "salary_max": None,
                                "salary_period": dto.salary_period.year})
    listing = to_listing(unpaid)
    assert (listing.salary_currency, listing.salary_period) == (None, None)


def test_row_without_a_date():
    assert to_listing(SimpleNamespace(**{**vars(ROW), "posted_at": None})).posted_at is None


def test_route_leaves_descriptions_out(no_database, monkeypatch):
    async def fetch(db, limit, filters):
        return [to_listing(ROW, "long text")]

    monkeypatch.setattr("app.routers.jobs.fetch_listings", fetch)
    rows = TestClient(app).get("/jobs").json()
    assert rows[0]["title"] == "Robot Software Intern"
    assert "description" not in rows[0]


def test_route_passes_the_limit(no_database, monkeypatch):
    seen = []

    async def fetch(db, limit, filters):
        seen.append(limit)
        return []

    monkeypatch.setattr("app.routers.jobs.fetch_listings", fetch)
    client = TestClient(app)
    assert client.get("/jobs").json() == []
    assert client.get("/jobs?limit=7").status_code == 200
    assert client.get("/jobs?limit=501").status_code == 422
    assert seen == [50, 7]


def test_a_feed_written_before_descriptions_still_parses():
    # The import still reads feed.json through JobListing.
    row = {**to_listing(ROW).model_dump(exclude={"description"})}
    assert JobListing.model_validate(row).description is None


def test_route_passes_the_places(no_database, monkeypatch):
    seen = []

    async def fetch(db, limit, filters):
        seen.append(filters.places)
        return []

    monkeypatch.setattr("app.routers.jobs.fetch_listings", fetch)
    client = TestClient(app)
    assert client.get("/jobs").status_code == 200
    assert client.get("/jobs?location=US-CA&location=US").status_code == 200
    assert seen == [[], ["US-CA", "US"]]


@pytest.mark.parametrize("code", ["us", "California", "US-", "USA", "US-CA;"])
def test_route_rejects_a_malformed_place(no_database, code):
    assert TestClient(app).get("/jobs", params={"location": code}).status_code == 422


def test_route_caps_the_places(no_database):
    params = [("location", "US")] * 61
    assert TestClient(app).get("/jobs", params=params).status_code == 422


def test_a_state_is_matched_with_its_country():
    # The country comes first so job_locations_place_idx serves a state too.
    sql = str(offered_in(["US-CA", "ZZ"]).compile(compile_kwargs={"literal_binds": True}))
    assert "job_locations.country = 'US' AND job_locations.state = 'US-CA'" in sql
    assert "job_locations.country = 'ZZ'" in sql


def _country(code, name, jobs):
    return SimpleNamespace(code=code, name=name, jobs=jobs)


def _state(code, name, jobs):
    return SimpleNamespace(code=code, country=code[:2], name=name, jobs=jobs)


def test_locations_read_as_places():
    options = location_options(
        [_country("ZZ", "Other", 40), _country("US", "United States", 900)],
        [_state("US-NY", "New York", 120), _state("US-CA", "California", 300),
         _state("ZZ-ZZ", "Other", 2)],
    )
    assert [(o.code, o.label, o.jobs) for o in options] == [
        ("US", "United States", 900),
        ("US-CA", "California", 300),
        ("US-NY", "New York", 120),
        # Last whatever its count, and without its placeholder state.
        ("ZZ", "Other", 40),
    ]


def test_route_lists_locations(no_database, monkeypatch):
    async def fetch(db):
        return location_options([_country("US", "United States", 3)], [])

    monkeypatch.setattr("app.routers.jobs.fetch_location_options", fetch)
    assert TestClient(app).get("/jobs/locations").json() == [
        {"code": "US", "label": "United States", "jobs": 3}
    ]


def _sql(clause):
    return str(clause.compile(compile_kwargs={"literal_binds": True}))


def test_no_filters_add_no_clauses():
    assert matching(JobFilters()) == []


def test_route_reads_every_filter(no_database, monkeypatch):
    seen = []

    async def fetch(db, limit, filters):
        seen.append(filters)
        return []

    monkeypatch.setattr("app.routers.jobs.fetch_listings", fetch)
    params = [
        ("work_style", "remote"), ("work_style", "hybrid"),
        ("experience", "internship"),
        ("job_type", "full_time"),
        ("posted_within", "7"),
        ("min_pay", "45"), ("pay_per", "hour"),
    ]
    assert TestClient(app).get("/jobs", params=params).status_code == 200
    (filters,) = seen
    assert list(filters.work_styles) == [dto.work_style.remote, dto.work_style.hybrid]
    assert list(filters.levels) == ["internship"]
    assert list(filters.job_types) == [dto.job_type.full_time]
    # $45 an hour is a full-time year's 2,080 hours of it.
    assert filters.min_yearly_pay == 45 * 2080
    ago = datetime.datetime.now(datetime.UTC) - filters.posted_since
    assert datetime.timedelta(days=7) <= ago < datetime.timedelta(days=7, minutes=1)


def test_a_yearly_minimum_is_taken_as_given(no_database, monkeypatch):
    seen = []

    async def fetch(db, limit, filters):
        seen.append(filters.min_yearly_pay)
        return []

    monkeypatch.setattr("app.routers.jobs.fetch_listings", fetch)
    assert TestClient(app).get("/jobs?min_pay=80000").status_code == 200
    assert seen == [80000]


@pytest.mark.parametrize(
    "query",
    [
        "work_style=anywhere",
        "experience=experienced",  # the feed holds intern and new-grad roles only
        "job_type=internship",  # a career stage, not how a job is set up
        "posted_within=0",
        "min_pay=-5",
        "min_pay=45&pay_per=month",
    ],
)
def test_route_rejects_a_bad_filter(no_database, query):
    assert TestClient(app).get(f"/jobs?{query}").status_code == 422


def test_pay_compares_as_a_yearly_figure_in_dollars():
    sql = " ".join(_sql(c) for c in matching(JobFilters(min_yearly_pay=93600.0)))
    assert "job_postings.salary_currency = 'USD'" in sql
    # The top of the range first, then a single amount, then a floor alone.
    assert "coalesce(job_postings.salary_max, job_postings.salary, job_postings.salary_min)" in sql
    assert "WHEN (job_postings.salary_period = 'hour') THEN 2080" in sql
    assert "WHEN (job_postings.salary_period = 'month') THEN 12" in sql
    assert ">= 93600.0" in sql


def test_every_pay_period_has_a_yearly_factor():
    # A period added to the enum without a factor would never match a pay filter.
    assert set(YEARLY) == set(dto.salary_period)


def test_each_filter_narrows_its_own_column():
    sql = [
        _sql(c)
        for c in matching(
            JobFilters(
                work_styles=[dto.work_style.onsite],
                levels=["new_grad"],
                job_types=[dto.job_type.part_time, dto.job_type.contract],
            )
        )
    ]
    assert sql == [
        "job_postings.work_style IN ('onsite')",
        "job_postings.experience_level IN ('new_grad')",
        "job_postings.job_type IN ('part_time', 'contract')",
    ]


def test_visa_sponsors_keeps_only_stated_sponsors():
    (clause,) = matching(JobFilters(visa="sponsors"))
    assert _sql(clause) == "job_postings.sponsorship = 'sponsors'"


def test_visa_not_ruled_out_keeps_the_silent_majority():
    # Most postings say nothing about visas; hiding them would empty the feed.
    (clause,) = matching(JobFilters(visa="not_ruled_out"))
    assert _sql(clause) == (
        "job_postings.sponsorship IS NULL OR job_postings.sponsorship = 'sponsors'"
    )


def test_route_reads_seasons_and_visa(no_database, monkeypatch):
    seen = []

    async def fetch(db, limit, filters):
        seen.append(filters)
        return []

    async def terms_in(db, seasons):
        # The raw terms the feed uses for those seasons.
        assert list(seasons) == ["summer-2027", "2027"]
        return ["Summer 2027", "June 2027", "2027"]

    monkeypatch.setattr("app.routers.jobs.fetch_listings", fetch)
    monkeypatch.setattr("app.routers.jobs.terms_in", terms_in)
    params = [("start_term", "summer-2027"), ("start_term", "2027"), ("visa", "sponsors")]
    assert TestClient(app).get("/jobs", params=params).status_code == 200
    (filters,) = seen
    assert list(filters.start_terms) == ["Summer 2027", "June 2027", "2027"]
    assert filters.visa == "sponsors"
    assert _sql(matching(filters)[0]) == (
        "job_postings.start_term IN ('Summer 2027', 'June 2027', '2027')"
    )


def test_a_season_no_posting_names_matches_nothing(no_database, monkeypatch):
    seen = []

    async def fetch(db, limit, filters):
        seen.append(filters.start_terms)
        return []

    async def terms_in(db, seasons):
        return []

    monkeypatch.setattr("app.routers.jobs.fetch_listings", fetch)
    monkeypatch.setattr("app.routers.jobs.terms_in", terms_in)
    assert TestClient(app).get("/jobs?start_term=fall-2030").status_code == 200
    # An empty list, not None, which would mean "any start date".
    assert seen == [[]]
    # And it renders as an always-false clause, not a value Postgres refuses.
    sql = _sql(matching(JobFilters(start_terms=[]))[0])
    assert "\x00" not in sql and "start_term IN" in sql


def test_no_start_date_filter_adds_no_clause():
    assert matching(JobFilters(start_terms=None)) == []


@pytest.mark.parametrize("key", ["Summer 2027", "summer2027", "monsoon-2027", "27"])
def test_route_rejects_a_malformed_season(no_database, key):
    assert TestClient(app).get("/jobs", params={"start_term": key}).status_code == 422


def test_route_rejects_an_unknown_visa_option(no_database):
    assert TestClient(app).get("/jobs?visa=maybe").status_code == 422


@pytest.mark.parametrize(
    ("term", "season"),
    [
        ("Summer 2027", "summer-2027"),
        ("June 2027", "summer-2027"),
        ("January 2027", "winter-2027"),
        # December starts the next year's winter.
        ("December 2026", "winter-2027"),
        ("Autumn 2027", "fall-2027"),
        ("2027", "2027"),
        # No year: the scraper didn't guess one, and the filter doesn't either.
        ("Summer", None),
    ],
)
def test_terms_fall_into_seasons(term, season):
    assert season_of(term) == season


@pytest.mark.parametrize(
    ("key", "day", "over"),
    [
        ("winter-2027", "2027-02-28", False),
        ("winter-2027", "2027-03-01", True),
        ("fall-2026", "2026-11-30", False),
        ("fall-2026", "2026-12-01", True),
        ("2026", "2026-12-31", False),
        ("2026", "2027-01-01", True),
    ],
)
def test_a_season_is_over_once_the_next_begins(key, day, over):
    assert season_is_over(key, datetime.date.fromisoformat(day)) is over


def test_route_lists_facets(no_database, monkeypatch):
    facets = JobFacets(
        work_style=[FacetCount(value="remote", jobs=73)],
        experience=[], job_type=[], posted_within=[], visa=[], start_term=[],
    )

    async def fetch(db):
        return facets

    monkeypatch.setattr("app.routers.jobs.fetch_facets", fetch)
    body = TestClient(app).get("/jobs/facets").json()
    assert body["work_style"] == [{"value": "remote", "jobs": 73}]


def test_count_reads_the_same_filters(no_database, monkeypatch):
    seen = []

    async def count(db, filters):
        seen.append(filters)
        return 128

    monkeypatch.setattr("app.routers.jobs.fetch_count", count)
    body = TestClient(app).get("/jobs/count?work_style=remote&visa=not_ruled_out").json()
    assert body == {"jobs": 128}
    (filters,) = seen
    assert list(filters.work_styles) == [dto.work_style.remote]
    assert filters.visa == "not_ruled_out"


def test_count_rejects_what_the_list_rejects(no_database):
    assert TestClient(app).get("/jobs/count?job_type=internship").status_code == 422


def test_a_pay_range_matches_postings_whose_range_overlaps_it():
    sql = " ".join(
        _sql(c) for c in matching(JobFilters(min_yearly_pay=62400.0, max_yearly_pay=104000.0))
    )
    # The posting's top reaches the minimum...
    assert "coalesce(job_postings.salary_max, job_postings.salary, job_postings.salary_min)" in sql
    assert ">= 62400.0" in sql
    # ...and its bottom is within the maximum.
    assert "coalesce(job_postings.salary_min, job_postings.salary, job_postings.salary_max)" in sql
    assert "<= 104000.0" in sql
    # One currency clause, not one per end.
    assert sql.count("salary_currency = 'USD'") == 1


def test_route_reads_a_pay_range(no_database, monkeypatch):
    seen = []

    async def fetch(db, limit, filters):
        seen.append((filters.min_yearly_pay, filters.max_yearly_pay))
        return []

    monkeypatch.setattr("app.routers.jobs.fetch_listings", fetch)
    assert TestClient(app).get("/jobs?min_pay=30&max_pay=50&pay_per=hour").status_code == 200
    assert TestClient(app).get("/jobs?max_pay=90000").status_code == 200
    assert seen == [(30 * 2080, 50 * 2080), (None, 90000)]


def test_a_backwards_pay_range_is_the_range_meant(no_database, monkeypatch):
    seen = []

    async def count(db, filters):
        seen.append((filters.min_yearly_pay, filters.max_yearly_pay))
        return 0

    monkeypatch.setattr("app.routers.jobs.fetch_count", count)
    assert TestClient(app).get("/jobs/count?min_pay=100000&max_pay=50000").status_code == 200
    assert seen == [(50000, 100000)]
