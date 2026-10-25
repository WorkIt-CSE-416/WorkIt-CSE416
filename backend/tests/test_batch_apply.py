"""
Batch apply (KAN-370) on real Postgres: the extension fills up to five
tabs at once, so it reads the queue in order while skipping the jobs it
already has open, and it records how each tab's fill left the form on the
application's stage (auto-apply/architecture.md, "Batch apply").
"""

import pytest

from tests import test_built_resumes
from tests.test_sent_resumes import _seed_posting

student = test_built_resumes.student

pytestmark = pytest.mark.anyio


async def _queue(client, me, database, count: int) -> list[str]:
    """`count` Greenhouse job postings queued in order, oldest first."""
    jobs = []
    for n in range(count):
        job = await _seed_posting(database, f"https://job-boards.greenhouse.io/acme/jobs/{n + 1}")
        res = await client.post(f"{me}/applications", json={"job_id": job})
        assert (res.status_code, res.json()["stage"]) == (200, "queued"), res.text
        jobs.append(job)
    return jobs


async def _next(client, me, *skip: str):
    res = await client.get(f"{me}/applications/next", params=[("skip", job) for job in skip])
    assert res.status_code == 200, res.text
    return res.json() and res.json()["job"]["id"]


async def test_next_skips_the_jobs_the_batch_already_has_open(student, database):
    client, me = student
    first, second, third = await _queue(client, me, database, 3)

    assert await _next(client, me) == first
    assert await _next(client, me, first, second) == third
    assert await _next(client, me, first, second, third) is None


async def test_a_tabs_fill_moves_its_application_between_queued_and_needs_you(student, database):
    client, me = student
    first, second = await _queue(client, me, database, 2)

    res = await client.put(f"{me}/applications/{first}/fill", json={"state": "needs_you"})
    assert (res.status_code, res.json()) == (200, {"job_id": first, "stage": "needs_you"})
    # A tab that needs the student is open already: the queue goes on past it.
    assert await _next(client, me) == second

    # The student answered what it needed: the tab is ready, waiting for their submit.
    res = await client.put(f"{me}/applications/{first}/fill", json={"state": "ready"})
    assert res.json() == {"job_id": first, "stage": "queued"}
    assert (await client.get(f"{me}/applications/{first}")).json()["stage"] == "queued"


async def test_a_finished_application_keeps_its_stage(student, database):
    client, me = student
    (job,) = await _queue(client, me, database, 1)
    assert (await client.post(f"{me}/applications/{job}/finish", json={"outcome": "submitted"})).status_code == 200

    res = await client.put(f"{me}/applications/{job}/fill", json={"state": "needs_you"})

    assert res.status_code == 409
    assert (await client.get(f"{me}/applications/{job}")).json()["stage"] == "applied"


async def test_fill_without_an_application_is_404(student, database):
    client, me = student
    job = await _seed_posting(database, "https://job-boards.greenhouse.io/acme/jobs/9")

    res = await client.put(f"{me}/applications/{job}/fill", json={"state": "ready"})

    assert res.status_code == 404


async def test_fill_takes_only_a_tabs_end_states(student, database):
    client, me = student
    (job,) = await _queue(client, me, database, 1)

    res = await client.put(f"{me}/applications/{job}/fill", json={"state": "filling"})

    assert res.status_code == 422
