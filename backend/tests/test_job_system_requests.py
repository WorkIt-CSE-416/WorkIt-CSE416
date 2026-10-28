"""
Request this job system (KAN-369): on a job page WorkIt can't fill, the
extension's popup sends only the page's host. The API stores it with no
account, and refuses anything else (a path, a query, page text), so the team
ranks the next job systems by how many students asked.
"""

import uuid

import httpx
import pytest
from sqlalchemy import text

from app.deps import get_current_account
from app.main import app
from app.schemas.auth import AccountType, AuthenticatedAccount

pytestmark = pytest.mark.anyio


@pytest.fixture
def signed_in():
    app.dependency_overrides[get_current_account] = lambda: AuthenticatedAccount(
        id=uuid.uuid4(), email="sam@example.com", full_name="Sam Seeker",
        account_type=AccountType.APPLICANT, onboarding_completed=True,
    )
    yield
    app.dependency_overrides.pop(get_current_account, None)


async def _send(body: dict) -> httpx.Response:
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://localhost:8000") as api:
        return await api.post("/job-system-requests", json=body)


async def test_a_request_stores_the_host_alone_and_refuses_anything_else(signed_in, database):
    assert (await _send({"host": "careers.example-ats.com"})).status_code == 201
    assert (await _send({"host": "careers.example-ats.com"})).status_code == 201

    for refused in (
        {"host": "careers.example-ats.com/jobs/1"},
        {"host": "https://careers.example-ats.com"},
        {"host": "careers.example-ats.com", "url": "https://careers.example-ats.com/jobs/1"},
        {"host": "localhost"},
        {"host": ""},
    ):
        assert (await _send(refused)).status_code == 422, refused

    async with database() as session:
        rows = (await session.execute(text("SELECT host, count(*) FROM job_system_requests GROUP BY host"))).all()
    assert [tuple(r) for r in rows] == [("careers.example-ats.com", 2)]


async def test_a_request_needs_a_signed_in_account(database):
    assert (await _send({"host": "careers.example-ats.com"})).status_code == 401
