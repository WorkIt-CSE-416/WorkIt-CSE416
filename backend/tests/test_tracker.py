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

from app.deps import get_current_account, get_signed_in_applicant_id
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
    # The feed (GET /jobs) finds its viewer from the token itself, not from
    # the account: without this it served the student as signed out and
    # left their applied jobs in.
    app.dependency_overrides[get_signed_in_applicant_id] = lambda: applicant_id
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        yield client, applicant_id
    app.dependency_overrides.pop(get_current_account, None)
    app.dependency_overrides.pop(get_signed_in_applicant_id, None)


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


# --- Updates: proposed events, Accept and Dismiss ---


async def _propose(database, applicant_id, job_id, kind="interview", title="Interview invite") -> str:
    """A proposed event as the email tracker will write one; job_id None is
    an email that matched no application."""
    async with database() as session:
        event_id = await session.scalar(
            text(
                "INSERT INTO application_events"
                " (applicant_id, job_id, kind, status, source, title, at)"
                " VALUES (:a, :j, :k, 'proposed', 'gmail', :t, '2026-11-04T19:00:00Z') RETURNING id"
            ),
            {"a": applicant_id, "j": job_id, "k": kind, "t": title},
        )
        await session.commit()
    return str(event_id)


async def test_proposed_events_are_listed_apart_from_the_tracker(student, database):
    client, me = student
    job = await _applied(client, database)
    matched = await _propose(database, me, job)
    unmatched = await _propose(database, me, None, title="Thanks for applying")

    res = await client.get(f"/applicants/{me}/events", params={"status": "proposed"})
    assert res.status_code == 200
    # Newest first, the unmatched one with no job
    assert [(e["id"], e["job_id"]) for e in res.json()] == [(unmatched, None), (matched, job)]
    assert (await client.get(f"/applicants/{me}/events")).json() == []


async def test_accepting_an_update_moves_its_application_forward(student, database):
    client, me = student
    job = await _applied(client, database)
    event = await _propose(database, me, job)

    res = await client.post(f"/applicants/{me}/events/{event}/accept")
    assert res.status_code == 200
    assert res.json()["stage"] == "interviewing"
    assert res.json()["event"]["status"] == "accepted"
    assert [e["id"] for e in (await client.get(f"/applicants/{me}/events")).json()] == [event]
    # Decided once
    assert (await client.post(f"/applicants/{me}/events/{event}/accept")).status_code == 409
    assert (await client.post(f"/applicants/{me}/events/{event}/dismiss")).status_code == 409


async def test_wrong_job_and_couldnt_match_accept_onto_the_picked_application(student, database):
    client, me = student
    matched_to = await _applied(client, database)
    picked = await _applied(client, database)
    wrong = await _propose(database, me, matched_to)
    unmatched = await _propose(database, me, None, kind="rejection")

    res = await client.post(f"/applicants/{me}/events/{wrong}/accept", json={"job_id": picked})
    assert res.json()["event"]["job_id"] == picked
    assert (await _row(database, me, picked))[0] == "interviewing"
    assert (await _row(database, me, matched_to))[0] == "applied"

    # An unmatched update needs a pick, and only one of the student's own
    assert (await client.post(f"/applicants/{me}/events/{unmatched}/accept")).status_code == 422
    stranger = await _seed_posting(database)
    res = await client.post(f"/applicants/{me}/events/{unmatched}/accept", json={"job_id": stranger})
    assert res.status_code == 422
    res = await client.post(f"/applicants/{me}/events/{unmatched}/accept", json={"job_id": picked})
    assert res.json()["stage"] == "rejected"


async def test_dismissing_an_update_keeps_it_off_the_tracker(student, database):
    client, me = student
    job = await _applied(client, database)
    event = await _propose(database, me, job, kind="offer")

    assert (await client.post(f"/applicants/{me}/events/{event}/dismiss")).status_code == 204
    assert (await client.get(f"/applicants/{me}/events")).json() == []
    assert (await client.get(f"/applicants/{me}/events", params={"status": "proposed"})).json() == []
    assert (await _row(database, me, job))[0] == "applied"


async def test_another_students_update_is_404(student, database):
    client, me = student
    other = uuid.uuid4()
    await _seed_applicant_named(database, other)
    job = await _seed_posting(database)
    async with database() as session:
        await session.execute(
            text("INSERT INTO job_applications (applicant_id, job_id) VALUES (:a, :j)"),
            {"a": other, "j": job},
        )
        await session.commit()
    theirs = await _propose(database, other, job)
    assert (await client.post(f"/applicants/{me}/events/{theirs}/accept")).status_code == 404
    assert (await client.post(f"/applicants/{me}/events/{theirs}/dismiss")).status_code == 404


async def _seed_applicant_named(database, applicant_id: uuid.UUID) -> None:
    async with database() as session:
        await session.execute(text("INSERT INTO auth.users (id) VALUES (:id)"), {"id": applicant_id})
        await session.execute(
            text(
                "INSERT INTO applicant_profiles (id, email, full_name)"
                " VALUES (:id, :email, 'Other Seeker')"
            ),
            {"id": applicant_id, "email": f"{applicant_id.hex[:8]}@example.com"},
        )
        await session.commit()


