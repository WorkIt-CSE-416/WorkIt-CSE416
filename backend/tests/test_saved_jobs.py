"""
Saved jobs (KAN-261): the Save button's routes against real Postgres, and
how a saved job meets the Applied button and auto apply's queue. A saved job
is a job_applications row with no application yet, so both move it on and
neither ever moves a later stage back to saved.
"""

import uuid

import httpx
import pytest
from sqlalchemy import text

from app.deps import get_current_account
from app.main import app
from app.schemas.auth import AccountType, AuthenticatedAccount

pytestmark = pytest.mark.anyio

GREENHOUSE = "https://job-boards.greenhouse.io/acme/jobs/1"


async def _seed_applicant(database, applicant_id: uuid.UUID) -> None:
    async with database() as session:
        await session.execute(text("INSERT INTO auth.users (id) VALUES (:id)"), {"id": applicant_id})
        await session.execute(
            text(
                "INSERT INTO applicant_profiles (id, email, full_name)"
                " VALUES (:id, 'sam@example.com', 'Sam Seeker')"
            ),
            {"id": applicant_id},
        )
        await session.commit()


async def _seed_posting(database, status: str = "published") -> str:
    async with database() as session:
        posting = await session.scalar(
            text(
                # A listing reads experience_level, so the seed names one.
                "INSERT INTO job_postings"
                " (id, title, status, company_name, apply_url, experience_level) VALUES"
                " (gen_random_uuid(), 'Intern', :status, 'Acme', :url, 'student') RETURNING id"
            ),
            {"status": status, "url": f"{GREENHOUSE}?{uuid.uuid4().hex}"},
        )
        await session.commit()
    return str(posting)


async def _row(database, applicant_id: uuid.UUID, job_id: str):
    async with database() as session:
        return (
            await session.execute(
                text(
                    "SELECT stage, applied_at FROM job_applications"
                    " WHERE applicant_id = :a AND job_id = :j"
                ),
                {"a": applicant_id, "j": job_id},
            )
        ).first()


@pytest.fixture
async def student(database):
    applicant_id = uuid.uuid4()
    await _seed_applicant(database, applicant_id)
    app.dependency_overrides[get_current_account] = lambda: AuthenticatedAccount(
        id=applicant_id,
        email="sam@example.com",
        full_name="Sam Seeker",
        account_type=AccountType.APPLICANT,
        onboarding_completed=True,
    )
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        yield client, applicant_id
    app.dependency_overrides.pop(get_current_account, None)


async def test_save_keeps_the_job_undated_and_a_second_save_changes_nothing(student, database):
    client, me = student
    job = await _seed_posting(database)

    for _ in range(2):
        res = await client.post(f"/jobs/{job}/saved")
        assert res.status_code == 200
        assert res.json() == {"stage": "saved"}

    stage, applied_at = await _row(database, me, job)
    assert (stage, applied_at) == ("saved", None)


async def test_a_saved_job_stays_on_the_feed(student, database):
    client, _ = student
    job = await _seed_posting(database)
    await client.post(f"/jobs/{job}/saved")

    res = await client.get("/jobs")
    assert job in [listing["id"] for listing in res.json()]


async def test_saving_a_closed_job_is_404(student, database):
    client, me = student
    job = await _seed_posting(database, status="closed")

    assert (await client.post(f"/jobs/{job}/saved")).status_code == 404
    assert await _row(database, me, job) is None


async def test_unsave_deletes_the_row_and_is_204_when_never_saved(student, database):
    client, me = student
    job = await _seed_posting(database)
    await client.post(f"/jobs/{job}/saved")

    assert (await client.delete(f"/jobs/{job}/saved")).status_code == 204
    assert await _row(database, me, job) is None
    assert (await client.delete(f"/jobs/{job}/saved")).status_code == 204


async def test_applied_turns_a_saved_job_applied_and_save_never_moves_it_back(student, database):
    client, me = student
    job = await _seed_posting(database)
    await client.post(f"/jobs/{job}/saved")

    res = await client.post(f"/jobs/{job}/applied")
    assert res.status_code == 200
    assert res.json()["applied_at"] is not None

    # Saving or unsaving an applied job leaves it applied.
    assert (await client.post(f"/jobs/{job}/saved")).json() == {"stage": "applied"}
    assert (await client.delete(f"/jobs/{job}/saved")).status_code == 409
    stage, applied_at = await _row(database, me, job)
    assert stage == "applied" and applied_at is not None


async def test_auto_apply_queues_a_saved_job_and_lists_it_once(student, database):
    client, me = student
    job = await _seed_posting(database)
    await client.post(f"/jobs/{job}/saved")

    res = await client.post(f"/applicants/{me}/applications", json={"job_id": job})
    assert res.status_code == 200
    assert res.json()["stage"] == "queued"
    assert (await _row(database, me, job))[0] == "queued"

    listed = (await client.get(f"/applicants/{me}/applications?stage=queued")).json()
    assert [a["job"]["id"] for a in listed] == [job]
    # Saving a queued job keeps it queued.
    assert (await client.post(f"/jobs/{job}/saved")).json() == {"stage": "queued"}


async def test_the_board_reads_saved_and_applied_jobs(student, database):
    client, me = student
    saved, applied, queued = [await _seed_posting(database) for _ in range(3)]
    await client.post(f"/jobs/{saved}/saved")
    await client.post(f"/jobs/{applied}/applied")
    await client.post(f"/applicants/{me}/applications", json={"job_id": queued})

    res = await client.get(f"/applicants/{me}/applications?stage=saved&stage=applied")
    assert res.status_code == 200
    stages = {a["job"]["id"]: a["stage"] for a in res.json()}
    assert stages == {saved: "saved", applied: "applied"}


async def test_save_is_for_applicants_only(database):
    app.dependency_overrides[get_current_account] = lambda: AuthenticatedAccount(
        id=uuid.uuid4(),
        email="hr@example.com",
        full_name="Hal Recruiter",
        account_type=AccountType.COMPANY,
        onboarding_completed=True,
    )
    try:
        job = await _seed_posting(database)
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
            assert (await client.post(f"/jobs/{job}/saved")).status_code == 403
            assert (await client.delete(f"/jobs/{job}/saved")).status_code == 403
    finally:
        app.dependency_overrides.pop(get_current_account, None)
