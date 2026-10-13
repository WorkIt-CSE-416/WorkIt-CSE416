"""
Seam-1 tests for import (KAN-211): an uploaded resume becomes draft entries
and draft skills through the API on real Postgres. Import writes nothing; the
student saves drafts through the bank's own routes. backend/CLAUDE.md's Tests
section has the setup.
"""

import uuid

import httpx
import pytest
from sqlalchemy import text

from app.deps import get_current_account
from app.main import app
from app.schemas.auth import AccountType, AuthenticatedAccount

pytestmark = pytest.mark.anyio

# Starts at the first section header, like the parser fixtures: no contact details.
RESUME_TEXT = """\
Education
Riverside State University  Expected May 2099
B.S. in Mechanical Engineering
•GPA: 3.62
•Coursework: Thermodynamics, Fluid Mechanics, Statics
Experience
Harbor Robotics  Jun 2026 - Aug 2026
Mechanical Engineering Intern  Portland, OR
•Designed a sheet-metal bracket that cut assembly time by 20%
•Ran tolerance stack-up analyses in SolidWorks
Projects
Budget Buddy  Jan 2026 - Mar 2026
https://github.com/example/budget-buddy
•Built a shared expense tracker
Leadership & Activities
Society of Women Engineers  Sep 2025 - Present
Vice President  Riverside, CA
•Organized 12 technical workshops
Awards
Dean's List – Riverside State University  Dec 2025
Certifications
Certified SolidWorks Associate – Dassault Systemes
Skills
•Tools: SolidWorks, MATLAB
"""


async def _seed_applicant(session) -> uuid.UUID:
    applicant_id = uuid.uuid4()
    await session.execute(text("INSERT INTO auth.users (id) VALUES (:id)"), {"id": applicant_id})
    await session.execute(
        text("INSERT INTO applicant_profiles (id, email, full_name) VALUES (:id, :email, 'Sam Seeker')"),
        {"id": applicant_id, "email": f"{applicant_id.hex[:8]}@example.com"},
    )
    await session.commit()
    return applicant_id


async def _seed_resume(database, applicant_id: uuid.UUID, raw_text: str | None, *, minutes_ago: int = 0) -> uuid.UUID:
    resume_id = uuid.uuid4()
    async with database() as session:
        await session.execute(
            text(
                "INSERT INTO resumes (id, applicant_id, original_filename, storage_path, status, raw_text, created_at)"
                " VALUES (:id, :applicant, 'resume.pdf', :path, 'parsed', :raw,"
                " now() - make_interval(mins => :ago))"
            ),
            {"id": resume_id, "applicant": applicant_id, "path": f"{applicant_id}/{resume_id}.pdf", "raw": raw_text, "ago": minutes_ago},
        )
        await session.commit()
    return resume_id


async def _set_default(database, applicant_id: uuid.UUID, resume_id: uuid.UUID) -> None:
    async with database() as session:
        await session.execute(
            text("UPDATE applicant_profiles SET default_resume_id = :r WHERE id = :a"),
            {"r": resume_id, "a": applicant_id},
        )
        await session.commit()


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
    """A signed-in applicant and an API client. Yields (client, applicant id, bank URL)."""
    async with database() as session:
        applicant_id = await _seed_applicant(session)
    _sign_in(applicant_id)
    transport = httpx.ASGITransport(app=app)
    try:
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
            yield client, applicant_id, f"/applicants/{applicant_id}/bank"
    finally:
        app.dependency_overrides.pop(get_current_account, None)


def _summary(entry: dict) -> tuple:
    return (entry["section"], entry["title"], entry["organization"])


async def test_import_maps_the_resume_to_draft_entries_and_skills(student, database):
    client, applicant_id, bank = student
    resume_id = await _seed_resume(database, applicant_id, RESUME_TEXT)

    res = await client.post(f"{bank}/import", json={"resume_id": str(resume_id)})
    assert res.status_code == 200
    body = res.json()
    assert body["resume_id"] == str(resume_id)
    assert body["filename"] == "resume.pdf"

    entries = body["entries"]
    assert [_summary(e) for e in entries] == [
        ("education", "Riverside State University", None),
        ("experience", "Mechanical Engineering Intern", "Harbor Robotics"),
        ("projects", "Budget Buddy", None),
        ("leadership", "Vice President", "Society of Women Engineers"),
        ("awards", "Dean's List", "Riverside State University"),
        ("certifications", "Certified SolidWorks Associate", None),
    ]
    education, job, project, club, award, cert = entries

    assert (education["degree"], education["field_of_study"], education["gpa"]) == ("B.S", "Mechanical Engineering", 3.62)
    assert education["coursework"] == ["Thermodynamics", "Fluid Mechanics", "Statics"]
    assert (education["end_month"], education["end_kind"]) == ("2099-05", "expected")
    assert education["bullets"] == []

    # The resume's own words, unchanged.
    assert job["bullets"] == [
        "Designed a sheet-metal bracket that cut assembly time by 20%",
        "Ran tolerance stack-up analyses in SolidWorks",
    ]
    assert (job["location"], job["start_month"], job["end_month"], job["end_kind"]) == (
        "Portland, OR", "2026-06", "2026-08", "month",
    )
    assert (project["link"], project["bullets"]) == (
        "https://github.com/example/budget-buddy", ["Built a shared expense tracker"],
    )
    assert (club["start_month"], club["end_month"], club["end_kind"]) == ("2025-09", None, "present")
    assert (award["award_date"], award["start_month"], award["end_kind"]) == ("2025-12", None, None)
    assert cert["issuer"] == "Dassault Systemes"
    assert all(e["duplicate_of"] is None for e in entries)

    assert body["skills"] == [
        {"name": "SolidWorks", "group": "Tools", "in_bank": False},
        {"name": "MATLAB", "group": "Tools", "in_bank": False},
    ]


