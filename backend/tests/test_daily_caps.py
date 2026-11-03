"""
Daily caps on the extension's writes (KAN-478): one account may send 30 fix
reports and 50 job system requests a UTC day; the next is a 429 with a plain
sentence the panel shows. Another account is not held back by it, and a
refused body (422) costs nothing.
"""

import uuid

import httpx
import pytest
from sqlalchemy import text

from app.deps import get_current_account
from app.main import app
from app.schemas.auth import AccountType, AuthenticatedAccount

pytestmark = pytest.mark.anyio

REPORT = {
    "job_system": "greenhouse",
    "posting_url": "https://job-boards.greenhouse.io/acme/jobs/123",
    "engine_version": "0.3.2",
    "fields": [{"kind": "text", "label_shape": "first name", "error": "Readback"}],
}


@pytest.fixture
async def accounts(database):
    ids = [uuid.uuid4(), uuid.uuid4()]
    async with database() as session:
        for account_id in ids:
            await session.execute(text("INSERT INTO auth.users (id) VALUES (:id)"), {"id": account_id})
        await session.commit()
    yield ids
    app.dependency_overrides.pop(get_current_account, None)


def _as(account_id: uuid.UUID) -> None:
    app.dependency_overrides[get_current_account] = lambda: AuthenticatedAccount(
        id=account_id, email="sam@example.com", full_name="Sam Seeker",
        account_type=AccountType.APPLICANT, onboarding_completed=True,
    )


def _api() -> httpx.AsyncClient:
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://localhost:8000")


async def test_the_31st_report_in_a_day_is_refused_and_another_account_still_sends(accounts):
    sam, pat = accounts
    async with _api() as api:
        _as(sam)
        # A body outside the shape is refused before it counts.
        assert (await api.post("/fill-reports", json={**REPORT, "answer": "Sam"})).status_code == 422
        for n in range(30):
            assert (await api.post("/fill-reports", json=REPORT)).status_code == 201, n
        refused = await api.post("/fill-reports", json=REPORT)
        assert refused.status_code == 429
        assert refused.json()["detail"].startswith("You've sent a lot of reports today.")
        assert (await api.get("/fill-reports/mine")).json()["total"] == 30

        _as(pat)
        assert (await api.post("/fill-reports", json=REPORT)).status_code == 201


async def test_the_51st_job_system_request_in_a_day_is_refused_and_another_account_still_sends(accounts, database):
    sam, pat = accounts
    async with _api() as api:
        _as(sam)
        for n in range(50):
            assert (await api.post("/job-system-requests", json={"host": "careers.example-ats.com"})).status_code == 201, n
        refused = await api.post("/job-system-requests", json={"host": "careers.example-ats.com"})
        assert refused.status_code == 429
        assert refused.json()["detail"].startswith("You've sent a lot of requests today.")

        _as(pat)
        assert (await api.post("/job-system-requests", json={"host": "careers.example-ats.com"})).status_code == 201
    async with database() as session:
        assert await session.scalar(text("SELECT count(*) FROM job_system_requests")) == 51
