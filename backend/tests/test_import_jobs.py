"""Tests for the part of the feed import that needs no database: turning feed
rows into job_postings rows, places and roles. The database half (upsert,
location and role sync, closing) needs Postgres; app/scripts/import_jobs.py's
docstring says what it does."""
import datetime

import pytest

from app.models import dto
from app.schemas.jobs import JobListing
from app.scripts.import_jobs import parse_posted_at, prepare
from app.services.location_resolver import LocationResolver, Place
from app.services.role_resolver import RoleResolver
from tests.test_location_resolver import US_STATES
from tests.test_role_resolver import ROLES


@pytest.fixture(scope="module")
def resolver():
    return LocationResolver({"US", "ZZ"}, US_STATES)


@pytest.fixture(scope="module")
def roles():
    return RoleResolver(ROLES)


def listing(url, location="Austin, TX", **overrides):
    fields = {
        "id": url, "title": "SWE Intern", "company": "Acme", "apply_url": url,
        "experience_level": "internship", "work_style": "onsite", "location": location,
        "posted_at": "2026-10-06T02:42:06+00:00", "logo_url": None,
    }
    return JobListing(**{**fields, **overrides})


def test_row_shape(resolver, roles):
    prepared = prepare([listing("https://x/1")], resolver, roles)
    assert prepared.rows == [{
        "apply_url": "https://x/1",
        "title": "SWE Intern",
        "company_name": "Acme",
        "company_logo_url": None,
        "description": None,
        "experience_level": dto.experience_level.internship,
        "work_style": dto.work_style.onsite,
        "location_raw": "Austin, TX",
        "posted_at": datetime.datetime(2026, 10, 6, 2, 42, 6, tzinfo=datetime.UTC),
        "status": dto.job_post_status.published,
        "job_type": None,
        "min_years_experience": None,
        "start_term": None,
        # No pay stated: the NOT NULL columns keep their defaults, amounts empty.
        "salary": None,
        "salary_min": None,
        "salary_max": None,
        "salary_currency": "USD",
        "salary_period": dto.salary_period.year,
    }]
    assert prepared.places == {"https://x/1": (Place("US", "US-TX"),)}


def test_card_facts_are_kept(resolver, roles):
    # Strada's internship: "$7.5K per month".
    prepared = prepare([listing(
        "https://x/1", job_type="full_time", start_term="Summer 2027", min_years_experience=1,
        salary=7500, salary_currency="USD", salary_period="month",
    )], resolver, roles)
    row = prepared.rows[0]
    assert (row["job_type"], row["start_term"], row["min_years_experience"]) == (
        dto.job_type.full_time, "Summer 2027", 1)
    assert (row["salary"], row["salary_currency"], row["salary_period"]) == (
        7500, "USD", dto.salary_period.month)


def test_description_is_kept(resolver, roles):
    prepared = prepare([listing("https://x/1", description="Build things.")], resolver, roles)
    assert prepared.rows[0]["description"] == "Build things."


def test_first_of_a_duplicate_url_wins(resolver, roles):
    prepared = prepare([listing("https://x/1", title="Newer"), listing("https://x/1", title="Older")], resolver, roles)
    assert [r["title"] for r in prepared.rows] == ["Newer"]
    assert prepared.duplicates == 1


def test_places_and_misses(resolver, roles):
    prepared = prepare([
        listing("https://x/1", "San Francisco, CA • New York, NY"),
        listing("https://x/2", "Remote"),
        listing("https://x/3", "RWC HQ"),
        listing("https://x/4", None),
    ], resolver, roles)
    assert prepared.places["https://x/1"] == (Place("US", "US-CA"), Place("US", "US-NY"))
    assert prepared.no_place == 3
    # Only the string that named something unknown is worth logging.
    assert prepared.unresolved == {"RWC HQ": ("RWC HQ",)}


def test_each_location_resolved_once(resolver, roles, monkeypatch):
    calls = []
    real = resolver.resolve
    monkeypatch.setattr(resolver, "resolve", lambda text: calls.append(text) or real(text))
    prepare([listing(f"https://x/{i}", "Austin, TX") for i in range(5)], resolver, roles)
    assert calls == ["Austin, TX"]


def test_roles_and_untagged_titles(resolver, roles):
    prepared = prepare([
        listing("https://x/1", title="Software Engineer (Machine Learning) Intern"),
        listing("https://x/2", title="AI Labs Intern"),
        listing("https://x/3", title="AI Labs Intern"),
    ], resolver, roles)
    assert prepared.roles == {
        "https://x/1": {"software_engineer", "ai_ml_engineer"},
        "https://x/2": set(),
        "https://x/3": set(),
    }
    # Counted per title, so the report can put the commonest misses first.
    assert prepared.untagged == {"AI Labs Intern": 2}


def test_each_title_resolved_once(resolver, roles, monkeypatch):
    calls = []
    real = roles.resolve
    monkeypatch.setattr(roles, "resolve", lambda title: calls.append(title) or real(title))
    prepare([listing(f"https://x/{i}", title="SWE Intern") for i in range(5)], resolver, roles)
    assert calls == ["SWE Intern"]


def test_a_duplicate_url_takes_the_first_title_s_roles(resolver, roles):
    prepared = prepare([
        listing("https://x/1", title="Data Engineer Intern"),
        listing("https://x/1", title="Recruiter"),
    ], resolver, roles)
    assert prepared.roles == {"https://x/1": {"data_engineer"}}


@pytest.mark.parametrize(("value", "expected"), [
    ("2026-10-06T02:42:06+00:00", datetime.datetime(2026, 10, 6, 2, 42, 6, tzinfo=datetime.UTC)),
    ("2026-10-06T02:42:06Z", datetime.datetime(2026, 10, 6, 2, 42, 6, tzinfo=datetime.UTC)),
    ("2026-10-06T02:42:06", datetime.datetime(2026, 10, 6, 2, 42, 6, tzinfo=datetime.UTC)),
    ("yesterday", None),
    (None, None),
    ("", None),
])
def test_parse_posted_at(value, expected):
    assert parse_posted_at(value) == expected
