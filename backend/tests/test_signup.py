"""
Signup's email verification (KAN-293): the confirmation email it
asks Supabase for, the same 201 for a taken email, and the undo when the
email can't be sent. Supabase is patched at
`app.routers.auth.get_supabase`, so nothing reaches the real project.
"""

import uuid
from types import SimpleNamespace

import httpx
import pytest
from sqlalchemy import text
from supabase_auth.errors import AuthApiError

from app.main import app

pytestmark = pytest.mark.anyio

BODY = {
    "accountType": "applicant",
    "name": "Sam Lee",
    "email": "sam.signup@example.com",
    "password": "password123",
}


class FakeSupabase:
    """Records each call; `taken` makes create_user refuse the email, and
    `resend_error` makes the confirmation email fail."""

    def __init__(self, user_id=None, taken=False, resend_error=None):
        self.user_id, self.taken, self.resend_error = user_id, taken, resend_error
        self.sent: list[dict] = []
        self.deleted: list[str] = []
        self.auth = SimpleNamespace(
            admin=SimpleNamespace(create_user=self._create, delete_user=self.deleted.append),
            resend=self._resend,
        )

    def _create(self, attributes):
        if self.taken:
            raise AuthApiError("A user with this email address has already been registered", 422, "email_exists")
        return SimpleNamespace(user=SimpleNamespace(id=str(self.user_id)))

    def _resend(self, credentials):
        if self.resend_error:
            raise self.resend_error
        self.sent.append(credentials)


async def _post(body=BODY):
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        return await client.post("/auth/signup", json=body)


async def _auth_user(database):
    user_id = uuid.uuid4()
    async with database() as s:
        await s.execute(text("INSERT INTO auth.users (id) VALUES (:id)"), {"id": user_id})
        await s.commit()
    return user_id


async def test_a_new_account_is_sent_its_confirmation_email(database, monkeypatch):
    fake = FakeSupabase(user_id=await _auth_user(database))
    monkeypatch.setattr("app.routers.auth.get_supabase", lambda: fake)

    res = await _post()

    assert res.status_code == 201
    assert fake.sent == [{"type": "signup", "email": BODY["email"]}]


async def test_a_taken_email_gets_the_same_answer(monkeypatch):
    fake = FakeSupabase(taken=True)
    monkeypatch.setattr("app.routers.auth.get_supabase", lambda: fake)

    res = await _post()

    assert res.status_code == 201
    assert res.json()["email"] == BODY["email"]
    # Sent again in case that account never confirmed.
    assert fake.sent == [{"type": "signup", "email": BODY["email"]}]


async def test_a_taken_email_whose_resend_is_refused_still_gets_201(monkeypatch):
    refused = AuthApiError("Email link is invalid or has expired", 400, "validation_failed")
    fake = FakeSupabase(taken=True, resend_error=refused)
    monkeypatch.setattr("app.routers.auth.get_supabase", lambda: fake)

    assert (await _post()).status_code == 201


async def test_an_email_that_cannot_be_sent_undoes_the_account(database, monkeypatch):
    user_id = await _auth_user(database)
    failed = AuthApiError("Error sending confirmation email", 500, "unexpected_failure")
    fake = FakeSupabase(user_id=user_id, resend_error=failed)
    monkeypatch.setattr("app.routers.auth.get_supabase", lambda: fake)

    res = await _post()

    assert res.status_code == 502
    assert fake.deleted == [str(user_id)]

