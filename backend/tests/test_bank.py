"""
Seam-1 tests for the experience bank (KAN-206): entries, bullets and skills
through the API on real Postgres, the ownership check, the duplicate check,
and the clearing of the bank embedding. backend/CLAUDE.md's Tests section
has the setup.
"""

import uuid

import httpx
import pytest
from sqlalchemy import text

from app.deps import get_current_account
from app.main import app
from app.schemas.auth import AccountType, AuthenticatedAccount

pytestmark = pytest.mark.anyio


async def _seed_applicant(session) -> uuid.UUID:
    applicant_id = uuid.uuid4()
    await session.execute(text("INSERT INTO auth.users (id) VALUES (:id)"), {"id": applicant_id})
    await session.execute(
        text(
            "INSERT INTO applicant_profiles (id, email, full_name)"
            " VALUES (:id, :email, 'Sam Seeker')"
        ),
        {"id": applicant_id, "email": f"{applicant_id.hex[:8]}@example.com"},
    )
    await session.commit()
    return applicant_id


def _sign_in(applicant_id: uuid.UUID) -> None:
    app.dependency_overrides[get_current_account] = lambda: AuthenticatedAccount(
        id=applicant_id,
        email="sam@example.com",
        full_name="Sam Seeker",
        account_type=AccountType.APPLICANT,
        onboarding_completed=True,
    )


@pytest.fixture
async def student(database):
    """A signed-in applicant and an API client. Yields (client, bank URL)."""
    async with database() as session:
        applicant_id = await _seed_applicant(session)
    _sign_in(applicant_id)
    transport = httpx.ASGITransport(app=app)
    try:
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
            yield client, f"/applicants/{applicant_id}/bank"
    finally:
        app.dependency_overrides.pop(get_current_account, None)


async def test_an_entry_with_only_a_section_and_title_is_read_back(student):
    client, bank = student
    res = await client.post(f"{bank}/entries", json={"section": "projects", "title": "WorkIt"})
    assert res.status_code == 201
    assert res.json()["title"] == "WorkIt"

    res = await client.get(bank)
    assert res.status_code == 200
    entries = res.json()["entries"]
    assert [(e["section"], e["title"], e["bullets"]) for e in entries] == [("projects", "WorkIt", [])]
    assert res.json()["skills"] == []


async def test_another_students_bank_is_forbidden(student, database):
    client, _ = student
    async with database() as session:
        other = await _seed_applicant(session)
    other_bank = f"/applicants/{other}/bank"

    assert (await client.get(other_bank)).status_code == 403
    res = await client.post(f"{other_bank}/entries", json={"section": "projects", "title": "X"})
    assert res.status_code == 403
    assert (await client.post(f"{other_bank}/skills", json={"name": "Go"})).status_code == 403


async def test_another_students_rows_are_not_found_through_my_bank(student, database):
    client, bank = student
    async with database() as session:
        other = await _seed_applicant(session)

    # The other student makes an entry, a bullet and a skill...
    _sign_in(other)
    other_bank = f"/applicants/{other}/bank"
    entry = (await client.post(f"{other_bank}/entries", json={"section": "projects", "title": "Theirs", "bullets": ["Built it"]})).json()
    skill = (await client.post(f"{other_bank}/skills", json={"name": "Rust"})).json()
    bullet_id = entry["bullets"][0]["id"]

    # ...and the first student cannot reach any of them by id.
    _sign_in(uuid.UUID(bank.split("/")[2]))
    assert (await client.patch(f"{bank}/entries/{entry['id']}", json={"title": "Mine"})).status_code == 404
    assert (await client.delete(f"{bank}/entries/{entry['id']}")).status_code == 404
    assert (await client.post(f"{bank}/entries/{entry['id']}/bullets", json={"text": "x"})).status_code == 404
    assert (await client.patch(f"{bank}/bullets/{bullet_id}", json={"text": "x"})).status_code == 404
    assert (await client.delete(f"{bank}/bullets/{bullet_id}")).status_code == 404
    assert (await client.patch(f"{bank}/skills/{skill['id']}", json={"name": "Go"})).status_code == 404
    assert (await client.delete(f"{bank}/skills/{skill['id']}")).status_code == 404

    _sign_in(other)
    theirs = (await client.get(other_bank)).json()
    assert [(e["title"], [b["text"] for b in e["bullets"]]) for e in theirs["entries"]] == [("Theirs", ["Built it"])]
    assert [s["name"] for s in theirs["skills"]] == ["Rust"]


