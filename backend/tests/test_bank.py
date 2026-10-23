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
    # Reads the row the next recommendations request reads
    # (test_recommended.py drives that request itself).
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


async def test_each_section_keeps_its_own_fields(student):
    client, bank = student
    education = {
        "section": "education",
        "title": "Stony Brook University",
        "organization": "College of Engineering",
        "location": "Stony Brook, NY",
        "start_month": "2023-08",
        "end_month": "2027-05",
        "end_kind": "expected",
        "degree": "B.S.",
        "field_of_study": "Computer Science",
        "gpa": 3.8,
        "gpa_scale": 4.0,
        "coursework": ["Data Structures", "Operating Systems"],
        "honors": "Dean's List",
    }
    project = {"section": "projects", "title": "WorkIt", "link": "https://github.com/x/workit"}
    cert = {"section": "certifications", "title": "AWS Cloud Practitioner", "issuer": "Amazon"}
    award = {"section": "awards", "title": "Hackathon Winner", "award_date": "2025-04"}
    for body in (education, project, cert, award):
        res = await client.post(f"{bank}/entries", json=body)
        assert res.status_code == 201, res.text

    entries = {e["section"]: e for e in (await client.get(bank)).json()["entries"]}
    for body in (education, project, cert, award):
        saved = entries[body["section"]]
        assert {k: saved[k] for k in body} == body


async def test_a_field_from_another_section_is_refused(student):
    client, bank = student
    for body in (
        {"section": "projects", "title": "WorkIt", "gpa": 3.5},
        {"section": "experience", "title": "Intern", "link": "https://x.dev"},
        {"section": "education", "title": "SBU", "issuer": "Amazon"},
        {"section": "projects", "title": "WorkIt", "coursework": ["Algorithms"]},
        {"section": "skills", "title": "Python"},
    ):
        res = await client.post(f"{bank}/entries", json=body)
        assert res.status_code == 422, body
    assert (await client.get(bank)).json()["entries"] == []


async def test_dates_must_fit_together(student):
    client, bank = student
    base = {"section": "experience", "title": "Intern"}
    for dates in (
        {"end_kind": "present", "end_month": "2025-08"},
        {"end_kind": "expected"},
        {"start_month": "2025-06", "end_month": "2024-08"},
        {"start_month": "2025-13"},
        {"start_month": "June 2025"},
    ):
        assert (await client.post(f"{bank}/entries", json={**base, **dates})).status_code == 422, dates
    gpa = {"section": "education", "title": "SBU", "gpa": 4.2, "gpa_scale": 4.0}
    assert (await client.post(f"{bank}/entries", json=gpa)).status_code == 422

    # An end month alone ends on that month.
    res = await client.post(f"{bank}/entries", json={**base, "end_month": "2025-08"})
    assert res.status_code == 201
    assert (res.json()["end_kind"], res.json()["end_month"]) == ("month", "2025-08")


async def test_an_edit_changes_only_the_fields_sent(student):
    client, bank = student
    body = {"section": "experience", "title": "Intern", "organization": "Acme", "start_month": "2025-06", "end_kind": "present"}
    entry = (await client.post(f"{bank}/entries", json=body)).json()

    res = await client.patch(f"{bank}/entries/{entry['id']}", json={"title": "Software Intern", "organization": None})
    assert res.status_code == 200
    saved = (await client.get(bank)).json()["entries"][0]
    assert (saved["title"], saved["organization"], saved["start_month"], saved["end_kind"]) == (
        "Software Intern", None, "2025-06", "present",
    )


async def test_an_edit_is_checked_against_the_whole_entry(student):
    client, bank = student
    body = {"section": "experience", "title": "Intern", "start_month": "2025-06", "end_month": "2025-08"}
    entry = (await client.post(f"{bank}/entries", json=body)).json()
    url = f"{bank}/entries/{entry['id']}"

    # Present needs the end month cleared in the same edit.
    assert (await client.patch(url, json={"end_kind": "present"})).status_code == 422
    assert (await client.patch(url, json={"end_kind": "present", "end_month": None})).status_code == 200
    # The section is fixed, and its fields stay its own.
    assert (await client.patch(url, json={"section": "projects"})).status_code == 422
    assert (await client.patch(url, json={"gpa": 3.9})).status_code == 422
    assert (await client.patch(url, json={"title": None})).status_code == 422

    saved = (await client.get(bank)).json()["entries"][0]
    assert (saved["section"], saved["title"], saved["end_kind"], saved["end_month"]) == ("experience", "Intern", "present", None)


