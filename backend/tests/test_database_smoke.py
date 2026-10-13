"""
The smoke test for the real-Postgres seam (KAN-203): a row written through
the API is there when the API reads it back. Proves the migrations ran, the
app's own get_session reaches the test database, and the cleanup leaves the
next test an empty table. backend/CLAUDE.md's Tests section has the setup.
"""

import uuid

import httpx
import pytest
from sqlalchemy import text

from app.deps import get_current_account
from app.main import app
from app.schemas.auth import AccountType, AuthenticatedAccount

pytestmark = pytest.mark.anyio


async def _seed_applicant(session, applicant_id: uuid.UUID) -> None:
    # auth.users is a stub the fixture creates; Supabase owns the real one.
    await session.execute(
        text("INSERT INTO auth.users (id) VALUES (:id)"), {"id": applicant_id}
    )
    await session.execute(
        text(
            "INSERT INTO applicant_profiles (id, email, full_name)"
            " VALUES (:id, 'sam@example.com', 'Sam Seeker')"
        ),
        {"id": applicant_id},
    )
    await session.commit()


async def test_a_profile_edit_is_read_back(database):
    applicant_id = uuid.uuid4()
    async with database() as session:
        await _seed_applicant(session, applicant_id)

    # Token verification needs Supabase's keys; the account it would load is
    # the row seeded above.
    app.dependency_overrides[get_current_account] = lambda: AuthenticatedAccount(
        id=applicant_id,
        email="sam@example.com",
        full_name="Sam Seeker",
        account_type=AccountType.APPLICANT,
        onboarding_completed=True,
    )
    try:
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
            url = f"/applicants/{applicant_id}/profile"
            res = await client.patch(url, json={"headline": "Robotics student"})
            assert res.status_code == 200
            res = await client.get(url)
    finally:
        app.dependency_overrides.pop(get_current_account, None)

    assert res.status_code == 200
    assert res.json()["headline"] == "Robotics student"


async def test_each_test_starts_with_empty_tables(database):
    # Runs after the test above, which left a profile behind.
    async with database() as session:
        count = await session.scalar(text("SELECT count(*) FROM applicant_profiles"))
    assert count == 0


async def test_every_public_table_has_row_level_security_on(database):
    # The deny-all backstop against the anon key (alembic/CLAUDE.md): a
    # migration that forgets ENABLE ROW LEVEL SECURITY fails here.
    async with database() as session:
        missing = (
            await session.scalars(
                text(
                    "SELECT relname FROM pg_class JOIN pg_namespace n ON n.oid = relnamespace"
                    " WHERE nspname = 'public' AND relkind = 'r' AND NOT relrowsecurity"
                    " AND relname <> 'alembic_version'"
                )
            )
        ).all()
    assert missing == []