async def test_a_duplicate_entry_is_flagged_ignoring_case_and_saved_on_request(student):
    client, bank = student
    first = {"section": "experience", "title": "Software Intern", "organization": "Acme"}
    assert (await client.post(f"{bank}/entries", json=first)).status_code == 201

    same = {"section": "experience", "title": "software intern ", "organization": "ACME"}
    res = await client.post(f"{bank}/entries", json=same)
    assert res.status_code == 409
    assert res.json()["duplicate"]["title"] == "Software Intern"

    # "Save as new": two real roles with the same title both stay.
    res = await client.post(f"{bank}/entries", params={"allow_duplicate": "true"}, json=same)
    assert res.status_code == 201
    assert len((await client.get(bank)).json()["entries"]) == 2


async def test_a_different_section_or_organization_is_not_a_duplicate(student):
    client, bank = student
    base = {"section": "experience", "title": "Software Intern", "organization": "Acme"}
    assert (await client.post(f"{bank}/entries", json=base)).status_code == 201
    for other in (
        {**base, "section": "leadership"},
        {**base, "organization": "Globex"},
        {"section": "experience", "title": "Software Intern"},
    ):
        assert (await client.post(f"{bank}/entries", json=other)).status_code == 201, other
    # No organization matches no organization.
    res = await client.post(f"{bank}/entries", json={"section": "experience", "title": "SOFTWARE INTERN"})
    assert res.status_code == 409


async def _mark_embedded(database, applicant_id: uuid.UUID) -> None:
    vector = "[" + ",".join(["0.1"] * 768) + "]"
    async with database() as session:
        await session.execute(
            text(
                "INSERT INTO experience_banks (applicant_id, embedding, embedded_at)"
                " VALUES (:id, CAST(:v AS extensions.vector), now())"
                " ON CONFLICT (applicant_id) DO UPDATE"
                " SET embedding = excluded.embedding, embedded_at = excluded.embedded_at"
            ),
            {"id": applicant_id, "v": vector},
        )
        await session.commit()


async def _is_embedded(database, applicant_id: uuid.UUID) -> bool:
    # The bank embedding has no reader in the API until the recommender
    # switches to the bank, so this reads the row the next request will.
    async with database() as session:
        row = (
            await session.execute(
                text("SELECT embedding IS NOT NULL, embedded_at IS NOT NULL FROM experience_banks WHERE applicant_id = :id"),
                {"id": applicant_id},
            )
        ).one()
    assert row[0] == row[1]
    return row[0]


async def test_every_bank_change_clears_the_bank_embedding(student, database):
    client, bank = student
    applicant_id = uuid.UUID(bank.split("/")[2])
    created = {}

    async def create_entry():
        res = await client.post(f"{bank}/entries", json={"section": "projects", "title": "WorkIt", "bullets": ["Built it"]})
        created["entry"] = res.json()["id"]
        return res

    async def add_bullet():
        res = await client.post(f"{bank}/entries/{created['entry']}/bullets", json={"text": "Shipped it"})
        created["bullet"] = res.json()["id"]
        return res

    async def add_skill():
        res = await client.post(f"{bank}/skills", json={"name": "Python"})
        created["skill"] = res.json()["id"]
        return res

    changes = [
        create_entry,
        lambda: client.patch(f"{bank}/entries/{created['entry']}", json={"location": "Stony Brook, NY"}),
        add_bullet,
        lambda: client.patch(f"{bank}/bullets/{created['bullet']}", json={"text": "Shipped it to 50 users"}),
        lambda: client.delete(f"{bank}/bullets/{created['bullet']}"),
        add_skill,
        lambda: client.patch(f"{bank}/skills/{created['skill']}", json={"group": "Languages"}),
        lambda: client.delete(f"{bank}/skills/{created['skill']}"),
        lambda: client.delete(f"{bank}/entries/{created['entry']}"),
    ]
    for change in changes:
        await _mark_embedded(database, applicant_id)
        res = await change()
        assert res.status_code < 300, res.text
        assert not await _is_embedded(database, applicant_id), res.request.url


async def test_a_refused_change_keeps_the_bank_embedding(student, database):
    client, bank = student
    applicant_id = uuid.UUID(bank.split("/")[2])
    entry = {"section": "projects", "title": "WorkIt"}
    assert (await client.post(f"{bank}/entries", json=entry)).status_code == 201
    await _mark_embedded(database, applicant_id)

    assert (await client.post(f"{bank}/entries", json=entry)).status_code == 409
    assert await _is_embedded(database, applicant_id)
