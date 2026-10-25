"""
Job-board links (KAN-376) on real Postgres: auto apply fills only an
employer's hiring system, never LinkedIn, Indeed or another job board, whose
terms ban automation. A job-board posting is refused with its reason, unless
it names the employer's own application link, which is then the form the
extension opens (auto-apply/architecture.md, "Job boards").
"""

import pytest
from sqlalchemy import text

from tests import test_built_resumes

student = test_built_resumes.student

pytestmark = pytest.mark.anyio

LEVER_FORM = "https://jobs.lever.co/acme/0b5e5a0c-6f0e-4a8e-9d1c-3c2f1f4b8a11"


async def _seed(database, apply_url: str, description: str | None = None) -> str:
    """A published scraped posting with this link and text."""
    async with database() as session:
        posting = await session.scalar(text(
            "INSERT INTO job_postings (id, title, status, company_name, apply_url, description, experience_level)"
            " VALUES (gen_random_uuid(), 'Intern', 'published', 'Acme', :url, :description, 'new_grad') RETURNING id"
        ), {"url": apply_url, "description": description})
        await session.commit()
    return str(posting)


async def test_a_job_board_link_with_no_employer_form_is_refused_with_its_reason(student, database):
    client, me = student
    job = await _seed(database, "https://www.linkedin.com/jobs/view/4012345678", "Apply on LinkedIn.")

    res = await client.post(f"{me}/applications", json={"job_id": job})

    assert res.status_code == 404
    assert res.json()["detail"] == (
        "LinkedIn is a job board, and its terms ban automated applications. "
        "Auto Apply fills only an employer's own application form, and this posting names none."
    )
    assert (await client.get(f"{me}/applications/{job}")).status_code == 404


async def test_a_job_board_posting_that_names_the_employers_form_is_queued_as_that_form(student, database):
    client, me = student
    job = await _seed(
        database,
        "https://www.indeed.com/viewjob?jk=1a2b3c",
        f'<p>Apply on our site: <a href="{LEVER_FORM}?lever-source=Indeed&amp;ref=1">jobs.lever.co</a></p>',
    )

    res = await client.post(f"{me}/applications", json={"job_id": job})

    assert (res.status_code, res.json()["stage"]) == (200, "queued"), res.text
    posting = (await client.get(f"{me}/applications/next")).json()["job"]
    assert posting["id"] == job
    assert posting["form_url"] == f"{LEVER_FORM}?lever-source=Indeed&ref=1"
    assert posting["auto_apply"] is True


async def test_a_hiring_systems_posting_is_its_own_form(student, database):
    client, me = student
    url = "https://job-boards.greenhouse.io/acme/jobs/7"
    # A hiring system's link wins over any other link its text names.
    job = await _seed(database, url, f'<a href="{LEVER_FORM}">our other role</a>')

    await client.post(f"{me}/applications", json={"job_id": job})

    assert (await client.get(f"{me}/applications/next")).json()["job"]["form_url"] == url


async def test_a_company_page_is_not_followed_through_its_text(student, database):
    client, me = student
    # Only a job board's posting is followed: a company's own careers page
    # holds its form in an iframe, which a named link elsewhere may not be.
    job = await _seed(database, "https://stripe.com/jobs/search?gh_jid=8257892", f'<a href="{LEVER_FORM}">x</a>')

    res = await client.post(f"{me}/applications", json={"job_id": job})

    assert res.status_code == 404
    assert res.json()["detail"] == "Auto Apply can't fill this job's hiring system yet."
