"""
WorkIt Desktop's queue (KAN-323, auto-apply/desktop.md) against real
Postgres: the claim, its stale requeue, each stage move and its 409, the
review, the approval and the heartbeat. Layer 2 is called directly; the
routes once end to end at the end, owner checks included.
"""

import asyncio
import uuid
from datetime import UTC, datetime, timedelta

import httpx
import pytest
from sqlalchemy import text

from app.auto_apply import pipeline, queries
from app.deps import get_current_account
from app.main import app
from app.models.dto import application_stage
from app.schemas.applications import DesktopBeat, Review, ReviewAnswer
from app.schemas.auth import AccountType, AuthenticatedAccount

pytestmark = pytest.mark.anyio

GREENHOUSE = "https://job-boards.greenhouse.io/acme/jobs/1"


async def _seed_applicant(database) -> uuid.UUID:
    applicant_id = uuid.uuid4()
    async with database() as session:
        await session.execute(text("INSERT INTO auth.users (id) VALUES (:id)"), {"id": applicant_id})
        await session.execute(
            text(
                "INSERT INTO applicant_profiles (id, email, full_name)"
                " VALUES (:id, :email, 'Sam Seeker')"
            ),
            {"id": applicant_id, "email": f"{applicant_id.hex}@example.com"},
        )
        await session.commit()
    return applicant_id


async def _seed_application(
    database, applicant_id: uuid.UUID, stage: str = "queued", *, age: int = 0, status: str = "published"
) -> uuid.UUID:
    """A Greenhouse job posting and this applicant's application to it at
    `stage`, made `age` minutes ago (older is first in the queue)."""
    async with database() as session:
        job_id = await session.scalar(
            text(
                "INSERT INTO job_postings"
                " (id, title, status, company_name, apply_url, experience_level) VALUES"
                " (gen_random_uuid(), 'Intern', :status, 'Acme', :url, 'student') RETURNING id"
            ),
            {"status": status, "url": f"{GREENHOUSE}?{uuid.uuid4().hex}"},
        )
        await session.execute(
            text(
                "INSERT INTO job_applications (applicant_id, job_id, stage, created_at, applied_at)"
                " VALUES (:a, :j, CAST(:stage AS application_stage),"
                " now() - make_interval(mins => :age),"
                # an applied row is always dated (job_applications_applied_dated)
                " CASE WHEN :stage = 'applied' THEN now() END)"
            ),
            {"a": applicant_id, "j": job_id, "stage": stage, "age": age},
        )
        await session.commit()
    return job_id


async def _stage(database, applicant_id: uuid.UUID, job_id: uuid.UUID) -> application_stage:
    async with database() as session:
        return await queries.fetch_stage(session, applicant_id, job_id)


async def _beat(
    database, applicant_id: uuid.UUID, ago: timedelta, instance: uuid.UUID | None = None
) -> None:
    """A Desktop heartbeat `ago` in the past, from Desktop run `instance`."""
    async with database() as session:
        await queries.save_beat(session, applicant_id, BEAT.model_copy(update={"instance": instance}))
        await session.execute(
            text("UPDATE desktop_heartbeats SET last_seen = now() - CAST(:ago AS interval) WHERE applicant_id = :a"),
            {"ago": ago, "a": applicant_id},
        )
        await session.commit()


BEAT = DesktopBeat(workers=4, busy=2, usage={"five_hour": 0.4, "weekly": 0.1}, version="0.1.0")


def _review(answer: str = "Yes") -> Review:
    return Review(
        answers=[
            ReviewAnswer(question="Are you authorized to work in the US?", answer=answer, source="answer_bank"),
            ReviewAnswer(
                question="Why Acme?", answer="I built a queue.", source="written",
                essay=True, facts=["Built WorkIt's queue"],
            ),
        ],
        resume={"name": "General SWE", "sent_resume_id": None},
        cover_letter=None,
        flags=["missing fact"],
        note="Filled 2 questions.",
        filled_at=datetime(2026, 10, 22, 3, 0, tzinfo=UTC),
    )


# --- claim ---


