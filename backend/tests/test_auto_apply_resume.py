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
from tests.test_built_resumes import _another, _fill_bank, _generate, _no_text, _upload
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


# Auto apply queues only job postings on a hiring system it fills
# (app/auto_apply/hosts.py): Greenhouse for now.
GREENHOUSE = "https://job-boards.greenhouse.io/acme/jobs/1"


async def _queued(client, me, database) -> str:
    posting = await _seed_posting(database, GREENHOUSE)
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
    # Kept as a snapshot (KAN-267): the PDF comes back itself, rendered
    # again from it, and nothing goes to Storage.
    assert (first["url"], again["data"]) == (None, first["data"])
    assert storage.files == {}
    listed = (await client.get(f"{me}/sent-resumes")).json()
    assert [s["id"] for s in listed] == [first["id"]]
    # The application names it (KAN-267), as "Did You Apply?" does for Apply.
    [application] = (await client.get(f"{me}/applications")).json()
    assert application["sent_resume"]["id"] == first["id"]


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


async def test_a_queued_job_can_leave_the_queue_and_come_back(student, storage, database):
    client, me = student
    job = await _queued(client, me, database)

    assert (await client.delete(f"{me}/applications/{job}")).status_code == 204
    assert (await client.get(f"{me}/applications/{job}")).status_code == 404
    assert (await client.delete(f"{me}/applications/{job}")).status_code == 404
    again = await client.post(f"{me}/applications", json={"job_id": job})
    assert again.json()["stage"] == "queued"

    # An applied one is a record, not a plan: it stays. (Read through the
    # finish and the refusal: the seeded posting has no experience level,
    # which the listing a GET answers with needs.)
    done = await client.post(f"{me}/applications/{job}/finish", json={"outcome": "submitted"})
    assert done.json()["stage"] == "applied"
    refused = await client.delete(f"{me}/applications/{job}")
    assert (refused.status_code, refused.json()["detail"]) == (
        409, "That application is applied, so it is no longer in the queue.")


@pytest.mark.parametrize("url", [
    "https://jobs.lever.co/acme/1",
    # A company's own careers page embedding Greenhouse: not its form.
    "https://stripe.com/jobs/search?gh_jid=1",
])
async def test_a_job_auto_apply_cannot_fill_is_never_queued(student, database, url):
    client, me = student
    posting = await _seed_posting(database, url)

    res = await client.post(f"{me}/applications", json={"job_id": posting})
    assert res.status_code == 404, res.text
    assert (await client.get(f"{me}/applications/{posting}")).status_code == 404


# --- The student's own pick (PUT .../applications/{job_id}/resume, KAN-359) ---


async def test_a_chosen_upload_replaces_the_default_for_that_job(student, storage, renders, database):
    client, me = student
    await _fill_bank(client, me)
    base = await _generate(client, me, "General SWE")
    assert (await client.put(f"{me}/built-resumes/{base}/default")).status_code == 200
    uploaded = (await _upload(client, me)).json()["id"]
    job = await _queued(client, me, database)

    res = await client.put(f"{me}/applications/{job}/resume", json={"uploaded_resume_id": uploaded})

    assert res.status_code == 200, res.text
    chosen = res.json()
    assert (chosen["uploaded_resume_id"], chosen["job_posting_id"]) == (uploaded, job)
    # The application names it, as Up Next reads it.
    [application] = (await client.get(f"{me}/applications")).json()
    assert application["sent_resume"]["id"] == chosen["id"]
    # The run's resume step sends the pick, not the default base resume.
    sent = (await client.post(f"{me}/applications/{job}/resume")).json()
    assert (sent["uploaded_resume_id"], sent["built_resume_id"]) == (uploaded, None)
    assert sent["id"] == chosen["id"]


async def test_a_chosen_built_resume_goes_with_the_job(student, storage, renders, database):
    client, me = student
    await _fill_bank(client, me)
    first = await _generate(client, me, "General SWE")
    second = await _another(client, me, "Backend focus")
    assert (await client.put(f"{me}/built-resumes/{first}/default")).status_code == 200
    job = await _queued(client, me, database)

    res = await client.put(f"{me}/applications/{job}/resume", json={"built_resume_id": second})

    assert (res.status_code, res.json()["built_resume_id"]) == (200, second), res.text
    sent = (await client.post(f"{me}/applications/{job}/resume")).json()
    assert sent["built_resume_id"] == second


async def test_a_pick_needs_exactly_one_resume_a_queued_job_and_ones_own_resume(
    student, storage, database
):
    client, me = student
    uploaded = (await _upload(client, me)).json()["id"]
    job = await _queued(client, me, database)
    url = f"{me}/applications/{job}/resume"

    assert (await client.put(url, json={})).status_code == 422
    both = {"uploaded_resume_id": uploaded, "built_resume_id": str(uuid.uuid4())}
    assert (await client.put(url, json=both)).status_code == 422
    assert (await client.put(url, json={"uploaded_resume_id": str(uuid.uuid4())})).status_code == 404
    other = f"{me}/applications/{uuid.uuid4()}/resume"
    assert (await client.put(other, json={"uploaded_resume_id": uploaded})).status_code == 404

    await client.post(f"{me}/applications/{job}/finish", json={"outcome": "skipped"})
    assert (await client.put(url, json={"uploaded_resume_id": uploaded})).status_code == 409