async def test_import_writes_nothing_to_the_bank(student, database):
    client, applicant_id, bank = student
    resume_id = await _seed_resume(database, applicant_id, RESUME_TEXT)

    assert (await client.post(f"{bank}/import", json={"resume_id": str(resume_id)})).status_code == 200
    assert (await client.get(bank)).json() == {"entries": [], "skills": []}


async def test_every_draft_saves_through_the_bank_routes(student, database):
    client, applicant_id, bank = student
    resume_id = await _seed_resume(database, applicant_id, RESUME_TEXT)
    drafts = (await client.post(f"{bank}/import", json={"resume_id": str(resume_id)})).json()

    for draft in drafts["entries"]:
        draft.pop("duplicate_of")
        res = await client.post(f"{bank}/entries", json=draft)
        assert res.status_code == 201, (draft, res.json())
    for skill in drafts["skills"]:
        assert (await client.post(f"{bank}/skills", json={"name": skill["name"], "group": skill["group"]})).status_code == 201

    saved = (await client.get(bank)).json()
    assert len(saved["entries"]) == 6
    assert len(saved["skills"]) == 2


async def test_drafts_already_in_the_bank_are_flagged(student, database):
    client, applicant_id, bank = student
    existing = (
        await client.post(
            f"{bank}/entries",
            json={"section": "experience", "title": "mechanical engineering intern", "organization": "HARBOR ROBOTICS"},
        )
    ).json()
    await client.post(f"{bank}/skills", json={"name": "matlab"})
    resume_id = await _seed_resume(database, applicant_id, RESUME_TEXT)

    body = (await client.post(f"{bank}/import", json={"resume_id": str(resume_id)})).json()
    flagged = {e["title"]: e["duplicate_of"] for e in body["entries"]}
    assert flagged["Mechanical Engineering Intern"] == existing["id"]
    assert flagged["Vice President"] is None
    assert {s["name"]: s["in_bank"] for s in body["skills"]} == {"SolidWorks": False, "MATLAB": True}


async def test_without_a_resume_id_import_reads_the_default_resume_else_the_newest(student, database):
    client, applicant_id, bank = student
    older = await _seed_resume(database, applicant_id, RESUME_TEXT, minutes_ago=10)
    newest = await _seed_resume(database, applicant_id, "Projects\nWorkIt  Jan 2026 - Present\n• Built it")

    res = await client.post(f"{bank}/import", json={})
    assert res.json()["resume_id"] == str(newest)
    assert [e["title"] for e in res.json()["entries"]] == ["WorkIt"]

    await _set_default(database, applicant_id, older)
    assert (await client.post(f"{bank}/import", json={})).json()["resume_id"] == str(older)


async def test_a_resume_with_no_readable_sections_gives_no_drafts(student, database):
    client, applicant_id, bank = student
    unreadable = await _seed_resume(database, applicant_id, None)
    res = await client.post(f"{bank}/import", json={"resume_id": str(unreadable)})
    assert res.status_code == 200
    assert (res.json()["entries"], res.json()["skills"]) == ([], [])


async def test_import_with_no_uploaded_resume_is_not_found(student):
    client, _, bank = student
    assert (await client.post(f"{bank}/import", json={})).status_code == 404


async def test_another_students_resume_cannot_be_imported(student, database):
    client, _, bank = student
    async with database() as session:
        other = await _seed_applicant(session)
    theirs = await _seed_resume(database, other, RESUME_TEXT)

    assert (await client.post(f"{bank}/import", json={"resume_id": str(theirs)})).status_code == 404
    assert (await client.post(f"/applicants/{other}/bank/import", json={})).status_code == 403