async def test_claim_takes_the_oldest_open_queued_first(database):
    me = await _seed_applicant(database)
    newer = await _seed_application(database, me, age=1)
    older = await _seed_application(database, me, age=5)
    await _seed_application(database, me, age=9, status="closed")  # its page is gone
    await _seed_application(database, me, "needs_you", age=9)
    other = await _seed_applicant(database)
    await _seed_application(database, other, age=20)  # another applicant's
    await _beat(database, me, timedelta(0))  # Desktop beats before it claims

    async with database() as session:
        claimed = await pipeline.claim_applications(session, me, 10)

    assert [uuid.UUID(a.job.id) for a in claimed] == [older, newer]
    assert {a.stage for a in claimed} == {application_stage.filling}
    assert await _stage(database, me, older) == application_stage.filling
    async with database() as session:
        assert await pipeline.claim_applications(session, me, 10) == []  # none left


async def test_claim_takes_at_most_n(database):
    me = await _seed_applicant(database)
    for age in range(3):
        await _seed_application(database, me, age=age)
    async with database() as session:
        assert len(await pipeline.claim_applications(session, me, 2)) == 2


async def test_a_claim_passes_over_rows_another_claim_holds(database):
    # The first claim hasn't committed; the second neither waits for it nor
    # takes its rows (SKIP LOCKED).
    me = await _seed_applicant(database)
    first = await _seed_application(database, me, age=5)
    second = await _seed_application(database, me, age=1)
    async with database() as holding, database() as other:
        held = await queries.claim_queued(holding, me, 1)
        taken = await asyncio.wait_for(queries.claim_queued(other, me, 1), timeout=5)
        await other.commit()
        await holding.commit()
    assert [uuid.UUID(a.job.id) for a in held] == [first]
    assert [uuid.UUID(a.job.id) for a in taken] == [second]


async def test_concurrent_claims_never_return_the_same_job(database):
    me = await _seed_applicant(database)
    jobs = {await _seed_application(database, me, age=a) for a in range(8)}

    async def claim():
        async with database() as session:
            return [uuid.UUID(a.job.id) for a in await pipeline.claim_applications(session, me, 3)]

    batches = await asyncio.gather(*(claim() for _ in range(4)))

    claimed = [job for batch in batches for job in batch]
    assert len(claimed) == len(set(claimed)) == len(jobs)  # 4 × 3 asked, 8 there


async def test_claim_requeues_filling_whose_desktop_went_silent(database):
    me = await _seed_applicant(database)
    stranded = await _seed_application(database, me, "filling", age=30)
    await _beat(database, me, timedelta(minutes=11))

    async with database() as session:
        claimed = await pipeline.claim_applications(session, me, 1)

    # Back in the queue with its place kept, so it is taken again first.
    assert [uuid.UUID(a.job.id) for a in claimed] == [stranded]


async def test_claim_requeues_filling_when_desktop_never_beat(database):
    me = await _seed_applicant(database)
    stranded = await _seed_application(database, me, "filling")
    async with database() as session:
        assert await queries.requeue_stale(session, me) == {stranded}


async def test_claim_leaves_filling_while_desktop_beats(database):
    me = await _seed_applicant(database)
    busy = await _seed_application(database, me, "filling")
    await _beat(database, me, timedelta(minutes=9))
    async with database() as session:
        assert await pipeline.claim_applications(session, me, 10) == []
    assert await _stage(database, me, busy) == application_stage.filling


async def _claimed(database, applicant_id: uuid.UUID, job_id: uuid.UUID, ago: timedelta) -> None:
    """Backdates this application's claim by `ago`."""
    async with database() as session:
        await session.execute(
            text("UPDATE job_applications SET claimed_at = now() - CAST(:ago AS interval)"
                 " WHERE applicant_id = :a AND job_id = :j"),
            {"ago": ago, "a": applicant_id, "j": job_id},
        )
        await session.commit()


async def test_a_restarted_desktop_takes_back_what_its_last_run_held(database):
    me, first, second = await _seed_applicant(database), uuid.uuid4(), uuid.uuid4()
    job = await _seed_application(database, me)
    await _beat(database, me, timedelta(0), first)
    async with database() as session:
        assert len(await pipeline.claim_applications(session, me, 1)) == 1
        # The same run claiming again leaves it filling.
        assert await pipeline.claim_applications(session, me, 1) == []

    await _beat(database, me, timedelta(0), second)  # restarted seconds later
    async with database() as session:
        claimed = await pipeline.claim_applications(session, me, 1)
    assert [uuid.UUID(a.job.id) for a in claimed] == [job]


