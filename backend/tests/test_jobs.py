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
from app.routers.jobs import location_options, offered_in, to_listing
from app.schemas.jobs import JobListing

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
    async def fetch(db, limit, places, *filters):
        return [to_listing(ROW, "long text")]

    monkeypatch.setattr("app.routers.jobs.fetch_listings", fetch)
    rows = TestClient(app).get("/jobs").json()
    assert rows[0]["title"] == "Robot Software Intern"
    assert "description" not in rows[0]


def test_route_passes_the_limit(no_database, monkeypatch):
    seen = []

    async def fetch(db, limit, places, *filters):
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

    async def fetch(db, limit, places, *filters):
        seen.append(places)
        return []

    monkeypatch.setattr("app.routers.jobs.fetch_listings", fetch)
    client = TestClient(app)
    assert client.get("/jobs").status_code == 200
    assert client.get("/jobs?location=US-CA&location=US").status_code == 200
    assert seen == [[], ["US-CA", "US"]]


@pytest.mark.parametrize("code", ["us", "California", "US-", "USA", "US-CA;"])
def test_route_rejects_a_malformed_place(no_database, code):
    assert TestClient(app).get("/jobs", params={"location": code}).status_code == 422


def test_route_passes_the_other_filters(no_database, monkeypatch):
    seen = []

    async def fetch(db, limit, places, workplaces, levels, posted):
        seen.append((workplaces, levels, posted))
        return []

    monkeypatch.setattr("app.routers.jobs.fetch_listings", fetch)
    client = TestClient(app)
    assert client.get("/jobs").status_code == 200
    query = "?workplace=remote&workplace=hybrid&experience=new_grad&posted=week"
    assert client.get("/jobs" + query).status_code == 200
    assert seen == [([], [], None), (["remote", "hybrid"], ["new_grad"], "week")]


@pytest.mark.parametrize("param", ["workplace=Remote", "experience=senior", "posted=year"])
def test_route_rejects_an_unknown_filter_value(no_database, param):
    assert TestClient(app).get("/jobs?" + param).status_code == 422


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