async def test_deleting_an_entry_deletes_its_bullets(student):
    client, bank = student
    entry = (await client.post(f"{bank}/entries", json={"section": "projects", "title": "WorkIt", "bullets": ["a", "b"]})).json()
    assert (await client.delete(f"{bank}/entries/{entry['id']}")).status_code == 204
    assert (await client.get(bank)).json()["entries"] == []
    assert (await client.patch(f"{bank}/bullets/{entry['bullets'][0]['id']}", json={"text": "x"})).status_code == 404


async def _bullet_texts(client, bank) -> list[str]:
    entry = (await client.get(bank)).json()["entries"][0]
    assert [b["position"] for b in entry["bullets"]] == list(range(len(entry["bullets"])))
    return [b["text"] for b in entry["bullets"]]


async def test_bullets_keep_their_order_through_adds_moves_and_deletes(student):
    client, bank = student
    entry = (await client.post(f"{bank}/entries", json={"section": "projects", "title": "WorkIt", "bullets": ["a", "b"]})).json()
    res = await client.post(f"{bank}/entries/{entry['id']}/bullets", json={"text": "c"})
    assert res.status_code == 201
    c = res.json()["id"]
    assert await _bullet_texts(client, bank) == ["a", "b", "c"]

    assert (await client.patch(f"{bank}/bullets/{c}", json={"position": 0})).status_code == 200
    assert await _bullet_texts(client, bank) == ["c", "a", "b"]
    assert (await client.patch(f"{bank}/bullets/{c}", json={"position": 99, "text": "C"})).status_code == 200
    assert await _bullet_texts(client, bank) == ["a", "b", "C"]

    assert (await client.delete(f"{bank}/bullets/{entry['bullets'][0]['id']}")).status_code == 204
    assert await _bullet_texts(client, bank) == ["b", "C"]
    assert (await client.post(f"{bank}/entries/{entry['id']}/bullets", json={"text": " "})).status_code == 422


async def test_skills_are_a_plain_list_with_one_of_each_name(student):
    client, bank = student
    for body in ({"name": "Python", "group": "Languages"}, {"name": "Docker"}, {"name": "Go", "group": "Languages"}):
        assert (await client.post(f"{bank}/skills", json=body)).status_code == 201
    assert (await client.post(f"{bank}/skills", json={"name": "python"})).status_code == 409

    skills = (await client.get(bank)).json()["skills"]
    assert [(s["name"], s["group"]) for s in skills] == [("Go", "Languages"), ("Python", "Languages"), ("Docker", None)]

    docker = skills[2]["id"]
    assert (await client.patch(f"{bank}/skills/{docker}", json={"name": "GO"})).status_code == 409
    res = await client.patch(f"{bank}/skills/{docker}", json={"name": "Docker Compose", "group": "Tools"})
    assert (res.status_code, res.json()["name"], res.json()["group"]) == (200, "Docker Compose", "Tools")
    assert (await client.delete(f"{bank}/skills/{docker}")).status_code == 204
    assert len((await client.get(bank)).json()["skills"]) == 2


async def test_the_bank_lists_sections_in_order_ongoing_first_then_newest(student):
    client, bank = student
    for body in (
        {"section": "projects", "title": "Old project", "end_month": "2023-05"},
        {"section": "experience", "title": "Past job", "start_month": "2024-06", "end_month": "2024-08"},
        {"section": "experience", "title": "Current job", "start_month": "2023-01", "end_kind": "present"},
        {"section": "experience", "title": "Recent job", "start_month": "2025-06", "end_month": "2025-08"},
        {"section": "education", "title": "SBU", "end_month": "2027-05", "end_kind": "expected"},
        {"section": "projects", "title": "New project", "end_month": "2025-05"},
        {"section": "awards", "title": "Prize", "award_date": "2024-04"},
    ):
        assert (await client.post(f"{bank}/entries", json=body)).status_code == 201
    titles = [e["title"] for e in (await client.get(bank)).json()["entries"]]
    assert titles == ["SBU", "Current job", "Recent job", "Past job", "New project", "Old project", "Prize"]