async def test_a_lease_that_ran_out_goes_back_while_desktop_beats(database):
    me, run = await _seed_applicant(database), uuid.uuid4()
    lost = await _seed_application(database, me, age=2)
    held = await _seed_application(database, me, age=1)
    await _beat(database, me, timedelta(0), run)
    async with database() as session:
        assert len(await pipeline.claim_applications(session, me, 2)) == 2
    # Its review never reached WorkIt: 31 minutes on, it is queued again.
    await _claimed(database, me, lost, timedelta(minutes=31))
    async with database() as session:
        assert await queries.requeue_stale(session, me) == {lost}
        await session.commit()
    assert await _stage(database, me, held) == application_stage.filling


async def test_a_desktop_without_an_instance_keeps_its_claims(database):
    me = await _seed_applicant(database)
    await _seed_application(database, me)
    await _beat(database, me, timedelta(0))
    async with database() as session:
        assert len(await pipeline.claim_applications(session, me, 1)) == 1
        assert await queries.requeue_stale(session, me) == set()


# --- claim-approved ---


async def test_claim_approved_takes_each_approved_once(database):
    me, run = await _seed_applicant(database), uuid.uuid4()
    older = await _seed_application(database, me, "approved", age=2)
    newer = await _seed_application(database, me, "approved", age=1)
    await _seed_application(database, me, "review")
    await _beat(database, me, timedelta(0), run)
    async with database() as session:
        claimed = await pipeline.claim_approved_applications(session, me, 10)
    assert [uuid.UUID(a.job.id) for a in claimed] == [older, newer]
    assert {a.stage for a in claimed} == {application_stage.submitting}
    async with database() as session:
        assert await pipeline.claim_approved_applications(session, me, 10) == []  # never twice


async def test_concurrent_approved_claims_never_return_the_same_job(database):
    me = await _seed_applicant(database)
    jobs = [await _seed_application(database, me, "approved", age=i) for i in range(5)]
    await _beat(database, me, timedelta(0), uuid.uuid4())

    async def claim():
        async with database() as session:
            return [uuid.UUID(a.job.id) for a in await pipeline.claim_approved_applications(session, me, 2)]

    claimed = [job for batch in await asyncio.gather(*(claim() for _ in range(4))) for job in batch]
    assert len(claimed) == len(set(claimed)) == len(jobs)


async def test_a_restart_never_submits_again_it_goes_to_needs_you(database):
    me, first, second = await _seed_applicant(database), uuid.uuid4(), uuid.uuid4()
    job = await _seed_application(database, me, "approved")
    await _beat(database, me, timedelta(0), first)
    async with database() as session:
        assert len(await pipeline.claim_approved_applications(session, me, 1)) == 1
        # The same run claiming again leaves it submitting.
        assert await pipeline.claim_approved_applications(session, me, 1) == []
    assert await _stage(database, me, job) == application_stage.submitting

    await _beat(database, me, timedelta(0), second)  # restarted: its form may have gone
    async with database() as session:
        assert await pipeline.claim_approved_applications(session, me, 1) == []
    assert await _stage(database, me, job) == application_stage.needs_you


async def test_a_silent_desktops_submit_goes_to_needs_you(database):
    me = await _seed_applicant(database)
    job = await _seed_application(database, me, "approved")
    await _beat(database, me, timedelta(0))
    async with database() as session:
        assert len(await pipeline.claim_approved_applications(session, me, 1)) == 1
    await _beat(database, me, timedelta(minutes=11))
    async with database() as session:
        assert await queries.strand_submitting(session, me) == {job}
        await session.commit()
    assert await _stage(database, me, job) == application_stage.needs_you


async def test_two_approvals_at_once_move_it_once(database):
    me = await _seed_applicant(database)
    job = await _seed_application(database, me, "filling")
    async with database() as session:
        await pipeline.submit_review(session, me, job, _review())

    async def approve():
        async with database() as session:
            try:
                return await pipeline.approve_application(session, me, job)
            except pipeline.WrongStage:
                return "409"

    results = await asyncio.gather(approve(), approve())
    assert sorted(map(str, results)) == ["409", "approved"]


# --- review, approve, finish ---


async def test_review_round_trip(database):
    me = await _seed_applicant(database)
    job = await _seed_application(database, me, "filling")
    async with database() as session:
        assert await pipeline.submit_review(session, me, job, _review()) == application_stage.review
    async with database() as session:
        assert await pipeline.get_review(session, me, job) == _review()
    assert await _stage(database, me, job) == application_stage.review


