"""
The one-time backfill b6d2e8f4a1c7 (KAN-217): every job a student tailored a
resume for before a Tailor run saved its job gets the `saved` application a
run makes today, on real Postgres. It runs the migration's own SQL.
"""

import datetime
import importlib.util
import uuid
from pathlib import Path

import pytest
from sqlalchemy import text

pytestmark = pytest.mark.anyio

TAILORED_AT = datetime.datetime(2026, 10, 30, 12, 0, tzinfo=datetime.UTC)


def _backfill_sql() -> str:
    path = next(Path(__file__).parents[1].glob("alembic/versions/*_tailored_jobs_saved.py"))
    spec = importlib.util.spec_from_file_location("tailored_jobs_saved_migration", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.BACKFILL


async def _applicant(s) -> uuid.UUID:
    applicant_id = uuid.uuid4()
    await s.execute(text("INSERT INTO auth.users (id) VALUES (:id)"), {"id": applicant_id})
    await s.execute(
        text("INSERT INTO applicant_profiles (id, email, full_name) VALUES (:id, :email, 'Sam Seeker')"),
        {"id": applicant_id, "email": f"{applicant_id}@example.com"},
    )
    return applicant_id


async def _posting(s, status: str = "published", added: bool = False) -> uuid.UUID:
    return await s.scalar(
        text(
            "INSERT INTO job_postings (id, title, status, company_name, apply_url,"
            " experience_level, added_by_student) VALUES (gen_random_uuid(), 'Intern', :status,"
            " 'Acme', :url, 'student', :added) RETURNING id"
        ),
        {"status": status, "url": f"https://example.com/{uuid.uuid4().hex}", "added": added},
    )


async def _tailored(s, applicant_id: uuid.UUID, posting_id: uuid.UUID | None) -> None:
    await s.execute(
        text(
            "INSERT INTO built_resumes (applicant_id, name, template, job_posting_id, created_at)"
            " VALUES (:a, 'Resume', 'jakes', :p, :at)"
        ),
        {"a": applicant_id, "p": posting_id, "at": TAILORED_AT},
    )


async def _row(s, applicant_id: uuid.UUID, posting_id: uuid.UUID):
    return (
        await s.execute(
            text(
                "SELECT stage::text, applied_at, created_at FROM job_applications"
                " WHERE applicant_id = :a AND job_id = :p"
            ),
            {"a": applicant_id, "p": posting_id},
        )
    ).first()


async def test_a_tailored_listed_job_is_saved_dated_when_it_was_tailored(database):
    async with database() as s:
        me = await _applicant(s)
        job = await _posting(s)
        await _tailored(s, me, job)
        await _tailored(s, me, None)  # a base resume: no job, nothing to save
        await s.execute(text(_backfill_sql()))
        await s.commit()

        assert tuple(await _row(s, me, job)) == ("saved", None, TAILORED_AT)
        count = await s.scalar(
            text("SELECT count(*) FROM job_applications WHERE applicant_id = :a"), {"a": me})
        assert count == 1


async def test_a_job_further_on_keeps_its_stage(database):
    async with database() as s:
        me = await _applicant(s)
        job = await _posting(s)
        await s.execute(
            text("INSERT INTO job_applications (applicant_id, job_id, stage) VALUES (:a, :p, 'applied')"),
            {"a": me, "p": job},
        )
        await _tailored(s, me, job)
        await s.execute(text(_backfill_sql()))
        await s.commit()

        assert (await _row(s, me, job))[0] == "applied"


async def test_a_closed_or_added_job_is_left_as_a_run_would_leave_it(database):
    # A run reaches only a listed posting (postings.listed), so neither is saved.
    async with database() as s:
        me = await _applicant(s)
        closed, added = await _posting(s, status="closed"), await _posting(s, added=True)
        await _tailored(s, me, closed)
        await _tailored(s, me, added)
        await s.execute(text(_backfill_sql()))
        await s.commit()

        assert await _row(s, me, closed) is None
        assert await _row(s, me, added) is None


async def test_running_it_twice_changes_nothing(database):
    async with database() as s:
        me = await _applicant(s)
        job = await _posting(s)
        await _tailored(s, me, job)
        await s.execute(text(_backfill_sql()))
        await s.execute(text(_backfill_sql()))
        await s.commit()

        count = await s.scalar(
            text("SELECT count(*) FROM job_applications WHERE applicant_id = :a"), {"a": me})
        assert count == 1
