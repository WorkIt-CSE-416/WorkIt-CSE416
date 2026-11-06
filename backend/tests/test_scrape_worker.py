"""The backend's scraper worker (KAN-605): app/scraper/. Against real Postgres
(backend/CLAUDE.md, "Tests against real Postgres"). No test here reads a real
board: the provider read is replaced."""

import datetime

import pytest
from sqlalchemy import text

from app.db import get_engine
from app.scraper import schedules, worker

pytestmark = pytest.mark.anyio


@pytest.fixture
def boards_csv(tmp_path):
    path = tmp_path / "boards.csv"
    path.write_text("ats,token,company\ngreenhouse,acme,Acme\n", encoding="utf-8")
    return path


async def _schedule(conn) -> object:
    return (await conn.execute(text("SELECT * FROM scraper_schedules"))).one()


async def test_a_complete_read_keeps_the_one_before(database, boards_csv):
    async with get_engine().begin() as conn:
        await schedules.sync_catalog(conn, boards_csv)
        row = await _schedule(conn)
        first = text("'2026-11-01T00:00:00+00'::timestamptz")
        second = text("'2026-11-02T00:00:00+00'::timestamptz")
        await schedules.advance_reads(conn, row.id, now_expr=first)
        await schedules.advance_reads(conn, row.id, now_expr=second)
        row = await _schedule(conn)
    assert row.prior_read_at == datetime.datetime(2026, 11, 1, tzinfo=datetime.UTC)
    assert row.last_read_at == datetime.datetime(2026, 11, 2, tzinfo=datetime.UTC)


async def test_a_dry_run_writes_nothing(database, boards_csv, monkeypatch):
    monkeypatch.setattr(worker, "sync_catalog", lambda conn: schedules.sync_catalog(conn, boards_csv))
    async with get_engine().connect() as conn:
        summary = await worker.run_cycle(conn, dry_run=True)
    assert summary["synced"] == 1
    assert summary["tasks_created"] == 1
    async with get_engine().connect() as conn:
        for table in ("scraper_schedules", "scraper_tasks"):
            assert await conn.scalar(text(f"SELECT count(*) FROM {table}")) == 0


def _job(title: str, number: int):
    from workit_scraper.providers import Job

    return Job("ashby", "acme", "Acme", str(number), title, f"https://jobs.ashbyhq.com/acme/{number}")


def test_a_board_read_goes_through_read_board_and_the_shortlist(monkeypatch):
    from workit_scraper.board_read import BoardRead, ReadStatus
    from workit_scraper.providers import Board

    jobs = [_job("Software Engineering Intern", 1), _job("Senior Account Executive", 2)]
    calls = []

    def read_board(board, robots):
        calls.append(board)
        return BoardRead(ReadStatus.OK, jobs=jobs)

    monkeypatch.setattr(worker, "read_board", read_board)
    result, kept, *_ = worker.read_board_shortlist(Board("ashby", "acme", "Acme"))
    assert calls == [Board("ashby", "acme", "Acme")]
    assert result.jobs == jobs
    assert [job.title for job in kept] == ["Software Engineering Intern"]


def test_a_board_robots_txt_forbids_yields_nothing(monkeypatch):
    from workit_scraper.board_read import BoardRead, ReadStatus
    from workit_scraper.providers import Board

    monkeypatch.setattr(
        worker, "read_board", lambda board, robots: BoardRead(ReadStatus.SKIPPED, reason="robots.txt")
    )
    result, kept, *_ = worker.read_board_shortlist(Board("ashby", "acme", "Acme"))
    assert result.status is ReadStatus.SKIPPED
    assert kept == []


def _read_one_intern(monkeypatch, boards_csv):
    from workit_scraper.board_read import BoardRead, ReadStatus

    job = _job("Software Engineering Intern", 1)
    monkeypatch.setattr(worker, "sync_catalog", lambda conn: schedules.sync_catalog(conn, boards_csv))
    monkeypatch.setattr(
        worker, "read_board_shortlist",
        lambda board: (BoardRead(ReadStatus.OK, jobs=[job]), [job], 1.0, 0.5),
    )
    return job


async def _checkpoint() -> tuple:
    async with get_engine().connect() as conn:
        task = (await conn.execute(text("SELECT status, error FROM scraper_tasks"))).one()
        read_at = await conn.scalar(text("SELECT last_read_at FROM scraper_schedules"))
        jobs = await conn.scalar(text("SELECT count(*) FROM job_postings"))
    return task, read_at, jobs


async def test_a_board_is_checkpointed_with_its_published_jobs(database, boards_csv, monkeypatch):
    _read_one_intern(monkeypatch, boards_csv)
    async with get_engine().connect() as conn:
        summary = await worker.run_cycle(conn)
    task, read_at, jobs = await _checkpoint()
    assert summary["jobs_scraped"] == 1
    assert task.status == "done"
    assert read_at is not None
    assert jobs == 1


async def test_a_failed_publish_leaves_the_board_unread(database, boards_csv, monkeypatch):
    from app.scripts import import_jobs

    _read_one_intern(monkeypatch, boards_csv)

    async def refuse(*args, **kwargs):
        raise import_jobs.ImportRefused("no")

    monkeypatch.setattr(import_jobs, "import_feed", refuse)
    async with get_engine().connect() as conn:
        summary = await worker.run_cycle(conn)
    assert summary["boards_failed"] == 1
    task, read_at, jobs = await _checkpoint()
    assert task.status == "failed"
    assert task.error.startswith("publish failed")
    assert read_at is None
    assert jobs == 0
