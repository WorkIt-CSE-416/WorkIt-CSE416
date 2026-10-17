"""Saved job preferences: the schema's rules and GET/PUT /applicants/{id}/preferences."""

import uuid
from decimal import Decimal
from types import SimpleNamespace

import httpx
import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError
from sqlalchemy import text
from sqlalchemy.dialects import postgresql

from app.db import get_session
from app.deps import get_current_account
from app.main import app
from app.schemas.auth import AccountType, AuthenticatedAccount
from app.schemas.preferences import JobPreferences

APPLICANT = uuid.uuid4()
URL = f"/applicants/{APPLICANT}/preferences"


class FakeSession:
    def __init__(self):
        self.found = None  # the GET's one row: (preferences, roles, places)
        self.known = []  # what a scalars() select finds: slugs and place codes
        self.statements = []  # every statement execute() ran
        self.commits = 0
        self.rollbacks = 0
        self.fail_on_commit = False

    async def scalars(self, _stmt):
        return SimpleNamespace(all=lambda: self.known)

    async def execute(self, stmt, params=None):
        self.statements.append((stmt, params))
        return SimpleNamespace(one_or_none=lambda: self.found)

    async def commit(self):
        if self.fail_on_commit:
            raise RuntimeError("database down")
        self.commits += 1

    async def rollback(self):
        self.rollbacks += 1

    def sql(self):
        return [
            str(stmt.compile(dialect=postgresql.dialect())) for stmt, _ in self.statements
        ]


@pytest.fixture
def client():
    session = FakeSession()
    app.dependency_overrides[get_current_account] = lambda: AuthenticatedAccount(
        id=APPLICANT,
        email="a@example.com",
        full_name="A",
        account_type=AccountType.APPLICANT,
        onboarding_completed=False,
    )
    app.dependency_overrides[get_session] = lambda: session
    yield TestClient(app), session
    app.dependency_overrides.clear()


BODY = {
    "location": ["US-CA", "US"],
    "work_style": ["remote", "hybrid"],
    "role": ["software_engineer", "data_scientist"],
    "experience": ["new_grad"],
    "job_type": ["full_time", "internship"],
    "min_pay": 100000,
    "pay_per": "year",
    "visa": "sponsors",
}


# The schema ------------------------------------------------------------------


def test_preferences_tidy_duplicates_and_a_backwards_range():
    prefs = JobPreferences(
        role=["software_engineer", "software_engineer"], min_pay=120, max_pay=80
    )
    assert prefs.role == ["software_engineer"]
    assert (prefs.min_pay, prefs.max_pay) == (Decimal(80), Decimal(120))


@pytest.mark.parametrize(
    "bad",
    [
        {"location": ["California"]},  # not a place code
        {"role": ["Software Engineer"]},  # not a slug
        {"location": ["US"] * 61},  # over GET /jobs' cap
        {"job_type": ["temp"]},
        {"experience": ["internship"]},  # a job type since KAN-233, not a level
        {"min_pay": 0},
        {"posted_within": 7},  # Date Posted is never saved
    ],
)
def test_preferences_refuse_what_get_jobs_would_refuse(bad):
    with pytest.raises(ValidationError):
        JobPreferences(**bad)


# The routes -------------------------------------------------------------------


def test_put_is_refused_for_another_applicant(client):
    http, session = client
    res = http.put(f"/applicants/{uuid.uuid4()}/preferences", json=BODY)
    assert res.status_code == 403
    assert session.statements == [] and session.commits == 0


KNOWN = BODY["role"] + ["US", "US-CA"]


@pytest.mark.parametrize(("known", "named"), [
    (["software_engineer", "US", "US-CA"], "data_scientist"),
    (BODY["role"] + ["US"], "US-CA"),  # a state the states table lacks
])
def test_put_names_an_unknown_role_or_place_and_writes_nothing(client, known, named):
    http, session = client
    session.known = known
    res = http.put(URL, json=BODY)
    assert res.status_code == 422
    assert named in res.json()["detail"]
    assert session.statements == [] and session.commits == 0


