"""
Unlisted job postings (KAN-542, ADR 0008): a student adds a job to the
Applications Tracker by its link with POST /jobs/added-by-link. A job WorkIt
lists comes back as that posting; any other becomes one unlisted posting,
which only students with an application on it see. Against real Postgres
(backend/CLAUDE.md, "Tests against real Postgres"), as tests/test_saved_jobs.py.
"""

import uuid

import httpx
import pytest
from sqlalchemy import text

from app.deps import get_current_account
from app.main import app
from app.routers.scout import find_job
from app.schemas.auth import AccountType, AuthenticatedAccount
from tests.test_saved_jobs import _row, student  # noqa: F401

pytestmark = pytest.mark.anyio

LOCKHEED = "https://lockheedmartin.eightfold.ai/careers/job/7123456"


def _add(link: str, **extra) -> dict:
    return {"url": link, "company": "Lockheed Martin", "title": "Software Engineer Intern", **extra}


async def _seed_listed(database, url: str) -> str:
    async with database() as session:
        job = await session.scalar(
            text(
                "INSERT INTO job_postings (id, title, status, company_name, apply_url, experience_level)"
                " VALUES (gen_random_uuid(), 'Intern', 'published', 'Acme', :url, 'student') RETURNING id"
            ),
            {"url": url},
        )
        await session.commit()
    return str(job)


async def _status(database, job_id: str) -> str:
    async with database() as session:
        return await session.scalar(
            text("SELECT status::text FROM job_postings WHERE id = :id"), {"id": job_id}
        )


@pytest.mark.parametrize("page", [
    "https://boards.greenhouse.io/figma/jobs/6143238004",
    # Normalized: scheme, www., query, trailing slash and case.
    "http://www.Boards.Greenhouse.io/figma/jobs/6143238004/?utm_source=li",
    # The same Greenhouse job on the other host.
    "https://job-boards.greenhouse.io/figma/jobs/6143238004",
])
async def test_a_listed_job_comes_back_as_itself_and_goes_on_the_tracker(student, database, page):  # noqa: F811
    client, me = student
    job = await _seed_listed(database, "https://boards.greenhouse.io/figma/jobs/6143238004")

    res = await client.post("/jobs/added-by-link", json=_add(page))
    assert res.status_code == 200
    assert res.json() == {"job_id": job, "status": "published", "stage": "saved"}
    assert (await _row(database, me, job))[0] == "saved"


async def test_an_unknown_link_makes_one_unlisted_posting(student, database):  # noqa: F811
    client, me = student

    first = await client.post("/jobs/added-by-link", json=_add(LOCKHEED))
    assert first.status_code == 200
    body = first.json()
    assert body["status"] == "unlisted" and body["stage"] == "saved"

    # The same job by another form of its link is the same posting.
    again = await client.post("/jobs/added-by-link", json=_add(f"http://www.{LOCKHEED[8:]}/?src=apply"))
    assert again.json() == body
    async with database() as session:
        count = await session.scalar(text("SELECT count(*) FROM job_postings"))
    assert count == 1

    # The student sees it on their tracker, with the company and title given.
    tracker = (await client.get(f"/applicants/{me}/applications")).json()
    assert [(a["job"]["id"], a["job"]["company"], a["job"]["title"]) for a in tracker] == [
        (body["job_id"], "Lockheed Martin", "Software Engineer Intern")
    ]


async def test_an_application_already_on_the_job_keeps_its_stage(student, database):  # noqa: F811
    client, _ = student
    job = await _seed_listed(database, "https://careers.example.com/jobs/1")
    await client.post(f"/jobs/{job}/applied")

    res = await client.post("/jobs/added-by-link", json=_add("https://careers.example.com/jobs/1"))
    assert res.json()["stage"] == "applied"