async def test_review_needs_filling(database):
    me = await _seed_applicant(database)
    for stage in ("queued", "review", "approved", "applied", "saved"):
        job = await _seed_application(database, me, stage)
        async with database() as session:
            with pytest.raises(pipeline.WrongStage):
                await pipeline.submit_review(session, me, job, _review())
    async with database() as session:
        with pytest.raises(pipeline.NotFound):
            await pipeline.submit_review(session, me, uuid.uuid4(), _review())


async def test_get_review_without_one_is_not_found(database):
    me = await _seed_applicant(database)
    job = await _seed_application(database, me, "filling")
    async with database() as session:
        with pytest.raises(pipeline.NotFound):
            await pipeline.get_review(session, me, job)


async def test_approve_keeps_the_edited_answers_and_the_review_its_own(database):
    me = await _seed_applicant(database)
    job = await _seed_application(database, me, "filling")
    async with database() as session:
        await pipeline.submit_review(session, me, job, _review())
    edited = [ReviewAnswer(question="Are you authorized to work in the US?", answer="No", source="profile")]

    async with database() as session:
        assert await pipeline.approve_application(session, me, job, edited) == application_stage.approved

    async with database() as session:
        review = await pipeline.get_review(session, me, job)
        kept = await session.scalar(
            text("SELECT review -> 'answers' -> 0 ->> 'answer' FROM application_reviews WHERE job_id = :j"),
            {"j": job},
        )
    assert review.answers == edited
    assert review.note == "Filled 2 questions."  # the rest is Desktop's
    assert kept == "Yes"  # what Desktop wrote stays


async def test_approve_with_no_answers_keeps_the_reviews(database):
    me = await _seed_applicant(database)
    job = await _seed_application(database, me, "filling")
    async with database() as session:
        await pipeline.submit_review(session, me, job, _review())
    async with database() as session:
        await pipeline.approve_application(session, me, job, [])
    async with database() as session:
        assert (await pipeline.get_review(session, me, job)).answers == _review().answers
    assert await _stage(database, me, job) == application_stage.approved


async def test_approve_needs_review(database):
    me = await _seed_applicant(database)
    for stage in ("queued", "filling", "approved", "applied"):
        job = await _seed_application(database, me, stage)
        async with database() as session:
            with pytest.raises(pipeline.WrongStage):
                await pipeline.approve_application(session, me, job, [])
    async with database() as session:
        with pytest.raises(pipeline.NotFound):
            await pipeline.approve_application(session, me, uuid.uuid4(), [])


@pytest.mark.parametrize(
    ("stage", "outcome", "after"),
    [
        ("filling", "failed", application_stage.needs_you),
        ("filling", "skipped", application_stage.skipped),
        ("review", "skipped", application_stage.skipped),
        ("approved", "submitted", application_stage.applied),
        ("approved", "failed", application_stage.needs_you),
        ("submitting", "submitted", application_stage.applied),
        ("submitting", "failed", application_stage.needs_you),
        ("submitting", "skipped", application_stage.skipped),
    ],
)
async def test_finish_from_desktops_stages(database, stage, outcome, after):
    me = await _seed_applicant(database)
    job = await _seed_application(database, me, stage)
    async with database() as session:
        assert await pipeline.finish_application(session, me, job, outcome, "why") == after
    assert await _stage(database, me, job) == after


@pytest.mark.parametrize("stage", ["saved", "skipped", "applied"])
async def test_finish_past_the_fill_is_wrong_stage(database, stage):
    me = await _seed_applicant(database)
    job = await _seed_application(database, me, stage)
    async with database() as session:
        with pytest.raises(pipeline.WrongStage):
            await pipeline.finish_application(session, me, job, "submitted")


@pytest.mark.parametrize(
    ("stage", "resumable"),
    [("filling", True), ("approved", True), ("submitting", True), ("review", False), ("saved", False)],
)
async def test_resume_from_desktops_fills_only(database, monkeypatch, stage, resumable):
    me = await _seed_applicant(database)
    job = await _seed_application(database, me, stage)

    async def no_resume(*args):
        return None

    monkeypatch.setattr(pipeline, "pick_resume", no_resume)
    async with database() as session:
        if resumable:
            assert await pipeline.prepare_resume(session, None, me, job) is None
        else:
            with pytest.raises(pipeline.WrongStage):
                await pipeline.prepare_resume(session, None, me, job)


