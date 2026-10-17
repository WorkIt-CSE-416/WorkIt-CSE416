"""
The resume step on real Postgres: POST .../applications/{job_id}/resume
picks the resume tailored to the job posting, else the default, and keeps it
as a sent resume linked to the job posting (auto-apply/architecture.md,
"The resume"). Storage and the PDF render are faked as in
test_sent_resumes.py.
"""

import uuid

import pytest
from sqlalchemy import text

from tests import test_built_resumes, test_sent_resumes
from tests.test_built_resumes import _fill_bank, _generate, _no_text, _upload
from tests.test_sent_resumes import FakeStorage, _seed_posting

student = test_built_resumes.student
renders = test_sent_resumes.renders

pytestmark = pytest.mark.anyio


@pytest.fixture
def storage(monkeypatch):
    """test_sent_resumes' in-memory bucket, reached from the auto apply router too."""
    fake = FakeStorage()

    class Client:
        storage = fake

    for router in ("resumes", "sent_resumes", "auto_apply"):
        monkeypatch.setattr(f"app.routers.{router}.get_supabase", lambda: Client())
    monkeypatch.setattr("app.routers.resumes._extract", _no_text)
    return fake


async def _queued(client, me, database) -> str:
    posting = await _seed_posting(database)
    res = await client.post(f"{me}/applications", json={"job_id": posting})
    assert (res.status_code, res.json()["stage"]) == (200, "queued"), res.text
    return posting


async def test_no_resume_answers_null_and_keeps_nothing(student, storage, database):
    client, me = student
    job = await _queued(client, me, database)

    res = await client.post(f"{me}/applications/{job}/resume")

    assert (res.status_code, res.json()) == (200, None)
    assert (await client.get(f"{me}/sent-resumes")).json() == []


async def test_the_default_upload_goes_as_its_own_file(student, storage, database):
    client, me = student
    uploaded = (await _upload(client, me)).json()["id"]
    assert (await client.put(f"{me}/resumes/{uploaded}/default")).status_code == 200
    job = await _queued(client, me, database)

    res = await client.post(f"{me}/applications/{job}/resume")

    assert res.status_code == 200
    sent = res.json()
    assert (sent["uploaded_resume_id"], sent["built_resume_id"], sent["job_posting_id"]) == (
        uploaded, None, job)
    assert sent["url"].startswith("https://storage.test/")


async def test_the_default_base_resume_is_kept_once_for_the_job(student, storage, renders, database):
    client, me = student
    await _fill_bank(client, me)
    built = await _generate(client, me, "General SWE")
    assert (await client.put(f"{me}/built-resumes/{built}/default")).status_code == 200
    job = await _queued(client, me, database)

    first = (await client.post(f"{me}/applications/{job}/resume")).json()
    again = (await client.post(f"{me}/applications/{job}/resume")).json()

    assert (first["built_resume_id"], first["job_posting_id"]) == (built, job)
    assert again["id"] == first["id"]  # a run that starts again keeps nothing new
    assert len(renders) == 1
    listed = (await client.get(f"{me}/sent-resumes")).json()
    assert [s["id"] for s in listed] == [first["id"]]


async def test_the_tailored_resume_comes_before_the_default(student, storage, renders, database):
    client, me = student
    await _fill_bank(client, me)
    base = await _generate(client, me, "General SWE")
    await client.put(f"{me}/built-resumes/{base}/default")
    job = await _queued(client, me, database)
    tailored = uuid.uuid4()
    # What Tailor's Done leaves: a built resume for the job posting.
    async with database() as session:
        await session.execute(
            text(
                "INSERT INTO built_resumes (id, applicant_id, name, template, job_posting_id)"
                " VALUES (:id, :applicant, 'For Acme', 'jakes', :job)"
            ),
            {"id": tailored, "applicant": me.split("/")[2], "job": job},
        )
        await session.commit()

    sent = (await client.post(f"{me}/applications/{job}/resume")).json()

    assert (sent["built_resume_id"], sent["name"]) == (str(tailored), "For Acme")


async def test_a_finished_application_gets_no_resume(student, storage, database):
    client, me = student
    job = await _queued(client, me, database)
    await client.post(f"{me}/applications/{job}/finish", json={"outcome": "skipped"})

    assert (await client.post(f"{me}/applications/{job}/resume")).status_code == 409
    assert (await client.post(f"{me}/applications/{uuid.uuid4()}/resume")).status_code == 404