async def test_the_student_sets_a_stage_on_an_unlisted_posting(student, database):  # noqa: F811
    client, me = student
    job = (await client.post("/jobs/added-by-link", json=_add(LOCKHEED))).json()["job_id"]

    res = await client.post(f"/jobs/{job}/applied")
    assert res.status_code == 200
    assert res.json()["applied_at"] is not None
    res = await client.put(f"/applicants/{me}/applications/{job}/stage", json={"stage": "interviewing"})
    assert res.status_code == 200
    assert (await _row(database, me, job))[0] == "interviewing"


async def test_a_closed_posting_with_the_link_is_reused_not_duplicated(student, database):  # noqa: F811
    # The feed closed it after the student applied: the same link must not break the unique apply_url.
    client, _ = student
    async with database() as session:
        job = str(await session.scalar(
            text(
                "INSERT INTO job_postings (id, title, status, company_name, apply_url, experience_level)"
                " VALUES (gen_random_uuid(), 'Intern', 'closed', 'Acme', :url, 'student') RETURNING id"
            ),
            {"url": LOCKHEED},
        ))
        await session.commit()

    res = await client.post("/jobs/added-by-link", json=_add(LOCKHEED))
    assert res.status_code == 200
    assert res.json() == {"job_id": job, "status": "closed", "stage": "saved"}


async def test_an_unlisted_posting_stays_off_search_the_job_page_and_scout(student, database):  # noqa: F811
    client, _ = student
    listed = await _seed_listed(database, "https://careers.example.com/jobs/1")
    job = (await client.post("/jobs/added-by-link", json=_add(LOCKHEED))).json()["job_id"]

    assert [j["id"] for j in (await client.get("/jobs")).json()] == [listed]
    assert (await client.get("/jobs", params={"q": "Lockheed"})).json() == []
    assert (await client.get("/jobs/count")).json()["jobs"] == 1
    assert (await client.get(f"/jobs/{job}")).status_code == 404
    async with database() as session:
        assert await find_job(session, job) is None
        assert await find_job(session, listed) is not None


async def test_another_student_never_sees_the_unlisted_posting(student, database):  # noqa: F811
    client, _ = student
    job = (await client.post("/jobs/added-by-link", json=_add(LOCKHEED))).json()["job_id"]

    other = uuid.uuid4()
    async with database() as session:
        await session.execute(text("INSERT INTO auth.users (id) VALUES (:id)"), {"id": other})
        await session.execute(
            text("INSERT INTO applicant_profiles (id, email, full_name) VALUES (:id, 'kim@example.com', 'Kim Other')"),
            {"id": other},
        )
        await session.commit()
    app.dependency_overrides[get_current_account] = lambda: AuthenticatedAccount(
        id=other, email="kim@example.com", full_name="Kim Other",
        account_type=AccountType.APPLICANT, onboarding_completed=True,
    )
    assert (await client.get(f"/applicants/{other}/applications")).json() == []
    # With no application on it, it is not theirs to mark or save.
    assert (await client.post(f"/jobs/{job}/applied")).status_code == 404
    assert (await client.post(f"/jobs/{job}/saved")).status_code == 404
    assert await _row(database, other, job) is None


async def test_adding_by_link_is_for_applicants_only(database):
    app.dependency_overrides[get_current_account] = lambda: AuthenticatedAccount(
        id=uuid.uuid4(), email="hr@example.com", full_name="Hal Recruiter",
        account_type=AccountType.COMPANY, onboarding_completed=True,
    )
    try:
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
            assert (await client.post("/jobs/added-by-link", json=_add(LOCKHEED))).status_code == 403
    finally:
        app.dependency_overrides.pop(get_current_account, None)


async def test_a_link_that_is_not_a_web_link_is_422(student):  # noqa: F811
    client, _ = student
    assert (await client.post("/jobs/added-by-link", json=_add("not a link"))).status_code == 422
    assert (await client.post("/jobs/added-by-link", json=_add(LOCKHEED, company=""))).status_code == 422
