"""
Report a problem (KAN-403): the extension's panel sends a report the student
previewed (the job system, the posting's public link, the Fill engine's
version, each failed field's kind, label shape and error name, their note).
The API stores it with no account, and refuses anything outside that shape,
so an answer or the page's text can't ride along.
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
    "engine_version": "v0.3.2-105-gfcaaf20",
    "fields": [{"kind": "text", "label_shape": "first name", "error": "Readback"}],
    "note": "The name box changed what WorkIt typed.",
}


@pytest.fixture
def signed_in():
    app.dependency_overrides[get_current_account] = lambda: AuthenticatedAccount(
        id=uuid.uuid4(), email="sam@example.com", full_name="Sam Seeker",
        account_type=AccountType.APPLICANT, onboarding_completed=True,
    )
    yield
    app.dependency_overrides.pop(get_current_account, None)


async def _send(report: dict) -> httpx.Response:
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://localhost:8000") as api:
        return await api.post("/fill-reports", json=report)


async def _stored(database) -> list[dict]:
    async with database() as session:
        rows = await session.execute(text("SELECT job_system, posting_url, engine_version, fields, note FROM fill_reports"))
        return [dict(row._mapping) for row in rows]


async def test_a_report_is_stored_and_one_outside_the_shape_is_refused(signed_in, database):
    assert (await _send(REPORT)).status_code == 201
    assert await _stored(database) == [REPORT]

    with_answer = {**REPORT, "fields": [{**REPORT["fields"][0], "answer": "Sam"}]}
    with_page_text = {**REPORT, "reason": "meant 'Sam', page shows 'Pat'"}
    with_query = {**REPORT, "posting_url": "https://job-boards.greenhouse.io/acme/jobs/123?email=sam@example.com"}
    with_unknown_error = {**REPORT, "fields": [{**REPORT["fields"][0], "error": "meant 'Sam'"}]}
    for refused in (with_answer, with_page_text, with_query, with_unknown_error):
        assert (await _send(refused)).status_code == 422, refused
    assert len(await _stored(database)) == 1
