"""
Fill numbers (KAN-476, decided in KAN-454): after every fill the extension
sends one event with the job system, the engine and extension versions, the
field counts, the error names and how long it took; never a value. The API
stores it naming no account, caps each account's events a day, the daily
purge deletes events past 90 days (KAN-482), and gives admins per-system, per-day rates at
GET /admin/fill-health.
"""

import datetime
import json
import uuid

import httpx
import pytest
from sqlalchemy import text

from app.config import get_settings
from app.deps import get_current_account
from app.main import app
from app.schemas.auth import AccountType, AuthenticatedAccount
from app.services import retention

pytestmark = pytest.mark.anyio

EVENT = {
    "job_system": "greenhouse",
    "engine_version": "v0.3.2-105-gfcaaf20",
    "extension_version": "0.4.0",
    "mode": "single",
    "fields": 12,
    "filled": 9,
    "guessed": 2,
    "needs_you": 2,
    "failed": 1,
    "errors": {"Readback": 1},
    "duration_ms": 4200,
}

STUDENT = "sam@example.com"
ADMIN = "dev@example.com"


@pytest.fixture
async def accounts(database, monkeypatch):
    """A student and an admin (on WORKIT_ADMINS), each with an auth.users row; `as_(email)` signs one in."""
    ids = {STUDENT: uuid.uuid4(), ADMIN: uuid.uuid4()}
    async with database() as session:
        for account_id in ids.values():
            await session.execute(text("INSERT INTO auth.users (id) VALUES (:id)"), {"id": account_id})
        await session.commit()
    monkeypatch.setattr(get_settings(), "workit_admins", ADMIN)

    def as_(email: str) -> uuid.UUID:
        app.dependency_overrides[get_current_account] = lambda: AuthenticatedAccount(
            id=ids[email], email=email, full_name="Test", account_type=AccountType.APPLICANT, onboarding_completed=True,
        )
        return ids[email]

    as_(STUDENT)
    yield as_
    app.dependency_overrides.pop(get_current_account, None)


def _api() -> httpx.AsyncClient:
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://localhost:8000")


async def _send(event: dict) -> httpx.Response:
    async with _api() as api:
        return await api.post("/fill-events", json=event)


async def _count(database) -> int:
    async with database() as session:
        return (await session.execute(text("SELECT count(*) FROM fill_events"))).scalar_one()


async def _seed(database, at: datetime.datetime, **changes) -> None:
    event = {**EVENT, **changes}
    async with database() as session:
        await session.execute(
            text(
                "INSERT INTO fill_events (created_at, job_system, engine_version, extension_version, mode,"
                " fields, filled, guessed, needs_you, failed, errors, duration_ms) VALUES (:at, :job_system,"
                " :engine_version, :extension_version, :mode, :fields, :filled, :guessed, :needs_you, :failed,"
                " CAST(:errors AS jsonb), :duration_ms)"
            ),
            {**event, "at": at, "errors": json.dumps(event["errors"])},
        )
        await session.commit()


async def test_an_event_is_stored_and_one_carrying_anything_else_is_refused(accounts, database):
    assert (await _send(EVENT)).status_code == 201
    assert await _count(database) == 1

    refused = [
        {**EVENT, "answer": "Sam"},  # no key outside the shape
        {**EVENT, "errors": {"meant 'Sam'": 1}},  # error names are the extension's own
        {**EVENT, "job_system": "Sam Seeker"},
        {**EVENT, "engine_version": "sam@example.com"},
        {**EVENT, "mode": "auto"},
        {**EVENT, "filled": -1},
        {**EVENT, "duration_ms": 10**9},
    ]
    for event in refused:
        assert (await _send(event)).status_code == 422, event
    assert await _count(database) == 1


async def test_an_account_sends_at_most_the_daily_cap(accounts, database, monkeypatch):
    monkeypatch.setattr(get_settings(), "fill_event_daily_cap", 2)
    assert [(await _send(EVENT)).status_code for _ in range(3)] == [201, 201, 429]
    assert await _count(database) == 2
    # Another account has its own cap.
    accounts(ADMIN)
    assert (await _send(EVENT)).status_code == 201


async def test_events_past_the_retention_period_are_deleted(accounts, database):
    now = datetime.datetime.now(datetime.UTC)
    await _seed(database, now - datetime.timedelta(days=91))
    await _seed(database, now - datetime.timedelta(days=89))
    # KAN-482's daily purge, whose RETENTION names this table.
    async with database() as session:
        counts = await retention.purge(session, now=now)
    assert counts["fill_events"] == 1
    # The 91-day-old one is gone; the 89-day-old one stays.
    assert await _count(database) == 1


async def test_fill_health_is_per_system_per_day_for_admins_only(accounts, database):
    day = datetime.datetime.now(datetime.UTC).replace(hour=12, minute=0, second=0, microsecond=0)
    # Greenhouse today: three fills, two with no failed field.
    await _seed(database, day, failed=0, errors={}, fields=10, needs_you=1)
    await _seed(database, day, failed=0, errors={}, fields=10, needs_you=0)
    await _seed(database, day, failed=2, errors={"Readback": 2, "FillError": 1}, fields=10, needs_you=3)
    # Workday yesterday, on another engine version: every fill failed somewhere.
    await _seed(database, day - datetime.timedelta(days=1), job_system="workday", engine_version="v0.3.1", failed=1, errors={"FillError": 1})

    async with _api() as api:
        assert (await api.get("/admin/fill-health")).status_code == 403
        accounts(ADMIN)
        answer = (await api.get("/admin/fill-health?days=7")).json()
        only_new = (await api.get("/admin/fill-health?engine_version=v0.3.2-105-gfcaaf20")).json()

    greenhouse = next(r for r in answer["rows"] if r["job_system"] == "greenhouse")
    assert greenhouse == {
        "day": day.date().isoformat(), "job_system": "greenhouse", "fills": 3, "clean_share": pytest.approx(2 / 3),
        "needs_you_rate": pytest.approx(4 / 30), "top_errors": [{"name": "Readback", "count": 2}, {"name": "FillError", "count": 1}],
    }
    workday = next(r for r in answer["rows"] if r["job_system"] == "workday")
    assert (workday["fills"], workday["clean_share"]) == (1, 0)
    assert sorted(answer["engine_versions"]) == ["v0.3.1", "v0.3.2-105-gfcaaf20"]
    assert [r["job_system"] for r in only_new["rows"]] == ["greenhouse"]
