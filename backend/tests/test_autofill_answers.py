"""
The answer bank (KAN-283): GET and PATCH /applicants/{id}/autofill-answers.
A PATCH writes only the keys it sends, a null clears one, and an option the
schema doesn't offer is refused. Runs against real Postgres (backend/CLAUDE.md,
"Tests against real Postgres"), since the merge is SQL.
"""

import uuid

import httpx
import pytest
from sqlalchemy import text

from app.deps import get_current_account
from app.main import app
from app.schemas.auth import AccountType, AuthenticatedAccount

pytestmark = pytest.mark.anyio


async def _seed_applicant(database, applicant_id: uuid.UUID) -> None:
    async with database() as session:
        await session.execute(text("INSERT INTO auth.users (id) VALUES (:id)"), {"id": applicant_id})
        await session.execute(
            text(
                "INSERT INTO applicant_profiles (id, email, full_name)"
                " VALUES (:id, 'sam@example.com', 'Sam Seeker')"
            ),
            {"id": applicant_id},
        )
        await session.commit()


@pytest.fixture
async def client(database):
    applicant_id = uuid.uuid4()
    await _seed_applicant(database, applicant_id)
    app.dependency_overrides[get_current_account] = lambda: AuthenticatedAccount(
        id=applicant_id,
        email="sam@example.com",
        full_name="Sam Seeker",
        account_type=AccountType.APPLICANT,
        onboarding_completed=False,
    )
    try:
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as c:
            c.url_for = f"/applicants/{applicant_id}/autofill-answers"
            yield c
    finally:
        app.dependency_overrides.pop(get_current_account, None)


async def test_nothing_saved_reads_as_every_answer_empty(client):
    res = await client.get(client.url_for)
    assert res.status_code == 200
    assert set(res.json().values()) == {None}


async def test_a_patch_writes_only_the_keys_it_sends(client):
    await client.patch(client.url_for, json={"needs_sponsorship": "yes", "veteran_status": "declined"})
    res = await client.patch(client.url_for, json={"work_authorized_us": "yes", "gender": "non_binary"})
    assert res.status_code == 200
    body = res.json()
    # The first PATCH's keys are kept: a write never replaces the bank whole.
    assert body["needs_sponsorship"] == "yes"
    assert body["veteran_status"] == "declined"
    assert body["work_authorized_us"] == "yes"
    assert body["gender"] == "non_binary"
    assert (await client.get(client.url_for)).json() == body


async def test_ethnicity_and_race_are_saved_and_read_back(client):
    res = await client.patch(
        client.url_for, json={"hispanic_latino": "no", "race": "two_or_more"}
    )
    assert res.status_code == 200
    assert res.json()["hispanic_latino"] == "no"
    assert res.json()["race"] == "two_or_more"
    body = (await client.get(client.url_for)).json()
    assert (body["hispanic_latino"], body["race"]) == ("no", "two_or_more")


async def test_null_clears_a_key(client):
    await client.patch(client.url_for, json={"security_clearance": "secret", "disability_status": "no"})
    res = await client.patch(client.url_for, json={"security_clearance": None})
    assert res.json()["security_clearance"] is None
    assert res.json()["disability_status"] == "no"


async def test_the_stored_bank_holds_each_answer_alone(client, database):
    await client.patch(client.url_for, json={"work_authorization_status": "f1_student"})
    async with database() as session:
        bank = await session.scalar(text("SELECT answers FROM autofill_answers"))
    assert bank == {"work_authorization_status": "f1_student"}


@pytest.mark.parametrize(
    "body",
    [
        {"veteran_status": "maybe"},
        {"gender": "other"},
        {"hispanic_latino": "maybe"},
        # Hispanic or Latino is its own question, never a race (KAN-299).
        {"race": "hispanic_latino"},
        {"favourite_colour": "blue"},
        {"needs_sponsorship": True},
    ],
)
async def test_an_option_or_key_it_doesnt_offer_is_refused(client, body):
    res = await client.patch(client.url_for, json=body)
    assert res.status_code == 422


async def test_another_applicants_bank_is_forbidden(client):
    res = await client.get(f"/applicants/{uuid.uuid4()}/autofill-answers")
    assert res.status_code == 403


async def test_a_failed_save_logs_no_answer(database, caplog):
    # An applicant with no profile row: the insert fails on its foreign key,
    # as any database error would. SQLAlchemy's error text carries the
    # statement's values, so without hide_parameters (app/db.py) the log
    # held the student's self-identification answers.
    applicant_id = uuid.uuid4()
    app.dependency_overrides[get_current_account] = lambda: AuthenticatedAccount(
        id=applicant_id,
        email="sam@example.com",
        full_name="Sam Seeker",
        account_type=AccountType.APPLICANT,
        onboarding_completed=False,
    )
    try:
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as c:
            res = await c.patch(
                f"/applicants/{applicant_id}/autofill-answers",
                json={"gender": "non_binary", "disability_status": "yes"},
            )
    finally:
        app.dependency_overrides.pop(get_current_account, None)

    assert res.status_code == 500
    assert "Saving autofill answers failed" in caplog.text
    assert "non_binary" not in caplog.text
    assert "disability_status" not in caplog.text


async def test_application_answers_are_saved_and_read_back(client):
    body = {
        "full_time_40h": "yes",
        "earliest_start": "2027-05-24",
        "available_terms": ["summer 2027", "fall 2027"],
        "willing_to_relocate": "no",
        "postal_code": "00000",
        "referred_at": [],
        "prior_government_work": "no",
    }
    res = await client.patch(client.url_for, json=body)
    assert res.status_code == 200
    saved = res.json()
    assert {key: saved[key] for key in body} == body
    assert saved["relatives_at"] is None


@pytest.mark.parametrize(
    "body",
    [
        {"earliest_start": "next May"},
        {"available_terms": ["someday"]},
        {"onsite_ok": "sometimes"},
        {"relatives_at": "none"},
    ],
)
async def test_an_application_answer_of_the_wrong_shape_is_refused(client, body):
    res = await client.patch(client.url_for, json=body)
    assert res.status_code == 422
