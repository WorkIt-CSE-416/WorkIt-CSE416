"""
Apply's adds by link (KAN-542, ADR 0008): Apply puts a job on the student's
Applications Tracker with POST /jobs/added-by-link and "track_only": true.
A job WorkIt lists comes back as that posting; a closed one is tracked as it
is; any other becomes one added job (added_by_student), which only students
with an application on it see. The extension's Write with Claude on the same
route is tests/test_added_jobs.py. Against real Postgres (backend/CLAUDE.md,
"Tests against real Postgres"), as tests/test_saved_jobs.py.
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
    return {"url": link, "company": "Lockheed Martin", "title": "Software Engineer Intern", "track_only": True,
            **extra}


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


async def _posting(database, job_id: str) -> tuple[str, bool]:
    """The posting's status and whether a student added it."""
    async with database() as session:
        return tuple((await session.execute(
            text("SELECT status::text, added_by_student FROM job_postings WHERE id = :id"), {"id": job_id}
        )).one())


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
    assert res.json() == {"job_id": job, "stage": "saved"}
    assert (await _row(database, me, job))[0] == "saved"
    assert await _posting(database, job) == ("published", False)


async def test_an_unknown_link_on_any_site_makes_one_added_job(student, database):  # noqa: F811
    client, me = student

    first = await client.post("/jobs/added-by-link", json=_add(LOCKHEED))
    assert first.status_code == 200
    body = first.json()
    assert body["stage"] == "saved"
    assert await _posting(database, body["job_id"]) == ("published", True)

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
    # Not closed: an added job is open (OPEN), though no feed lists it.
    assert tracker[0]["open"] is True
    assert "unlisted" not in tracker[0]

    # A company's own careers site is no form auto apply fills: Write with Claude refuses it, Apply's tracking
    # takes it.
    flux = "https://careers.flux.com/global/en/job/2026800"
    assert (await client.post("/jobs/added-by-link", json=_add(flux, track_only=False))).status_code == 404
    assert (await client.post("/jobs/added-by-link", json=_add(flux))).json()["stage"] == "saved"


async def test_an_application_already_on_the_job_keeps_its_stage(student, database):  # noqa: F811
    client, me = student
    job = await _seed_listed(database, "https://careers.example.com/jobs/1")
    await client.post(f"/jobs/{job}/applied")

    res = await client.post("/jobs/added-by-link", json=_add("https://careers.example.com/jobs/1"))
    assert res.json()["stage"] == "applied"

    # Tracking never moves a stage: a queued job stays queued (Write with Claude moves it to needs_you).
    queued = await _seed_listed(database, "https://boards.greenhouse.io/acme/jobs/77")
    async with database() as session:
        await session.execute(text("INSERT INTO job_applications (applicant_id, job_id, stage, applied_at)"
                                   " VALUES (:me, :job, 'queued', NULL)"), {"me": me, "job": queued})
        await session.commit()
    res = await client.post("/jobs/added-by-link", json=_add("https://boards.greenhouse.io/acme/jobs/77"))
    assert res.json()["stage"] == "queued"


async def test_the_student_sets_a_stage_on_an_added_job(student, database):  # noqa: F811
    client, me = student
    job = (await client.post("/jobs/added-by-link", json=_add(LOCKHEED))).json()["job_id"]

    res = await client.post(f"/jobs/{job}/applied")
    assert res.status_code == 200
    assert res.json()["applied_at"] is not None
    res = await client.put(f"/applicants/{me}/applications/{job}/stage", json={"stage": "interviewing"})
    assert res.status_code == 200
    assert (await _row(database, me, job))[0] == "interviewing"


async def test_a_closed_posting_with_the_link_is_tracked_as_it_is(student, database):  # noqa: F811
    # The feed closed it after the student applied: the same link must not break the unique apply_url,
    # and tracking it must not reopen or retitle it for other students.
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

    res = await client.post("/jobs/added-by-link", json=_add(LOCKHEED, company="Evil", title="Changed"))
    assert res.status_code == 200
    assert res.json() == {"job_id": job, "stage": "saved"}
    assert await _posting(database, job) == ("closed", False)
    async with database() as session:
        row = (await session.execute(text("SELECT company_name, title FROM job_postings WHERE id = :id"),
                                     {"id": job})).one()
    assert tuple(row) == ("Acme", "Intern")
    # Write with Claude still refuses the closed job's form.
    assert (await client.post("/jobs/added-by-link", json=_add(LOCKHEED, track_only=False))).status_code == 404


async def test_an_added_job_stays_off_search_the_job_page_and_scout(student, database):  # noqa: F811
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


async def test_another_student_never_sees_the_added_job(student, database):  # noqa: F811
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


def _act_as(applicant_id: uuid.UUID) -> None:
    app.dependency_overrides[get_current_account] = lambda: AuthenticatedAccount(
        id=applicant_id, email="kim@example.com", full_name="Kim Other",
        account_type=AccountType.APPLICANT, onboarding_completed=True,
    )


async def _seed_student(database) -> uuid.UUID:
    other = uuid.uuid4()
    async with database() as session:
        await session.execute(text("INSERT INTO auth.users (id) VALUES (:id)"), {"id": other})
        await session.execute(
            text("INSERT INTO applicant_profiles (id, email, full_name) VALUES (:id, 'kim@example.com', 'Kim Other')"),
            {"id": other},
        )
        await session.commit()
    return other


async def test_a_second_student_on_the_link_never_sees_the_first_ones_typing(student, database):  # noqa: F811
    client, me = student
    mine = await client.post("/jobs/added-by-link", json=_add(LOCKHEED, company="LM (Kate's referral)",
                                                              title="Skunk Works intern, team 7"))
    other = await _seed_student(database)
    _act_as(other)

    theirs = await client.post("/jobs/added-by-link", json=_add(LOCKHEED))
    # One posting per link (ADR 0008).
    assert theirs.json()["job_id"] == mine.json()["job_id"]
    [row] = (await client.get(f"/applicants/{other}/applications")).json()
    assert (row["job"]["company"], row["job"]["title"]) == ("Lockheed Martin", "Software Engineer Intern")

    _act_as(me)
    [row] = (await client.get(f"/applicants/{me}/applications")).json()
    assert (row["job"]["company"], row["job"]["title"]) == ("LM (Kate's referral)", "Skunk Works intern, team 7")

    # Once the feed lists the job (the import clears the flag), both students see the feed's text.
    async with database() as session:
        await session.execute(text("UPDATE job_postings SET added_by_student = false, title = 'SWE Intern', "
                                   "company_name = 'Lockheed Martin Corp'"))
        await session.commit()
    [row] = (await client.get(f"/applicants/{me}/applications")).json()
    assert (row["job"]["company"], row["job"]["title"]) == ("Lockheed Martin Corp", "SWE Intern")


async def test_an_added_jobs_company_is_not_a_known_company(student, database):  # noqa: F811
    from app.auto_apply.queries import fetch_company_names

    client, _ = student
    await _seed_listed(database, "https://boards.greenhouse.io/figma/jobs/6143238004")
    await client.post("/jobs/added-by-link", json=_add(LOCKHEED, company="Kate's Startup"))
    # The known companies feed every student's essay check: one student's typing stays out.
    async with database() as session:
        assert await fetch_company_names(session) == ["Acme"]