def test_put_saves_everything_in_one_transaction_and_stamps_onboarding(client):
    http, session = client
    session.known = KNOWN
    res = http.put(URL, json=BODY)
    assert res.status_code == 200
    assert res.json()["role"] == BODY["role"]
    assert session.commits == 1
    upsert, clear_roles, roles, clear_places, places, stamp = session.sql()
    assert "ON CONFLICT (applicant_id) DO UPDATE" in upsert
    assert clear_roles.startswith("DELETE FROM applicant_job_roles")
    assert roles.startswith("INSERT INTO applicant_job_roles")
    assert [row["role_slug"] for row in session.statements[2][1]] == BODY["role"]
    assert clear_places.startswith("DELETE FROM applicant_locations")
    assert places.startswith("INSERT INTO applicant_locations")
    # A state is its country plus the state's code, as job_locations holds it.
    assert [(r["country"], r["state"]) for r in session.statements[4][1]] == [
        ("US", "US-CA"), ("US", None),
    ]
    # Only a profile not yet onboarded is stamped, so the first date stays.
    assert "onboarding_completed_at IS NULL" in stamp


def test_put_with_no_roles_or_places_clears_them_without_an_empty_insert(client):
    http, session = client
    res = http.put(URL, json={**BODY, "role": [], "location": []})
    assert res.status_code == 200
    assert len(session.statements) == 4  # upsert, two clears, stamp


def test_put_rolls_back_when_the_commit_fails(client):
    http, session = client
    session.known = KNOWN
    session.fail_on_commit = True
    res = http.put(URL, json=BODY)
    assert res.status_code == 500
    assert session.rollbacks == 1


def test_get_answers_empty_preferences_when_none_are_saved(client):
    http, _ = client
    res = http.get(URL)
    assert res.status_code == 200
    assert res.json() == JobPreferences().model_dump(mode="json")


def test_get_maps_the_saved_row_back_to_query_names(client):
    http, session = client
    row = SimpleNamespace(
        work_styles=["remote"],
        levels=["new_grad"],
        job_types=["full_time"],
        start_terms=[],
        min_pay=Decimal("45.00"),
        max_pay=None,
        pay_per="hour",
        visa=None,
    )
    session.found = (row, ["software_engineer"], ["US-CA"])
    res = http.get(URL)
    assert res.status_code == 200
    body = res.json()
    assert body["location"] == ["US-CA"]
    assert body["work_style"] == ["remote"]
    assert body["role"] == ["software_engineer"]
    assert body["pay_per"] == "hour"
    assert body["min_pay"] == 45  # a number, not "45.00"


# Against real Postgres ---------------------------------------------------------


@pytest.mark.anyio
async def test_a_save_reads_back_whole_in_one_query(database):
    # The GET's ARRAY(subquery) reads and the place rows' foreign keys only
    # prove themselves on Postgres (backend/CLAUDE.md, Tests).
    async with database() as session:
        await session.execute(text("INSERT INTO auth.users (id) VALUES (:id)"), {"id": APPLICANT})
        await session.execute(
            text("INSERT INTO applicant_profiles (id, email, full_name)"
                 " VALUES (:id, 'a@example.com', 'A')"),
            {"id": APPLICANT},
        )
        await session.commit()

    app.dependency_overrides[get_current_account] = lambda: AuthenticatedAccount(
        id=APPLICANT, email="a@example.com", full_name="A",
        account_type=AccountType.APPLICANT, onboarding_completed=False,
    )
    try:
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
            empty = await client.get(URL)
            saved = await client.put(URL, json={**BODY, "role": ["software_engineer"]})
            again = await client.put(URL, json={**BODY, "location": ["US-NY"], "role": []})
            res = await client.get(URL)
    finally:
        app.dependency_overrides.pop(get_current_account, None)

    assert empty.json() == JobPreferences().model_dump(mode="json")
    assert saved.status_code == again.status_code == 200
    body = res.json()
    # The second save replaced the first's places and roles.
    assert (body["location"], body["role"]) == (["US-NY"], [])
    assert body["experience"] == ["new_grad"] and body["min_pay"] == 100000
    async with database() as session:
        stamped = await session.scalar(text(
            "SELECT onboarding_completed_at IS NOT NULL FROM applicant_profiles WHERE id = :id"
        ), {"id": APPLICANT})
    assert stamped
