"""
A job a student added from its form (KAN-515): on a form whose job WorkIt
doesn't list, the panel's Write with Claude adds the job from the page
(POST /jobs/added-by-link) with an application at needs_you, so the
student's Claude can write its questions as on any other. The added job is
the student's alone: no Jobs feed, count or link lookup shows it, and the
feed import neither closes nor claims it unless the feed lists its link.
Against real Postgres (backend/CLAUDE.md, "Tests against real Postgres").
"""

import uuid

import httpx
import pytest
from sqlalchemy import text

from app.auto_apply.queries import fetch_unanswered
from app.deps import get_current_account
from app.main import app
from app.schemas.auth import AccountType, AuthenticatedAccount

pytestmark = pytest.mark.anyio


def _form() -> str:
    return f"https://job-boards.greenhouse.io/twitch/jobs/{uuid.uuid4().int % 10**10}"


def _page(url: str) -> dict:
    return {"url": url, "company": "Twitch", "title": "Software Engineer Intern"}


async def _seed_applicant(database) -> uuid.UUID:
    applicant_id = uuid.uuid4()
    async with database() as session:
        await session.execute(text("INSERT INTO auth.users (id) VALUES (:id)"), {"id": applicant_id})
        await session.execute(
            text("INSERT INTO applicant_profiles (id, email, full_name) VALUES (:id, :email, 'Sam Seeker')"),
            {"id": applicant_id, "email": f"{applicant_id.hex}@example.com"},
        )
        await session.commit()
    return applicant_id


def _as(applicant_id: uuid.UUID) -> None:
    app.dependency_overrides[get_current_account] = lambda: AuthenticatedAccount(
        id=applicant_id, email="sam@example.com", full_name="Sam Seeker",
        account_type=AccountType.APPLICANT, onboarding_completed=True,
    )


@pytest.fixture
async def students(database):
    ids = [await _seed_applicant(database), await _seed_applicant(database)]
    _as(ids[0])
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        yield client, ids
    app.dependency_overrides.pop(get_current_account, None)


async def _feed_ids(client) -> list[str]:
    return [listing["id"] for listing in (await client.get("/jobs", params={"limit": 100})).json()]


async def test_adding_a_form_gives_the_student_an_application_their_claude_can_write_for(students, database):
    client, (sam, _) = students
    url = _form()

    res = await client.post("/jobs/added-by-link", json=_page(url))
    assert res.status_code == 200, res.text
    job_id, stage = res.json()["job_id"], res.json()["stage"]
    assert stage == "needs_you"

    application = (await client.get(f"/applicants/{sam}/applications/{job_id}")).json()
    assert application["stage"] == "needs_you"
    assert application["open"] is True
    assert application["job"]["company"] == "Twitch"
    assert application["job"]["title"] == "Software Engineer Intern"
    assert application["job"]["apply_url"] == url
    assert application["job"]["experience_level"] is None

    # The questions go on it, as a batch tab's do, for the student's Claude.
    asked = await client.put(
        f"/applicants/{sam}/applications/{job_id}/questions",
        json={"questions": [{"name": "why", "label": "Why Twitch?", "required": True}]},
    )
    assert asked.status_code == 200, asked.text
    # The connector's list of what is left to write names it.
    async with database() as session:
        unanswered = await fetch_unanswered(session, sam)
    assert [(str(job), company) for job, company, _, _ in unanswered] == [(job_id, "Twitch")]


async def test_an_added_job_is_on_no_feed_and_no_link_lookup(students):
    client, (sam, pat) = students
    url = _form()
    job_id = (await client.post("/jobs/added-by-link", json=_page(url))).json()["job_id"]

    for who in (sam, pat):
        _as(who)
        assert job_id not in await _feed_ids(client)
        assert (await client.post("/jobs/listed-by-link", json={"url": url})).status_code == 404
        assert (await client.post("/jobs/saved-by-link", json={"url": url})).status_code == 404
    _as(pat)
    assert (await client.get(f"/jobs/{job_id}")).status_code == 404


async def test_adding_the_same_form_again_or_as_another_student_keeps_one_job(students):
    client, (_, pat) = students
    url = _form()
    first = (await client.post("/jobs/added-by-link", json=_page(url))).json()
    assert (await client.post("/jobs/added-by-link", json=_page(url))).json() == first

    _as(pat)
    theirs = (await client.post("/jobs/added-by-link", json=_page(url))).json()
    assert theirs == first
    assert (await client.get(f"/applicants/{pat}/applications/{first['job_id']}")).json()["stage"] == "needs_you"


async def test_a_listed_jobs_form_is_that_job(students, database):
    client, _ = students
    url = _form()
    async with database() as session:
        listed = await session.scalar(
            text(
                "INSERT INTO job_postings (id, title, status, company_name, apply_url, experience_level)"
                " VALUES (gen_random_uuid(), 'Intern', 'published', 'Acme', :url, 'student') RETURNING id"
            ),
            {"url": url},
        )
        await session.commit()

    res = (await client.post("/jobs/added-by-link", json=_page(url))).json()
    assert res == {"job_id": str(listed), "stage": "needs_you"}
    assert str(listed) in await _feed_ids(client)


