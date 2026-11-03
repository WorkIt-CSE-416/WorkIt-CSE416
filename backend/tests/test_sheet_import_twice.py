"""
The Tracker Sheet import (KAN-545, apply-agent/src/apply/sheet_import.py)
run two times against real Postgres: the routes it calls, in its order,
make one posting and one application per job, and the second run changes
nothing. The import skips a job whose stage added-by-link answers as applied
or later, so the second run makes only that call. Its Sent resume upload is
KAN-544's route and is not called here.
"""

import pytest
from sqlalchemy import text

from tests.test_saved_jobs import student  # noqa: F401
from tests.test_tracked_added_jobs import _seed_listed

pytestmark = pytest.mark.anyio

APPLIED = ("applied", "interviewing", "offer", "rejected")

# Two rows as the Tracker Sheet has them: a listed Greenhouse job by its embed
# link, and a Lockheed job WorkIt does not list.
ROWS = [
    ("https://job-boards.greenhouse.io/embed/job_app?for=acme&token=8000001", "Acme", "Intern", "applied",
     "2026-10-17"),
    ("https://lockheedmartin.eightfold.ai/careers/job/996477106402", "Lockheed Martin", "Intern",
     "interviewing", "2026-10-20"),
]


async def _import(client, me) -> int:
    """One import run, as sheet_import.write makes it: answers how many it added."""
    added = 0
    for url, company, title, stage, day in ROWS:
        res = await client.post("/jobs/added-by-link", json={"url": url, "company": company, "title": title,
                                                                "track_only": True})
        assert res.status_code == 200
        if res.json()["stage"] in APPLIED:
            continue
        job = res.json()["job_id"]
        res = await client.put(
            f"/applicants/{me}/applications/{job}/stage", json={"stage": stage, "applied_on": day}
        )
        assert res.status_code == 200
        added += 1
    return added


async def test_an_import_run_two_times_makes_no_duplicate(student, database):  # noqa: F811
    client, me = student
    await _seed_listed(database, "https://boards.greenhouse.io/acme/jobs/8000001")

    assert await _import(client, me) == 2
    assert await _import(client, me) == 0

    async with database() as session:
        postings = await session.scalar(text("SELECT count(*) FROM job_postings"))
        rows = (await session.execute(text(
            "SELECT p.company_name, p.added_by_student, a.stage::text, a.applied_at"
            " FROM job_applications a JOIN job_postings p ON p.id = a.job_id"
            " WHERE a.applicant_id = :me ORDER BY p.company_name"
        ), {"me": me})).all()
    assert postings == 2
    assert [(c, s, st, at.isoformat()) for c, s, st, at in rows] == [
        ("Acme", False, "applied", "2026-10-17T12:00:00+00:00"),
        ("Lockheed Martin", True, "interviewing", "2026-10-20T12:00:00+00:00"),
    ]
