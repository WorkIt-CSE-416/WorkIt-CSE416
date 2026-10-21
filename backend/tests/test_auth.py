"""
Password signup's email confirmation (KAN-283's auth follow-up): signup
creates the Supabase user unconfirmed and triggers its "Confirm signup"
email, and /auth/resend-confirmation never reveals whether an email has an
account. backend/CLAUDE.md's Tests section: test behaviour, never a
prompt's wording — there's no model here, just what gets called and what
the route answers.
"""

import uuid
from types import SimpleNamespace

import httpx
import pytest
from sqlalchemy import text
from supabase_auth.errors import AuthApiError

from app.main import app

pytestmark = pytest.mark.anyio


class FakeAuth:
    """`supabase.auth` (and `.admin`), recording every call so a test can
    assert on it. `create_user` always succeeds with the id this fixture
    was given — the real `auth.users` row for it is seeded separately,
    since the real database still enforces the foreign key
    `applicant_profiles.id` points at."""

    def __init__(self, user_id: uuid.UUID, resend_error: Exception | None = None):
        self.calls: list[tuple[str, dict]] = []
        self._user_id = user_id
        self._resend_error = resend_error
        self.admin = SimpleNamespace(
            create_user=self._create_user,
            delete_user=lambda user_id: self.calls.append(("delete_user", {"user_id": user_id})),
        )

    def _create_user(self, attributes: dict):
        self.calls.append(("create_user", attributes))
        return SimpleNamespace(user=SimpleNamespace(id=str(self._user_id)))

    def resend(self, params: dict):
        self.calls.append(("resend", params))
        if self._resend_error:
            raise self._resend_error


async def _seed_auth_user(database, user_id: uuid.UUID) -> None:
    async with database() as session:
        await session.execute(text("INSERT INTO auth.users (id) VALUES (:id)"), {"id": user_id})
        await session.commit()


async def _signup(client: httpx.AsyncClient, email: str) -> httpx.Response:
    return await client.post(
        "/auth/signup",
        json={
            "accountType": "applicant",
            "name": "Sam Seeker",
            "email": email,
            "password": "a-real-password",
            "redirectTo": "https://workit.example/auth/callback",
        },
    )


async def test_signup_creates_an_unconfirmed_user(database, monkeypatch):
    user_id = uuid.uuid4()
    await _seed_auth_user(database, user_id)
    fake = FakeAuth(user_id)
    monkeypatch.setattr("app.routers.auth.get_supabase", lambda: SimpleNamespace(auth=fake))

    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        res = await _signup(client, "sam@example.com")

    assert res.status_code == 201
    [(_, attributes)] = [c for c in fake.calls if c[0] == "create_user"]
    assert attributes["email_confirm"] is False


async def test_signup_sends_the_confirmation_email(database, monkeypatch):
    user_id = uuid.uuid4()
    await _seed_auth_user(database, user_id)
    fake = FakeAuth(user_id)
    monkeypatch.setattr("app.routers.auth.get_supabase", lambda: SimpleNamespace(auth=fake))

    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        res = await _signup(client, "sam2@example.com")

    assert res.status_code == 201
    [(_, params)] = [c for c in fake.calls if c[0] == "resend"]
    assert params["type"] == "signup"
    assert params["email"] == "sam2@example.com"
    assert params["options"]["email_redirect_to"] == "https://workit.example/auth/callback"


async def test_signup_succeeds_even_if_the_confirmation_email_fails(database, monkeypatch):
    user_id = uuid.uuid4()
    await _seed_auth_user(database, user_id)
    fake = FakeAuth(user_id, resend_error=AuthApiError("mail server down", 500, "unexpected_failure"))
    monkeypatch.setattr("app.routers.auth.get_supabase", lambda: SimpleNamespace(auth=fake))

    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        res = await _signup(client, "sam3@example.com")

    # The account is real either way — a transient send failure isn't the
    # student's to fix by retrying signup, which would just 409 on the
    # email they already took.
    assert res.status_code == 201


@pytest.mark.parametrize(
    "resend_error",
    [
        None,  # a real, unconfirmed account
        AuthApiError("User not found", 400, "user_not_found"),
        AuthApiError("Already confirmed", 400, "email_already_confirmed"),
    ],
)
async def test_resend_confirmation_always_answers_the_same_message(monkeypatch, resend_error):
    fake = FakeAuth(uuid.uuid4(), resend_error=resend_error)
    monkeypatch.setattr("app.routers.auth.get_supabase", lambda: SimpleNamespace(auth=fake))

    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        res = await client.post(
            "/auth/resend-confirmation",
            json={"email": "whoever@example.com", "redirectTo": "https://workit.example/auth/callback"},
        )

    assert res.status_code == 200
    assert "we've sent a new link" in res.json()["message"].lower()


async def test_resend_confirmation_rate_limit_gets_its_own_message(monkeypatch):
    fake = FakeAuth(
        uuid.uuid4(),
        resend_error=AuthApiError("slow down", 429, "over_email_send_rate_limit"),
    )
    monkeypatch.setattr("app.routers.auth.get_supabase", lambda: SimpleNamespace(auth=fake))

    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        res = await client.post(
            "/auth/resend-confirmation",
            json={"email": "whoever@example.com"},
        )

    assert res.status_code == 429
