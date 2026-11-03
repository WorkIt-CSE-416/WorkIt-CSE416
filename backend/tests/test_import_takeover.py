"""The feed import takes over an unlisted job posting (KAN-542, ADR 0008):
when the scraper finds a job a student added by its link, the import fills
in that posting and publishes it. No second posting, no unique-link error,
and the student's application stays on it. Against real Postgres
(backend/CLAUDE.md, "Tests against real Postgres")."""

import uuid

import pytest
from sqlalchemy import text

from app.db import get_engine
from app.schemas.jobs import JobListing
from app.scripts.import_jobs import import_feed

pytestmark = pytest.mark.anyio

OTHER = "https://boards.example.com/acme/other"


def _listing(url: str) -> JobListing:
    return JobListing(
        id=url, title="Backend Intern", company="Acme Corp", apply_url=url,
        experience_level="student", job_type="internship", work_style="onsite", location="Austin, TX",
        posted_at="2026-10-06T02:42:06+00:00", logo_url=None, description="Build services.",
    )


async def _import(urls: list[str]):
    async with get_engine().begin() as conn:
        return await import_feed(conn, [_listing(url) for url in urls])


async def _unlisted(url: str, status: str = "unlisted") -> tuple[str, uuid.UUID]:
    """An unlisted posting at `url`, saved on one student's tracker; answers its id and the student."""
    student = uuid.uuid4()
    async with get_engine().begin() as conn:
        await conn.execute(text("INSERT INTO auth.users (id) VALUES (:id)"), {"id": student})
        await conn.execute(
            text("INSERT INTO applicant_profiles (id, email, full_name) VALUES (:id, :email, 'Sam Seeker')"),
            {"id": student, "email": f"{student.hex}@example.com"},
        )
        job = await conn.scalar(
            text(
                "INSERT INTO job_postings (id, title, status, company_name, apply_url, experience_level)"
                " VALUES (gen_random_uuid(), 'SWE Intern', CAST(:status AS job_post_status), 'Acme', :url,"
                " 'student') RETURNING id"
            ),
            {"url": url, "status": status},
        )
        await conn.execute(
            text("INSERT INTO job_applications (applicant_id, job_id, stage) VALUES (:a, :j, 'applied')"),
            {"a": student, "j": job},
        )
    return str(job), student


async def _postings() -> dict[str, tuple[str, str, str]]:
    async with get_engine().connect() as conn:
        rows = await conn.execute(text("SELECT id, apply_url, status::text, company_name FROM job_postings"))
        return {str(r.id): (r.apply_url, r.status, r.company_name) for r in rows}


async def _application_job(student: uuid.UUID) -> str:
    async with get_engine().connect() as conn:
        return str(await conn.scalar(
            text("SELECT job_id FROM job_applications WHERE applicant_id = :a"), {"a": student}
        ))


@pytest.mark.parametrize(("added", "scraped"), [
    # The same link.
    ("https://jobs.example.com/acme/123", "https://jobs.example.com/acme/123"),
    # Another form of it: scheme, www., query, trailing slash, case.
    ("http://www.Jobs.Example.com/acme/123/?src=apply", "https://jobs.example.com/acme/123"),
    # The same Greenhouse job on the other host.
    ("https://boards.greenhouse.io/acme/jobs/4012345", "https://job-boards.greenhouse.io/acme/jobs/4012345"),
])
async def test_the_scraper_takes_over_the_unlisted_posting(database, added, scraped):
    job, student = await _unlisted(added)

    await _import([scraped, OTHER])

    postings = await _postings()
    assert postings[job] == (scraped, "published", "Acme Corp")
    assert len(postings) == 2
    assert await _application_job(student) == job


async def test_an_unlisted_posting_the_feed_does_not_have_stays_unlisted(database):
    job, _ = await _unlisted("https://lockheedmartin.eightfold.ai/careers/job/7123456")

    report = await _import([OTHER])

    assert (await _postings())[job][1] == "unlisted"
    assert report.closed == 0


async def test_a_bare_link_two_scraped_jobs_share_takes_over_neither(database):
    # Two feed jobs told apart only by their query: the unlisted one could be either.
    job, _ = await _unlisted("https://careers.example.com/job")

    await _import(["https://careers.example.com/job?id=1", "https://careers.example.com/job?id=2"])

    postings = await _postings()
    assert postings[job] == ("https://careers.example.com/job", "unlisted", "Acme")
    assert len(postings) == 3


async def test_a_feed_link_another_posting_holds_is_not_taken_over(database):
    # A closed scraped posting already holds the feed's link: moving the unlisted one onto it breaks the unique link.
    closed, _ = await _unlisted("https://job-boards.greenhouse.io/acme/jobs/4012345", status="closed")
    job, _ = await _unlisted("https://boards.greenhouse.io/acme/jobs/4012345")

    await _import(["https://job-boards.greenhouse.io/acme/jobs/4012345"])

    postings = await _postings()
    assert postings[closed][1] == "published"
    assert postings[job] == ("https://boards.greenhouse.io/acme/jobs/4012345", "unlisted", "Acme")