# --- The Inbox: emails and auto-filing ---


def test_only_an_email_that_would_move_its_application_needs_review():
    from app.queries.tracker import needs_review

    assert needs_review(stage.applied, kind.interview)
    assert needs_review(stage.saved, kind.rejection)
    assert needs_review(None, kind.confirmation)  # matched no application
    assert not needs_review(stage.applied, kind.confirmation)
    assert not needs_review(stage.applied, kind.assessment)
    assert not needs_review(stage.applied, kind.other)
    assert not needs_review(stage.offer, kind.interview)  # already past it


async def test_filing_an_email_files_or_asks_and_never_moves_a_stage(student, database):
    import datetime

    from app.queries.tracker import NewEvent, file_email

    client, me = student
    job = await _applied(client, database)

    def new(k):
        return NewEvent(kind=k, title=f"About {k}", at=datetime.datetime.now(datetime.UTC),
                        on_day=None, note=None, meeting_url=None)

    async with database() as session:
        filed = await file_email(session, me, uuid.UUID(job), new(kind.confirmation))
        asks = await file_email(session, me, uuid.UUID(job), new(kind.interview))
        stranger = await file_email(session, me, uuid.UUID(await _seed_posting(database)), new(kind.offer))
    assert filed.status.value == "accepted"
    assert asks.status.value == "proposed"
    # A job with no application of the student's is no match
    assert stranger.job_id is None and stranger.status.value == "proposed"
    assert (await _row(database, me, job))[0] == "applied"


async def test_the_inbox_lists_every_email_whatever_its_status(student, database):
    client, me = student
    job = await _applied(client, database)
    waiting = await _propose(database, me, job)
    dismissed = await _propose(database, me, job, kind="other", title="Hello")
    await client.post(f"/applicants/{me}/events/{dismissed}/dismiss")
    # A typed event is not an email
    await client.post(f"/applicants/{me}/applications/{job}/events", json=INTERVIEW)

    res = await client.get(f"/applicants/{me}/emails")
    assert res.status_code == 200
    assert {(e["id"], e["status"]) for e in res.json()} == {(waiting, "proposed"), (dismissed, "dismissed")}


async def test_an_emails_event_is_never_deleted(student, database):
    client, me = student
    job = await _applied(client, database)
    event = await _propose(database, me, job)
    await client.post(f"/applicants/{me}/events/{event}/accept")

    # It shows in Interviews & Dates once accepted, but stays a record
    assert (await client.delete(f"/applicants/{me}/events/{event}")).status_code == 404
    assert [e["id"] for e in (await client.get(f"/applicants/{me}/emails")).json()] == [event]


# --- read state (KAN-427) ---


async def _read_at(client, me) -> dict[str, str | None]:
    return {e["id"]: e["read_at"] for e in (await client.get(f"/applicants/{me}/emails")).json()}


async def test_an_email_arrives_unread_and_marks_read_and_unread(student, database):
    client, me = student
    job = await _applied(client, database)
    first = await _propose(database, me, job)
    second = await _propose(database, me, job, kind="other", title="Hello")
    assert await _read_at(client, me) == {first: None, second: None}

    body = {"ids": [first, second], "read": True}
    assert (await client.put(f"/applicants/{me}/emails/read", json=body)).status_code == 204
    read = await _read_at(client, me)
    assert read[first] and read[second]

    # Read again keeps the first time; unread clears only what it names
    await client.put(f"/applicants/{me}/emails/read", json={"ids": [first], "read": True})
    assert (await _read_at(client, me))[first] == read[first]
    await client.put(f"/applicants/{me}/emails/read", json={"ids": [first], "read": False})
    assert await _read_at(client, me) == {first: None, second: read[second]}


async def test_deciding_on_an_email_reads_it(student, database):
    client, me = student
    job = await _applied(client, database)
    accepted = await _propose(database, me, job)
    dismissed = await _propose(database, me, job, kind="other", title="Hello")
    await client.post(f"/applicants/{me}/events/{accepted}/accept")
    await client.post(f"/applicants/{me}/events/{dismissed}/dismiss")
    assert all((await _read_at(client, me)).values())


async def test_marking_read_is_all_or_none_and_only_the_students_emails(student, database):
    client, me = student
    job = await _applied(client, database)
    mine = await _propose(database, me, job)
    other = uuid.uuid4()
    await _seed_applicant_named(database, other)
    async with database() as session:
        await session.execute(
            text("INSERT INTO job_applications (applicant_id, job_id) VALUES (:a, :j)"),
            {"a": other, "j": job},
        )
        await session.commit()
    theirs = await _propose(database, other, job)

    body = {"ids": [mine, theirs], "read": True}
    assert (await client.put(f"/applicants/{me}/emails/read", json=body)).status_code == 404
    assert await _read_at(client, me) == {mine: None}
    # A typed event is not an email either
    added = (await client.post(f"/applicants/{me}/applications/{job}/events", json=INTERVIEW)).json()
    body = {"ids": [added["event"]["id"]], "read": True}
    assert (await client.put(f"/applicants/{me}/emails/read", json=body)).status_code == 404
    assert (await client.put(f"/applicants/{me}/emails/read", json={"ids": [], "read": True})).status_code == 422