async def test_an_applied_job_keeps_its_stage(students):
    client, _ = students
    url = _form()
    job_id = (await client.post("/jobs/added-by-link", json=_page(url))).json()["job_id"]

    # The student's submit on the tracked tab marks it applied.
    assert (await client.post(f"/jobs/{job_id}/applied")).status_code == 200
    assert (await client.post("/jobs/added-by-link", json=_page(url))).json()["stage"] == "applied"


async def test_a_form_auto_apply_cannot_fill_or_on_a_job_system_turned_off_is_refused(students, database):
    client, _ = students
    res = await client.post("/jobs/added-by-link", json=_page("https://www.linkedin.com/jobs/view/1"))
    assert res.status_code == 404
    assert "job board" in res.json()["detail"]

    async with database() as session:
        await session.execute(text("INSERT INTO disabled_job_systems (job_system, disabled_by) VALUES ('greenhouse', 'a@x.com')"))
        await session.commit()
    try:
        res = await client.post("/jobs/added-by-link", json=_page(_form()))
        assert res.status_code == 404
        assert res.json()["detail"] == "WorkIt can't fill Greenhouse right now. Try this job again later."
    finally:
        async with database() as session:
            await session.execute(text("DELETE FROM disabled_job_systems"))
            await session.commit()


async def test_a_page_with_no_company_or_title_is_refused(students):
    client, _ = students
    res = await client.post("/jobs/added-by-link", json={"url": _form(), "company": " ", "title": "Intern"})
    assert res.status_code == 422


async def test_adding_is_capped_a_day(students, monkeypatch):
    from app.config import get_settings

    monkeypatch.setattr(get_settings(), "added_job_daily_cap", 2)
    client, _ = students
    for _ in range(2):
        assert (await client.post("/jobs/added-by-link", json=_page(_form()))).status_code == 200
    refused = await client.post("/jobs/added-by-link", json=_page(_form()))
    assert refused.status_code == 429
    # A form already added costs nothing.
    assert refused.json()["detail"].startswith("You've added a lot of jobs today.")


def _listing(url: str):
    from app.schemas.jobs import JobListing

    return JobListing(
        id=url, title="Software Engineer Intern", company="Twitch", apply_url=url,
        experience_level="student", job_type="internship", work_style="onsite", location="San Francisco, CA",
        posted_at="2026-10-06T02:42:06+00:00", logo_url=None, description="Build Twitch.",
    )


async def _import(urls: list[str]) -> None:
    from app.db import get_engine
    from app.scripts.import_jobs import import_feed

    async with get_engine().begin() as conn:
        await import_feed(conn, [_listing(url) for url in urls])


async def _job(database, job_id: str):
    async with database() as session:
        return (await session.execute(
            text("SELECT status, added_by_student FROM job_postings WHERE id = :id"), {"id": job_id}
        )).first()


async def test_the_feed_import_leaves_an_added_job_open_until_the_feed_lists_its_link(students, database):
    client, (sam, _) = students
    url = _form()
    job_id = (await client.post("/jobs/added-by-link", json=_page(url))).json()["job_id"]

    # A feed without its link closes every scraped job it lacks, never the added one.
    await _import([_form()])
    assert tuple(await _job(database, job_id)) == ("published", True)

    # A feed that lists it makes it a scraped job, on the feed, with the student's application kept.
    await _import([url])
    assert tuple(await _job(database, job_id)) == ("published", False)
    assert job_id in await _feed_ids(client)
    assert (await client.get(f"/applicants/{sam}/applications/{job_id}")).json()["stage"] == "needs_you"


async def test_a_closed_jobs_form_is_refused_and_the_job_stays_closed(students, database):
    client, _ = students
    url = _form()
    await _import([url])
    await _import([_form()])
    async with database() as session:
        closed = await session.scalar(text("SELECT id FROM job_postings WHERE apply_url = :u AND status = 'closed'"), {"u": url})
    assert closed is not None

    res = await client.post("/jobs/added-by-link", json={**_page(url), "company": "Evil", "title": "Changed"})
    assert res.status_code == 404
    assert tuple(await _job(database, str(closed))) == ("closed", False)
    async with database() as session:
        row = (await session.execute(text("SELECT company_name, title FROM job_postings WHERE id = :id"), {"id": closed})).first()
    assert tuple(row) != ("Evil", "Changed")


async def test_an_added_job_takes_a_sent_resume_and_a_closed_one_does_not(students, database):
    from app.services.sent_resumes import NotFound, _check_posting

    client, (sam, _) = students
    added = uuid.UUID((await client.post("/jobs/added-by-link", json=_page(_form()))).json()["job_id"])
    url = _form()
    await _import([url])
    await _import([_form()])
    async with database() as session:
        closed = await session.scalar(text("SELECT id FROM job_postings WHERE apply_url = :u"), {"u": url})
        await _check_posting(session, sam, added)
        with pytest.raises(NotFound):  # closed, and Sam has no application on it
            await _check_posting(session, sam, closed)
