"""
GET and POST .../notifications (KAN-298), against real Postgres --
tests/test_database_smoke.py is the pattern: seed rows, call the route,
read them back.
"""

import uuid

import httpx
import pytest
from sqlalchemy import text

from app.deps import get_current_account
from app.main import app
from app.models.notification import Notification
from app.schemas.auth import AccountType, AuthenticatedAccount

pytestmark = pytest.mark.anyio


async def _seed_applicant(session, applicant_id: uuid.UUID) -> None:
    await session.execute(text("INSERT INTO auth.users (id) VALUES (:id)"), {"id": applicant_id})
    await session.execute(
        text(
            "INSERT INTO applicant_profiles (id, email, full_name)"
            " VALUES (:id, 'sam@example.com', 'Sam Seeker')"
        ),
        {"id": applicant_id},
    )
    await session.commit()


def _client(applicant_id: uuid.UUID) -> httpx.AsyncClient:
    app.dependency_overrides[get_current_account] = lambda: AuthenticatedAccount(
        id=applicant_id,
        email="sam@example.com",
        full_name="Sam Seeker",
        account_type=AccountType.APPLICANT,
        onboarding_completed=True,
    )
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test")


async def test_notifications_list_newest_first_with_unread_count(database):
    applicant_id = uuid.uuid4()
    async with database() as session:
        await _seed_applicant(session, applicant_id)
        session.add_all(
            [
                Notification(
                    applicant_id=applicant_id, type="job_alert", title="Older",
                    body="older digest", data=[],
                ),
                Notification(
                    applicant_id=applicant_id, type="job_alert", title="Newer",
                    body="newer digest", data=[],
                ),
            ]
        )
        await session.commit()

    try:
        async with _client(applicant_id) as client:
            res = await client.get(f"/applicants/{applicant_id}/notifications")
    finally:
        app.dependency_overrides.pop(get_current_account, None)

    assert res.status_code == 200
    body = res.json()
    assert body["unread_count"] == 2
    assert [n["title"] for n in body["notifications"]] == ["Newer", "Older"]


async def test_read_notifications_marks_every_unread_row_read(database):
    applicant_id = uuid.uuid4()
    async with database() as session:
        await _seed_applicant(session, applicant_id)
        session.add(
            Notification(
                applicant_id=applicant_id, type="job_alert", title="Digest",
                body="a digest", data=[],
            )
        )
        await session.commit()

    try:
        async with _client(applicant_id) as client:
            res = await client.post(f"/applicants/{applicant_id}/notifications/read")
    finally:
        app.dependency_overrides.pop(get_current_account, None)

    assert res.status_code == 200
    body = res.json()
    assert body["unread_count"] == 0
    assert body["notifications"][0]["read_at"] is not None


async def test_notifications_are_scoped_to_their_own_applicant(database):
    mine, someone_elses = uuid.uuid4(), uuid.uuid4()
    async with database() as session:
        await _seed_applicant(session, mine)
        await _seed_applicant(session, someone_elses)
        session.add(
            Notification(
                applicant_id=someone_elses, type="job_alert", title="Not Mine",
                body="not mine", data=[],
            )
        )
        await session.commit()

    try:
        async with _client(mine) as client:
            res = await client.get(f"/applicants/{mine}/notifications")
    finally:
        app.dependency_overrides.pop(get_current_account, None)

    assert res.status_code == 200
    assert res.json() == {"notifications": [], "unread_count": 0}


async def test_notifications_route_refuses_a_different_applicant(database):
    mine, someone_elses = uuid.uuid4(), uuid.uuid4()
    async with database() as session:
        await _seed_applicant(session, mine)
        await _seed_applicant(session, someone_elses)

    try:
        async with _client(mine) as client:
            res = await client.get(f"/applicants/{someone_elses}/notifications")
    finally:
        app.dependency_overrides.pop(get_current_account, None)

    assert res.status_code == 403
