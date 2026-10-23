"""
get_current_account copies a changed sign-in email from the token onto the
profile row (KAN-326, Settings' Change Email), on real Postgres. The token
check is patched: it verifies against Supabase's keys.
"""

import uuid

import httpx
import pytest
from sqlalchemy import text

from app.main import app

pytestmark = pytest.mark.anyio


async def _me(monkeypatch, applicant_id: uuid.UUID, email: str) -> httpx.Response:
    async def claims(_token):
        return {"sub": str(applicant_id), "email": email, "app_metadata": {"account_type": "applicant"}}

    monkeypatch.setattr("app.deps.decode_access_token", claims)
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        return await client.get("/auth/me", headers={"Authorization": "Bearer token"})


async def _seed(database, applicant_id: uuid.UUID, email: str) -> None:
    async with database() as s:
        await s.execute(text("INSERT INTO auth.users (id) VALUES (:id)"), {"id": applicant_id})
        await s.execute(
            text("INSERT INTO applicant_profiles (id, email, full_name) VALUES (:id, :email, 'Sam')"),
            {"id": applicant_id, "email": email},
        )
        await s.commit()


async def _stored(database, applicant_id: uuid.UUID) -> str:
    async with database() as s:
        return await s.scalar(
            text("SELECT email FROM applicant_profiles WHERE id = :id"), {"id": applicant_id}
        )


async def test_a_new_email_in_the_token_is_copied_to_the_row(database, monkeypatch):
    applicant_id = uuid.uuid4()
    await _seed(database, applicant_id, "old@example.com")

    res = await _me(monkeypatch, applicant_id, "New@Example.com")

    assert res.status_code == 200
    assert res.json()["email"] == "new@example.com"
    assert await _stored(database, applicant_id) == "new@example.com"


async def test_an_email_another_row_holds_keeps_the_old_copy(database, monkeypatch):
    applicant_id = uuid.uuid4()
    await _seed(database, applicant_id, "old@example.com")
    await _seed(database, uuid.uuid4(), "taken@example.com")

    res = await _me(monkeypatch, applicant_id, "taken@example.com")

    assert res.status_code == 200
    assert res.json()["email"] == "old@example.com"
    assert await _stored(database, applicant_id) == "old@example.com"
