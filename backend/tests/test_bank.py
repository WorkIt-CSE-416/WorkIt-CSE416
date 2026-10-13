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
