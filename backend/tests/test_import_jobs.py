"""Tests for the part of the feed import that needs no database: turning feed
rows into job_postings rows (the scraper's role keys among them), places and
job_role_tags slugs. The database half (upsert,
location and role sync, closing) needs Postgres; app/scripts/import_jobs.py's
docstring says what it does."""
import datetime

import pytest
from pydantic import ValidationError

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
def role_resolver():
    return RoleResolver(ROLES)


def listing(url, location="Austin, TX", **overrides):
    fields = {
        "id": url, "title": "SWE Intern", "company": "Acme", "apply_url": url,
        "experience_level": "student", "job_type": "internship", "work_style": "onsite",
        "location": location,
        "posted_at": "2026-10-06T02:42:06+00:00", "logo_url": None,
    }
    return JobListing(**{**fields, **overrides})


def test_row_shape(resolver, role_resolver):
    prepared = prepare([listing("https://x/1")], resolver, role_resolver)
    assert prepared.rows == [{
        "apply_url": "https://x/1",
        "title": "SWE Intern",
        "company_name": "Acme",
        "company_logo_url": None,
        "company_domain": None,
        "description": None,
        "experience_level": dto.experience_level.student,
        "work_style": dto.work_style.onsite,
        "location_raw": "Austin, TX",
        "location_label": "Austin, TX",
        "posted_at": datetime.datetime(2026, 10, 6, 2, 42, 6, tzinfo=datetime.UTC),
        "status": dto.job_post_status.published,
        "job_type": dto.job_type.internship,
        "min_years_experience": None,
        "start_term": None,
        "sponsorship": None,
        # No pay stated: the NOT NULL columns keep their defaults, amounts empty.
        "salary": None,
        "salary_min": None,
        "salary_max": None,
        "salary_currency": "USD",
        "salary_period": dto.salary_period.year,
    }]
    assert prepared.places == {"https://x/1": (Place("US", "US-TX"),)}


def test_card_facts_are_kept(resolver, role_resolver):
    # Strada's internship: "$7.5K per month".
    prepared = prepare([listing(
        "https://x/1", start_term="Summer 2027", min_years_experience=1,
        salary=7500, salary_currency="USD", salary_period="month",
    )], resolver, role_resolver)
    row = prepared.rows[0]
    assert (row["job_type"], row["start_term"], row["min_years_experience"]) == (
        dto.job_type.internship, "Summer 2027", 1)
    assert (row["salary"], row["salary_currency"], row["salary_period"]) == (
        7500, "USD", dto.salary_period.month)


def test_sponsorship_is_kept(resolver, role_resolver):
    # The scraper's reading of the posting's visa lines (details.py).
    prepared = prepare([listing("https://x/1", sponsorship="citizens_only")], resolver, role_resolver)
    assert prepared.rows[0]["sponsorship"] == dto.visa_sponsorship.citizens_only


def test_the_scraper_s_role_keys_are_ignored(resolver, role_resolver):
    # feed.json still carries KAN-172's keys, and older feeds role_category.
    # A job's roles are job_role_tags, resolved from its title (KAN-155), so
    # the keys are dropped like any undeclared field: a key the backend never
    # heard of no longer fails the import, and no row writes them.
    job = listing(
        "https://x/1", title="Data Engineer Intern",
        roles=["data_ai", "software", "legal"], role_category="hardware",
    )
    prepared = prepare([job], resolver, role_resolver)
    assert "roles" not in prepared.rows[0] and "role_category" not in prepared.rows[0]
    assert prepared.role_tags == {"https://x/1": {"data_engineer"}}


def test_description_is_kept(resolver, role_resolver):
    prepared = prepare([listing("https://x/1", description="Build things.")], resolver, role_resolver)
    assert prepared.rows[0]["description"] == "Build things."


def test_first_of_a_duplicate_url_wins(resolver, role_resolver):
    prepared = prepare([listing("https://x/1", title="Newer"), listing("https://x/1", title="Older")], resolver, role_resolver)
    assert [r["title"] for r in prepared.rows] == ["Newer"]
    assert prepared.duplicates == 1


def test_places_and_misses(resolver, role_resolver):
    prepared = prepare([
        listing("https://x/1", "San Francisco, CA • New York, NY"),
        listing("https://x/2", "Remote"),
        listing("https://x/3", "RWC HQ"),
        listing("https://x/4", None),
    ], resolver, role_resolver)
    assert prepared.places["https://x/1"] == (Place("US", "US-CA"), Place("US", "US-NY"))
    assert prepared.no_place == 3
    # Only the string that named something unknown is worth logging.
    assert prepared.unresolved == {"RWC HQ": ("RWC HQ",)}


def test_each_location_resolved_once(resolver, role_resolver, monkeypatch):
    calls = []
    real = resolver.resolve
    monkeypatch.setattr(resolver, "resolve", lambda text: calls.append(text) or real(text))
    prepare([listing(f"https://x/{i}", "Austin, TX") for i in range(5)], resolver, role_resolver)
    assert calls == ["Austin, TX"]


def test_roles_and_untagged_titles(resolver, role_resolver):
    prepared = prepare([
        listing("https://x/1", title="Software Engineer (Machine Learning) Intern"),
        listing("https://x/2", title="AI Labs Intern"),
        listing("https://x/3", title="AI Labs Intern"),
    ], resolver, role_resolver)
    assert prepared.role_tags == {
        "https://x/1": {"software_engineer", "ai_ml_engineer"},
        "https://x/2": set(),
        "https://x/3": set(),
    }
    # Counted per title, so the report can put the commonest misses first.
    assert prepared.untagged == {"AI Labs Intern": 2}


def test_each_title_resolved_once(resolver, role_resolver, monkeypatch):
    calls = []
    real = role_resolver.resolve
    monkeypatch.setattr(role_resolver, "resolve", lambda title: calls.append(title) or real(title))
    prepare([listing(f"https://x/{i}", title="SWE Intern") for i in range(5)], resolver, role_resolver)
    assert calls == ["SWE Intern"]


def test_a_duplicate_url_takes_the_first_title_s_roles(resolver, role_resolver):
    prepared = prepare([
        listing("https://x/1", title="Data Engineer Intern"),
        listing("https://x/1", title="Recruiter"),
    ], resolver, role_resolver)
    assert prepared.role_tags == {"https://x/1": {"data_engineer"}}


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


def test_a_feed_from_before_kan_233_is_refused():
    # An internship as the level is what the old scraper wrote. The import
    # takes the new values only, so an old feed fails loudly rather than
    # writing a value migration B is about to remove.
    with pytest.raises(ValidationError):
        listing("https://x/1", experience_level="internship")


def test_company_domain_is_carried_to_its_column(resolver, role_resolver):
    # KAN-442: the scraper's website for the logo, written as the feed gives it.
    prepared = prepare(
        [listing("https://x/1", company_domain="goldmansachs.com")], resolver, role_resolver
    )
    assert prepared.rows[0]["company_domain"] == "goldmansachs.com"
