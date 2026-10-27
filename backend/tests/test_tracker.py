"""
The Applications Tracker's own writes (KAN-413, docs/email_tracker.md):
the stage menu and Add Event against real Postgres. An event moves its
application forward and never back; the stage menu moves it anywhere from
applied on; and every stage past applied still counts as applied for the
Jobs page and the Applied button.
"""

import uuid

import httpx
import pytest
from sqlalchemy import text

from app.deps import get_current_account
from app.main import app
from app.models.dto import application_event_kind as kind
from app.models.dto import application_stage as stage
from app.queries.tracker import advance
from app.schemas.auth import AccountType, AuthenticatedAccount

pytestmark = pytest.mark.anyio

GREENHOUSE = "https://job-boards.greenhouse.io/acme/jobs/1"
INTERVIEW = {"kind": "interview", "title": "Technical Interview", "at": "2026-11-04T19:00:00Z"}


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


async def _seed_posting(database) -> str:
    async with database() as session:
        posting = await session.scalar(
            text(
                "INSERT INTO job_postings"
                " (id, title, status, company_name, apply_url, experience_level) VALUES"
                " (gen_random_uuid(), 'Intern', 'published', 'Acme', :url, 'student') RETURNING id"
            ),
            {"url": f"{GREENHOUSE}?{uuid.uuid4().hex}"},
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


async def _applied(client, database) -> str:
    job = await _seed_posting(database)
    assert (await client.post(f"/jobs/{job}/applied")).status_code == 200
    return job


# --- advance: pure, no database ---


def test_an_event_moves_its_application_forward_only():
    assert advance(stage.applied, kind.interview) == stage.interviewing
    assert advance(stage.saved, kind.offer) == stage.offer
    assert advance(stage.interviewing, kind.rejection) == stage.rejected
    # Never back, and nothing moves a rejected application but the menu
    assert advance(stage.offer, kind.interview) is None
    assert advance(stage.rejected, kind.offer) is None
    # An assessment or anything else leaves the stage alone
    assert advance(stage.applied, kind.assessment) is None
    assert advance(stage.applied, kind.other) is None


# --- The stage menu ---


async def test_the_stage_menu_moves_an_application_any_way_from_applied_on(student, database):
    client, me = student
    job = await _applied(client, database)

    for pick in ("offer", "interviewing", "rejected", "applied"):
        res = await client.put(f"/applicants/{me}/applications/{job}/stage", json={"stage": pick})
        assert res.status_code == 200
        assert res.json() == {"job_id": job, "stage": pick}
        assert (await _row(database, me, job))[0] == pick


async def test_a_saved_job_moved_on_by_hand_gets_dated(student, database):
    client, me = student
    job = await _seed_posting(database)
    await client.post(f"/jobs/{job}/saved")

    res = await client.put(f"/applicants/{me}/applications/{job}/stage", json={"stage": "interviewing"})
    assert res.status_code == 200
    stage_now, applied_at = await _row(database, me, job)
    assert stage_now == "interviewing" and applied_at is not None


async def test_the_stage_menu_never_offers_a_bookmark_or_the_queue(student, database):
    client, me = student
    job = await _applied(client, database)
    for pick in ("saved", "queued", "needs_you", "skipped"):
        res = await client.put(f"/applicants/{me}/applications/{job}/stage", json={"stage": pick})
        assert res.status_code == 422


async def test_a_stage_for_a_job_with_no_application_is_404(student, database):
    client, me = student
    job = await _seed_posting(database)
    res = await client.put(f"/applicants/{me}/applications/{job}/stage", json={"stage": "offer"})
    assert res.status_code == 404


async def test_another_students_tracker_is_403(student, database):
    client, _ = student
    job = await _seed_posting(database)
    other = uuid.uuid4()
    assert (await client.put(
        f"/applicants/{other}/applications/{job}/stage", json={"stage": "offer"}
    )).status_code == 403
    assert (await client.get(f"/applicants/{other}/events")).status_code == 403


# --- Every stage past applied is still applied ---


async def test_the_applied_button_never_moves_a_later_stage_back(student, database):
    client, me = student
    job = await _applied(client, database)
    await client.put(f"/applicants/{me}/applications/{job}/stage", json={"stage": "interviewing"})

    assert (await client.post(f"/jobs/{job}/applied")).status_code == 200
    assert (await _row(database, me, job))[0] == "interviewing"


async def test_the_jobs_page_hides_a_job_past_applied(student, database):
    client, me = student
    job = await _applied(client, database)
    await client.put(f"/applicants/{me}/applications/{job}/stage", json={"stage": "rejected"})

    res = await client.get("/jobs")
    assert job not in [listing["id"] for listing in res.json()]


# --- Add Event ---


async def test_an_interview_moves_an_applied_application_to_interviewing(student, database):
    client, me = student
    job = await _applied(client, database)

    res = await client.post(f"/applicants/{me}/applications/{job}/events", json={
        **INTERVIEW, "note": "  Bring the system design notes  ", "meeting_url": "https://zoom.us/j/1",
    })
    assert res.status_code == 201
    body = res.json()
    assert body["stage"] == "interviewing"
    assert body["event"]["kind"] == "interview"
    assert body["event"]["status"] == "accepted"
    assert body["event"]["source"] == "manual"
    assert body["event"]["note"] == "Bring the system design notes"
    assert body["event"]["on_day"] is None
    assert (await _row(database, me, job))[0] == "interviewing"


async def test_an_assessment_due_on_a_day_keeps_the_day_and_the_stage(student, database):
    client, me = student
    job = await _applied(client, database)

    res = await client.post(f"/applicants/{me}/applications/{job}/events", json={
        "kind": "assessment", "title": "CodeSignal", "on_day": "2026-11-03",
    })
    assert res.status_code == 201
    assert res.json()["stage"] == "applied"
    assert res.json()["event"]["on_day"] == "2026-11-03"
    assert res.json()["event"]["at"] is None


async def test_an_interview_never_moves_an_offer_back(student, database):
    client, me = student
    job = await _applied(client, database)
    await client.put(f"/applicants/{me}/applications/{job}/stage", json={"stage": "offer"})

    res = await client.post(f"/applicants/{me}/applications/{job}/events", json=INTERVIEW)
    assert res.json()["stage"] == "offer"


@pytest.mark.parametrize("body", [
    {"kind": "interview", "title": "Both", "at": "2026-11-04T19:00:00Z", "on_day": "2026-11-04"},
    {"kind": "interview", "title": "Neither"},
    {"kind": "interview", "title": "No zone", "at": "2026-11-04T19:00:00"},
    {"kind": "interview", "title": "   ", "on_day": "2026-11-04"},
    {"kind": "confirmation", "title": "Only from an email", "on_day": "2026-11-04"},
    {**INTERVIEW, "meeting_url": "javascript:alert(1)"},
])
async def test_add_event_refuses_a_bad_event(student, database, body):
    client, me = student
    job = await _applied(client, database)
    res = await client.post(f"/applicants/{me}/applications/{job}/events", json=body)
    assert res.status_code == 422


async def test_an_event_for_a_job_with_no_application_is_404(student, database):
    client, me = student
    job = await _seed_posting(database)
    res = await client.post(f"/applicants/{me}/applications/{job}/events", json=INTERVIEW)
    assert res.status_code == 404


async def test_events_list_soonest_first_and_a_day_before_that_days_times(student, database):
    client, me = student
    job = await _applied(client, database)
    url = f"/applicants/{me}/applications/{job}/events"
    await client.post(url, json={**INTERVIEW, "title": "Final", "at": "2026-11-10T15:00:00Z"})
    await client.post(url, json={**INTERVIEW, "title": "Phone Screen", "at": "2026-11-03T15:00:00Z"})
    await client.post(url, json={"kind": "assessment", "title": "CodeSignal", "on_day": "2026-11-03"})

    res = await client.get(f"/applicants/{me}/events")
    assert res.status_code == 200
    assert [e["title"] for e in res.json()] == ["CodeSignal", "Phone Screen", "Final"]
    assert {e["job_id"] for e in res.json()} == {job}


async def test_deleting_an_event_keeps_the_stage(student, database):
    client, me = student
    job = await _applied(client, database)
    added = (await client.post(f"/applicants/{me}/applications/{job}/events", json=INTERVIEW)).json()

    res = await client.delete(f"/applicants/{me}/events/{added['event']['id']}")
    assert res.status_code == 204
    assert (await client.get(f"/applicants/{me}/events")).json() == []
    assert (await _row(database, me, job))[0] == "interviewing"
    assert (await client.delete(f"/applicants/{me}/events/{added['event']['id']}")).status_code == 404


async def test_unsaving_a_job_deletes_its_events(student, database):
    client, me = student
    job = await _seed_posting(database)
    await client.post(f"/jobs/{job}/saved")
    await client.post(f"/applicants/{me}/applications/{job}/events", json={
        "kind": "other", "title": "Coffee chat", "on_day": "2026-11-01",
    })

    assert (await client.delete(f"/jobs/{job}/saved")).status_code == 204
    assert (await client.get(f"/applicants/{me}/events")).json() == []