async def test_dequeueing_deletes_the_review_with_it(database):
    me = await _seed_applicant(database)
    job = await _seed_application(database, me, "filling")
    async with database() as session:
        await pipeline.submit_review(session, me, job, _review())
        await session.execute(text("DELETE FROM job_applications WHERE job_id = :j"), {"j": job})
        await session.commit()
        assert await queries.fetch_review(session, me, job) is None


# --- the heartbeat ---


async def test_desktop_is_offline_until_it_beats(database):
    me = await _seed_applicant(database)
    async with database() as session:
        status = await pipeline.desktop_status(session, me)
    assert status.model_dump() == {
        "online": False, "last_seen": None, "workers": 0, "busy": 0, "usage": None,
    }


async def test_a_beat_is_online_and_overwrites_the_last(database):
    me = await _seed_applicant(database)
    async with database() as session:
        await pipeline.desktop_beat(session, me, BEAT)
    async with database() as session:
        status = await pipeline.desktop_beat(session, me, DesktopBeat(workers=2, busy=0, version="0.1.1"))
    assert (status.online, status.workers, status.busy, status.usage) == (True, 2, 0, None)
    async with database() as session:
        assert (await pipeline.desktop_status(session, me)).online


async def test_desktop_is_offline_45_seconds_after_its_last_beat(database):
    me = await _seed_applicant(database)
    await _beat(database, me, timedelta(seconds=46))
    async with database() as session:
        status = await pipeline.desktop_status(session, me)
    assert not status.online
    assert (status.workers, status.busy, status.usage.five_hour) == (4, 2, 0.4)


# --- the routes, end to end ---


@pytest.fixture
async def student(database):
    applicant_id = await _seed_applicant(database)
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


async def test_desktop_routes_from_claim_to_applied(student, database):
    client, me = student
    job = await _seed_application(database, me)
    base = f"/applicants/{me}"

    beat = await client.put(f"{base}/desktop", json=BEAT.model_dump())
    assert (beat.status_code, beat.json()["online"]) == (200, True)
    claimed = await client.post(f"{base}/applications/claim", json={"n": 2})
    assert [(a["job"]["id"], a["stage"]) for a in claimed.json()] == [(str(job), "filling")]

    review = _review().model_dump(mode="json")
    assert (await client.put(f"{base}/applications/{job}/review", json=review)).json()["stage"] == "review"
    assert (await client.put(f"{base}/applications/{job}/review", json=review)).status_code == 409
    assert (await client.get(f"{base}/applications/{job}/review")).json() == review
    edited = [{**review["answers"][0], "answer": "No"}]
    approved = await client.post(f"{base}/applications/{job}/approve", json={"answers": edited})
    assert approved.json() == {"job_id": str(job), "stage": "approved"}
    assert (await client.get(f"{base}/applications/{job}/review")).json()["answers"][0]["answer"] == "No"
    assert (await client.post(f"{base}/applications/{job}/approve", json={"answers": []})).status_code == 409
    taken = await client.post(f"{base}/applications/claim-approved", json={"n": 2})
    assert [(a["job"]["id"], a["stage"]) for a in taken.json()] == [(str(job), "submitting")]
    assert (await client.post(f"{base}/applications/claim-approved", json={"n": 2})).json() == []
    finished = await client.post(f"{base}/applications/{job}/finish", json={"outcome": "submitted"})
    assert finished.json()["stage"] == "applied"
    listed = await client.get(f"{base}/applications", params={"stage": "applied"})
    assert [a["job"]["id"] for a in listed.json()] == [str(job)]


async def test_desktop_routes_are_the_owners_only(student, database):
    client, _ = student
    other = await _seed_applicant(database)
    job = await _seed_application(database, other, "filling")
    base = f"/applicants/{other}"
    for method, path, body in [
        ("post", "/applications/claim", {"n": 1}),
        ("post", "/applications/claim-approved", {"n": 1}),
        ("get", f"/applications/{job}/review", None),
        ("put", f"/applications/{job}/review", _review().model_dump(mode="json")),
        ("post", f"/applications/{job}/approve", {"answers": []}),
        ("put", "/desktop", BEAT.model_dump()),
        ("get", "/desktop", None),
    ]:
        assert (await client.request(method, base + path, json=body)).status_code == 403
    assert await _stage(database, other, job) == application_stage.filling
