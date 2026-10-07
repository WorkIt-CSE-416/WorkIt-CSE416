"""Tests for the part of the feed import that needs no database: turning feed
rows into job_postings rows and places. The database half (upsert, location
sync, closing) needs Postgres; app/scripts/import_jobs.py's docstring says
what it does."""
import datetime

import pytest

from app.models import dto
from app.schemas.jobs import JobListing
from app.scripts.import_jobs import parse_posted_at, prepare
from app.services.location_resolver import LocationResolver, Place
from tests.test_location_resolver import US_STATES


@pytest.fixture(scope="module")
def resolver():
    return LocationResolver({"US", "ZZ"}, US_STATES)


def listing(url, location="Austin, TX", **overrides):
    fields = {
        "id": url, "title": "SWE Intern", "company": "Acme", "apply_url": url,
        "experience_level": "internship", "work_style": "onsite", "location": location,
        "posted_at": "2026-10-06T02:42:06+00:00", "logo_url": None,
    }
    return JobListing(**{**fields, **overrides})


def test_row_shape(resolver):
    prepared = prepare([listing("https://x/1")], resolver)
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
    }]
    assert prepared.places == {"https://x/1": (Place("US", "US-TX"),)}


def test_description_is_kept(resolver):
    prepared = prepare([listing("https://x/1", description="Build things.")], resolver)
    assert prepared.rows[0]["description"] == "Build things."


def test_first_of_a_duplicate_url_wins(resolver):
    prepared = prepare([listing("https://x/1", title="Newer"), listing("https://x/1", title="Older")], resolver)
    assert [r["title"] for r in prepared.rows] == ["Newer"]
    assert prepared.duplicates == 1


def test_places_and_misses(resolver):
    prepared = prepare([
        listing("https://x/1", "San Francisco, CA • New York, NY"),
        listing("https://x/2", "Remote"),
        listing("https://x/3", "RWC HQ"),
        listing("https://x/4", None),
    ], resolver)
    assert prepared.places["https://x/1"] == (Place("US", "US-CA"), Place("US", "US-NY"))
    assert prepared.no_place == 3
    # Only the string that named something unknown is worth logging.
    assert prepared.unresolved == {"RWC HQ": ("RWC HQ",)}


def test_each_location_resolved_once(resolver, monkeypatch):
    calls = []
    real = resolver.resolve
    monkeypatch.setattr(resolver, "resolve", lambda text: calls.append(text) or real(text))
    prepare([listing(f"https://x/{i}", "Austin, TX") for i in range(5)], resolver)
    assert calls == ["Austin, TX"]


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
