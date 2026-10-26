"""
When an application was sent (KAN-369): applied_at is the time the student's
submit was recorded (auto apply's finish, or the Applied button), never the
time the job was queued. A queued or needs_you row has no date; one that
holds a stale date (written by an older insert's now() default) gets the
submit's time on finish, not the stale one.
"""

import uuid

import pytest
from sqlalchemy import text

from tests.test_saved_jobs import _row, _seed_posting, student  # noqa: F401  (fixture)

pytestmark = pytest.mark.anyio


async def _queue_with_stale_date(database, me: uuid.UUID, job: str) -> None:
    async with database() as session:
        await session.execute(
            text(
                "INSERT INTO job_applications (applicant_id, job_id, stage, applied_at, created_at)"
                " VALUES (:a, :j, 'queued', now() - interval '1 hour', now() - interval '1 hour')"
            ),
            {"a": me, "j": job},
        )
        await session.commit()


async def _now(database):
    async with database() as session:
        return await session.scalar(text("SELECT now()"))


async def test_a_queued_job_has_no_date_until_its_submit(student, database):  # noqa: F811
    client, me = student
    job = await _seed_posting(database)

    res = await client.post(f"/applicants/{me}/applications", json={"job_id": job})
    assert res.json()["stage"] == "queued"
    assert await _row(database, me, job) == ("queued", None)

    before = await _now(database)
    res = await client.post(f"/applicants/{me}/applications/{job}/finish", json={"outcome": "submitted"})
    assert res.json()["stage"] == "applied"
    stage, applied_at = await _row(database, me, job)
    assert stage == "applied" and applied_at >= before


async def test_finish_dates_the_submit_not_a_stale_queue_date(student, database):  # noqa: F811
    client, me = student
    job = await _seed_posting(database)
    await _queue_with_stale_date(database, me, job)

    before = await _now(database)
    res = await client.post(f"/applicants/{me}/applications/{job}/finish", json={"outcome": "submitted"})
    assert res.status_code == 200
    _, applied_at = await _row(database, me, job)
    assert applied_at >= before


async def test_the_applied_button_dates_a_queued_job_now(student, database):  # noqa: F811
    client, me = student
    job = await _seed_posting(database)
    await _queue_with_stale_date(database, me, job)

    before = await _now(database)
    assert (await client.post(f"/jobs/{job}/applied")).status_code == 200
    stage, applied_at = await _row(database, me, job)
    assert stage == "applied" and applied_at >= before

    # A second click keeps the first date.
    await client.post(f"/jobs/{job}/applied")
    assert (await _row(database, me, job))[1] == applied_at


async def test_a_skipped_or_needs_you_row_shows_no_date(student, database):  # noqa: F811
    client, me = student
    job = await _seed_posting(database)
    await _queue_with_stale_date(database, me, job)

    await client.post(f"/applicants/{me}/applications/{job}/finish", json={"outcome": "skipped"})
    assert await _row(database, me, job) == ("skipped", None)


async def test_unsubmitted_sets_an_applied_application_back_with_no_date(student, database):  # noqa: F811
    # The panel's "I didn't submit this" (KAN-401): a submit WorkIt marked by mistake.
    client, me = student
    job = await _seed_posting(database)
    await client.post(f"/applicants/{me}/applications", json={"job_id": job})
    await client.post(f"/applicants/{me}/applications/{job}/finish", json={"outcome": "submitted"})

    res = await client.post(f"/applicants/{me}/applications/{job}/finish", json={"outcome": "unsubmitted"})
    assert res.status_code == 200 and res.json()["stage"] == "queued"
    assert await _row(database, me, job) == ("queued", None)

    # Only an applied application can be set back.
    res = await client.post(f"/applicants/{me}/applications/{job}/finish", json={"outcome": "unsubmitted"})
    assert res.status_code == 409
