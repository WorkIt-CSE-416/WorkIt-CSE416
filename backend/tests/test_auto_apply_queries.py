"""
Auto apply's layer-1 queries and the stage-aware KAN-232 ones. They need
Postgres, which tests don't have, so each is tested by the SQL it sends.
"""

import asyncio
import uuid
from unittest.mock import MagicMock

from sqlalchemy.dialects import postgresql

from app.auto_apply import queries
from app.models.dto import application_stage
from app.queries import applications
from app.queries.jobs.filters import JobFilters, matching
from tests.test_jobs import _sql

APPLICANT = uuid.UUID("0b8e8f3c-6a0e-4f43-9d55-6c1d7b0d9a11")
JOB = uuid.UUID("5a1d2c3e-0000-4000-8000-000000000001")


class Recorder:
    """A session that keeps every statement and answers nothing."""

    def __init__(self, scalar=None):
        self.sent = []
        self.answer = scalar

    async def _keep(self, statement, *args, **kwargs):
        self.sent.append(statement)
        result = MagicMock()
        result.first.return_value = None
        result.__iter__.return_value = iter([])
        return result

    execute = scalars = _keep

    async def scalar(self, statement):
        self.sent.append(statement)
        return self.answer

    async def commit(self):
        pass

    def sql(self, i=-1):
        return str(self.sent[i].compile(dialect=postgresql.dialect()))


def test_queue_inserts_only_listed_jobs_and_moves_only_saved_rows():
    db = Recorder()
    asyncio.run(queries.queue_applications(db, APPLICANT, [JOB]))
    sql = db.sql()
    assert sql.startswith(
        "INSERT INTO job_applications (applicant_id, job_id, stage, applied_at) SELECT"
    )
    assert "CAST(NULL AS TIMESTAMP WITH TIME ZONE)" in sql
    assert "CAST(%(param_2)s AS application_stage)" in sql
    assert "job_postings.company_id IS NULL" in sql
    assert "job_postings.status = %(status_1)s" in sql
    assert "job_postings.apply_url ~* %(apply_url_1)s" in sql  # the hiring systems the extension fills (hosts.py)
    # Only a saved job moves to queued; any other stage keeps its row.
    assert "ON CONFLICT (applicant_id, job_id) DO UPDATE SET stage = " in sql
    assert "created_at = now()" in sql
    assert "WHERE job_applications.stage = %(stage_1)s" in sql
    assert db.sent[-1].compile().params["stage_1"] == application_stage.saved
    assert "RETURNING job_applications.job_id" in sql


def test_queue_nothing_sends_nothing():
    db = Recorder()
    assert asyncio.run(queries.queue_applications(db, APPLICANT, [])) == set()
    assert db.sent == []


def test_next_is_the_oldest_queued_open_one():
    db = Recorder()
    assert asyncio.run(queries.fetch_next_application(db, APPLICANT)) is None
    sql = db.sql()
    assert "job_applications.stage = %(stage_1)s" in sql
    assert "ORDER BY job_applications.created_at, job_applications.job_id" in sql
    assert "LIMIT" in sql
    assert db.sent[-1].compile().params["stage_1"] == application_stage.queued


def test_one_application_is_this_applicants_for_this_job():
    db = Recorder()
    assert asyncio.run(queries.fetch_application(db, APPLICANT, JOB)) is None
    sql = db.sql()
    assert "job_applications.applicant_id = %(applicant_id_1)s::UUID" in sql
    assert "job_applications.job_id = %(job_id_1)s::UUID" in sql


def test_list_filters_by_stage_newest_first():
    db = Recorder()
    asyncio.run(queries.fetch_applications(db, APPLICANT, [application_stage.queued]))
    sql = db.sql()
    assert "job_applications.stage IN" in sql
    assert "ORDER BY job_applications.created_at DESC" in sql


def test_set_stage_applied_dates_the_submit_now():
    db = Recorder()
    asyncio.run(queries.set_stage(db, APPLICANT, JOB, application_stage.applied))
    assert "applied_at=now()" in db.sql()


def test_set_stage_skipped_clears_the_date():
    db = Recorder()
    asyncio.run(queries.set_stage(db, APPLICANT, JOB, application_stage.skipped))
    assert "applied_at=%(applied_at)s" in db.sql()


def test_mark_applied_turns_a_queued_job_applied_and_keeps_a_first_date():
    db = Recorder(scalar=JOB)  # the job is listed
    asyncio.run(applications.mark_applied(db, APPLICANT, JOB))
    sql = db.sql(1)  # after the "is it listed" read
    # A stage before applied becomes applied; a later one keeps itself
    # (KAN-413). Only stages every database has are named.
    assert "ON CONFLICT (applicant_id, job_id) DO UPDATE SET stage = CASE WHEN" in sql
    assert "ELSE job_applications.stage END" in sql
    # The first date stays (KAN-267 dropped the WHERE, so a second mark can
    # still change the resume it names); no body leaves that resume alone.
    # One not applied yet is dated now, whatever date it held (KAN-369).
    assert (
        "applied_at = CASE WHEN (job_applications.stage IN (__[POSTCOMPILE_stage_2]))"
        " THEN now() ELSE coalesce(job_applications.applied_at, now()) END"
    ) in sql
    assert "sent_resume_id" not in sql


def test_the_feed_hides_applied_jobs_only():
    # Interviewing, offer and rejected were applied too (KAN-413), asked as
    # NOT IN the stages before applied, so the query never names a value a
    # database without a7d3e5f1c2b4 lacks
    (clause,) = matching(JobFilters(applied_by=APPLICANT))
    sql = _sql(clause)
    assert "job_applications.stage NOT IN ('saved', 'queued', 'needs_you', 'skipped')" in sql
    for later in ("interviewing", "offer", "rejected"):
        assert later not in sql


def test_matches_hide_every_job_with_an_application_saved_ones_too():
    # A batch never picks a saved job: only the student's own click queues it.
    (clause,) = matching(JobFilters(no_application_by=APPLICANT))
    sql = _sql(clause)
    assert sql.startswith("NOT (EXISTS (SELECT")
    assert "stage" not in sql


def test_matches_can_take_only_jobs_auto_apply_fills():
    assert matching(JobFilters()) == []
    (clause,) = matching(JobFilters(auto_apply_only=True))
    sql = _sql(clause)
    # Its apply_url is a hiring system's form, or a job board's posting names one (KAN-376).
    assert sql.startswith("CASE WHEN (job_postings.apply_url ~* '^https?://")
    assert "greenhouse\\.io" in sql and "linkedin\\.com" in sql
    assert sql.endswith("END IS NOT NULL")
