"""
Name parts (KAN-326): first, middle and last name beside full_name, which is
always them joined. The helper, the migration's backfill on real Postgres,
the profile PATCH that keeps the four in step, and signup.
"""

import importlib.util
import uuid
from pathlib import Path
from types import SimpleNamespace

import httpx
import pytest
from sqlalchemy import text

from app.deps import get_current_account
from app.main import app
from app.schemas.auth import AccountType, AuthenticatedAccount
from app.services.names import join_name, name_columns, split_name

pytestmark = pytest.mark.anyio


@pytest.mark.parametrize(
    ("full", "parts"),
    [
        ("Sam", ("Sam", None, None)),
        ("Sam Lee", ("Sam", None, "Lee")),
        ("  Mary  Ann   de Souza ", ("Mary", "Ann de", "Souza")),
        ("", ("", None, None)),
    ],
)
def test_split_name(full, parts):
    assert split_name(full) == parts


def test_join_and_columns():
    assert join_name("Sam", None, "Lee") == "Sam Lee"
    assert join_name(" Sam ", " J ", "Lee") == "Sam J Lee"
    assert name_columns("ignored", "Sam", "", "Lee") == {
        "full_name": "Sam Lee",
        "first_name": "Sam",
        "middle_name": None,
        "last_name": "Lee",
    }
    assert name_columns("Ana Maria Lopez")["middle_name"] == "Maria"


def _backfill_sql() -> str:
    path = next(Path(__file__).parents[1].glob("alembic/versions/*_name_parts.py"))
    spec = importlib.util.spec_from_file_location("name_parts_migration", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.BACKFILL


async def _seed(session, full_name: str) -> uuid.UUID:
    account_id = uuid.uuid4()
    await session.execute(text("INSERT INTO auth.users (id) VALUES (:id)"), {"id": account_id})
    await session.execute(
        text("INSERT INTO applicant_profiles (id, email, full_name) VALUES (:id, :email, :name)"),
        {"id": account_id, "email": f"{account_id}@example.com", "name": full_name},
    )
    return account_id


async def test_the_migration_splits_names_as_split_name_does(database):
    names = ["Sam", "Sam Lee", "  Mary  Ann   de Souza ", "Jean-Luc Picard"]
    async with database() as s:
        ids = [await _seed(s, name) for name in names]
        await s.execute(text(_backfill_sql().format(table="applicant_profiles")))
        await s.commit()
        for account_id, name in zip(ids, names):
            row = (
                await s.execute(
                    text(
                        "SELECT first_name, middle_name, last_name"
                        " FROM applicant_profiles WHERE id = :id"
                    ),
                    {"id": account_id},
                )
            ).one()
            assert tuple(row) == split_name(name), name


@pytest.fixture
async def profile(database):
    async with database() as s:
        account_id = await _seed(s, "Sam Lee")
        await s.commit()
    app.dependency_overrides[get_current_account] = lambda: AuthenticatedAccount(
        id=account_id,
        email=f"{account_id}@example.com",
        full_name="Sam Lee",
        account_type=AccountType.APPLICANT,
        onboarding_completed=True,
    )
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        yield client, f"/applicants/{account_id}/profile"
    app.dependency_overrides.pop(get_current_account, None)


async def test_a_row_without_parts_reads_back_split(profile):
    client, url = profile
    body = (await client.get(url)).json()
    assert (body["first_name"], body["middle_name"], body["last_name"]) == ("Sam", None, "Lee")


async def test_parts_sent_are_joined_into_full_name(profile):
    client, url = profile
    res = await client.patch(url, json={"first_name": "Samuel", "middle_name": "J"})
    assert res.status_code == 200
    body = res.json()
    assert body["full_name"] == "Samuel J Lee"
    assert (body["first_name"], body["middle_name"], body["last_name"]) == ("Samuel", "J", "Lee")

    res = await client.patch(url, json={"middle_name": ""})
    assert res.json()["full_name"] == "Samuel Lee"


async def test_a_full_name_sent_alone_is_split(profile):
    client, url = profile
    body = (await client.patch(url, json={"full_name": "Ana Maria Lopez"})).json()
    assert (body["first_name"], body["middle_name"], body["last_name"]) == ("Ana", "Maria", "Lopez")


async def test_a_blank_last_name_is_refused(profile):
    client, url = profile
    assert (await client.patch(url, json={"last_name": ""})).status_code == 422
    assert (await client.patch(url, json={"last_name": None})).status_code == 422


async def test_a_name_longer_than_full_name_holds_is_refused(profile):
    client, url = profile
    res = await client.patch(url, json={"first_name": "A" * 30, "last_name": "B" * 30})
    assert res.status_code == 422


async def test_signup_stores_the_parts(database, monkeypatch):
    created_id = uuid.uuid4()

    class Admin:
        def create_user(self, attributes):
            return SimpleNamespace(user=SimpleNamespace(id=str(created_id)))

    class Supabase:
        auth = SimpleNamespace(admin=Admin())

    async with database() as s:
        await s.execute(text("INSERT INTO auth.users (id) VALUES (:id)"), {"id": created_id})
        await s.commit()
    monkeypatch.setattr("app.routers.auth.get_supabase", lambda: Supabase())

    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        res = await client.post(
            "/auth/signup",
            json={
                "accountType": "applicant",
                "name": "Sam J Lee",
                "firstName": "Sam",
                "middleName": "J",
                "lastName": "Lee",
                "email": "sam.parts@example.com",
                "password": "password123",
            },
        )
    assert res.status_code == 201
    async with database() as s:
        row = (
            await s.execute(
                text(
                    "SELECT full_name, first_name, middle_name, last_name"
                    " FROM applicant_profiles WHERE id = :id"
                ),
                {"id": created_id},
            )
        ).one()
    assert tuple(row) == ("Sam J Lee", "Sam", "J", "Lee")
