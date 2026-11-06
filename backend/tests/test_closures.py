"""Two-read closure detection and source tracking (KAN-619).
Against real Postgres (backend/CLAUDE.md, "Tests against real Postgres").

Seeds scraper_schedules, job_sources and job_postings directly with SQL,
then calls update_sources and detect_and_close from app.scraper.closures."""

import uuid

import pytest
from sqlalchemy import text

from app.db import get_engine
from app.scraper.closures import detect_and_close, update_sources

pytestmark = pytest.mark.anyio

URL_A = "https://boards.example.com/acme/1"
URL_B = "https://boards.example.com/acme/2"
URL_C = "https://boards.example.com/acme/3"


async def _seed_schedule(conn, *, schedule_id=None, enabled=True, prior_read_at="now()"):
    """Insert a scraper_schedules row.  Returns the id."""
    sid = schedule_id or uuid.uuid4()
    await conn.execute(text("""
        INSERT INTO scraper_schedules (id, ats, token, company, enabled, prior_read_at, last_read_at)
        VALUES (:id, 'greenhouse', :token, 'Acme', :enabled,
                CASE WHEN CAST(:prior AS text) IS NOT NULL THEN now() - interval '1 hour' END,
                now())
    """), {"id": sid, "token": str(sid), "enabled": enabled, "prior": prior_read_at})
    return sid


async def _seed_posting(conn, url, *, status="published"):
    """Insert a scraped job_postings row."""
    await conn.execute(text("""
        INSERT INTO job_postings (id, apply_url, title, company_name, status, added_by_student)
        VALUES (gen_random_uuid(), :url, 'Backend Intern', 'Acme', :status, FALSE)
    """), {"url": url, "status": status})


async def _seed_source(conn, schedule_id, url, *, stale=False):
    """Insert a job_sources row.  stale=True sets last_seen_at before the
    schedule's prior_read_at; stale=False sets it after."""
    if stale:
        sql = """INSERT INTO job_sources (id, schedule_id, apply_url, last_seen_at)
                 VALUES (gen_random_uuid(), :sid, :url, now() - interval '2 hours')"""
    else:
        sql = """INSERT INTO job_sources (id, schedule_id, apply_url, last_seen_at)
                 VALUES (gen_random_uuid(), :sid, :url, now())"""
    await conn.execute(text(sql), {"sid": schedule_id, "url": url})


async def _status(conn, url) -> str:
    row = (await conn.execute(
        text("SELECT status FROM job_postings WHERE apply_url = :url"), {"url": url}
    )).first()
    return row.status


# -- detect_and_close ---------------------------------------------------------


async def test_closes_job_stale_on_all_boards(database):
    """A job stale on every enabled board and supported by none closes."""
    async with get_engine().begin() as conn:
        board = await _seed_schedule(conn)
        await _seed_posting(conn, URL_A)
        await _seed_source(conn, board, URL_A, stale=True)

        closed = await detect_and_close(conn)

        assert closed == 1
        assert await _status(conn, URL_A) == "closed"


async def test_job_supported_by_one_board_stays_open(database):
    """A job stale on one board but fresh on another stays published."""
    async with get_engine().begin() as conn:
        board_a = await _seed_schedule(conn)
        board_b = await _seed_schedule(conn)
        await _seed_posting(conn, URL_A)
        await _seed_source(conn, board_a, URL_A, stale=True)
        await _seed_source(conn, board_b, URL_A, stale=False)

        closed = await detect_and_close(conn)

        assert closed == 0
        assert await _status(conn, URL_A) == "published"


async def test_surge_guard_refuses_mass_close(database):
    """When closing > 50% of published scraped jobs, the surge guard refuses."""
    async with get_engine().begin() as conn:
        board = await _seed_schedule(conn)
        # Seed 30 total published scraped jobs; mark 25 stale (> 50%).
        urls = [f"https://boards.example.com/acme/{i}" for i in range(30)]
        for url in urls:
            await _seed_posting(conn, url)
        for url in urls[:25]:
            await _seed_source(conn, board, url, stale=True)
        for url in urls[25:]:
            await _seed_source(conn, board, url, stale=False)

        closed = await detect_and_close(conn)

        assert closed == 0
        # All jobs stay published.
        for url in urls[:25]:
            assert await _status(conn, url) == "published"


async def test_surge_guard_allows_small_total(database):
    """When total is at or below the floor (20), any share is allowed."""
    async with get_engine().begin() as conn:
        board = await _seed_schedule(conn)
        # 10 total, all 10 stale: 100% but under the floor.
        urls = [f"https://boards.example.com/acme/{i}" for i in range(10)]
        for url in urls:
            await _seed_posting(conn, url)
            await _seed_source(conn, board, url, stale=True)

        closed = await detect_and_close(conn)

        assert closed == 10


async def test_nothing_to_close_returns_zero(database):
    """With no stale sources, detect_and_close returns 0."""
    async with get_engine().begin() as conn:
        board = await _seed_schedule(conn)
        await _seed_posting(conn, URL_A)
        await _seed_source(conn, board, URL_A, stale=False)

        assert await detect_and_close(conn) == 0


async def test_disabled_board_does_not_vote(database):
    """Sources on a disabled board are ignored by the closure query."""
    async with get_engine().begin() as conn:
        active = await _seed_schedule(conn, enabled=True)
        disabled = await _seed_schedule(conn, enabled=False)
        await _seed_posting(conn, URL_A)
        # Stale on disabled, fresh on active → stays open.
        await _seed_source(conn, disabled, URL_A, stale=True)
        await _seed_source(conn, active, URL_A, stale=False)

        assert await detect_and_close(conn) == 0
        assert await _status(conn, URL_A) == "published"


async def test_company_job_never_closed(database):
    """A company-posted job (company_id set) is never closed."""
    async with get_engine().begin() as conn:
        board = await _seed_schedule(conn)
        company_id = uuid.uuid4()
        await conn.execute(text("""
            INSERT INTO company_profiles (id, company_name, contact_email, size_range)
            VALUES (:cid, 'Acme Corp', 'hr@acme.com', 'ONE_TO_FIFTY')
        """), {"cid": company_id})
        await conn.execute(text("""
            INSERT INTO job_postings
              (id, apply_url, title, company_name, company_id, status,
               description, job_type, experience_level, work_style, added_by_student)
            VALUES (gen_random_uuid(), :url, 'Backend Intern', 'Acme Corp', :cid,
                    'published', 'desc', 'full_time', 'student', 'onsite', FALSE)
        """), {"url": URL_A, "cid": company_id})
        await _seed_source(conn, board, URL_A, stale=True)

        assert await detect_and_close(conn) == 0


async def test_student_added_job_never_closed(database):
    """A job added by a student (added_by_student=TRUE) is never closed."""
    async with get_engine().begin() as conn:
        board = await _seed_schedule(conn)
        await conn.execute(text("""
            INSERT INTO job_postings (id, apply_url, title, company_name, status, added_by_student)
            VALUES (gen_random_uuid(), :url, 'Backend Intern', 'Acme', 'published', TRUE)
        """), {"url": URL_A})
        await _seed_source(conn, board, URL_A, stale=True)

        assert await detect_and_close(conn) == 0


# -- update_sources -----------------------------------------------------------


async def test_update_sources_inserts_new_rows(database):
    """update_sources creates job_sources rows for a board's listing."""
    async with get_engine().begin() as conn:
        board = await _seed_schedule(conn)
        await update_sources(conn, board, [URL_A, URL_B])

        count = (await conn.execute(text(
            "SELECT count(*) FROM job_sources WHERE schedule_id = :sid"
        ), {"sid": board})).scalar()
        assert count == 2


async def test_update_sources_upsert_uses_greatest(database):
    """A repeat call never pushes last_seen_at backward (GREATEST)."""
    async with get_engine().begin() as conn:
        board = await _seed_schedule(conn)
        await update_sources(conn, board, [URL_A])

        # Move last_seen_at into the future.
        await conn.execute(text("""
            UPDATE job_sources SET last_seen_at = now() + interval '1 day'
            WHERE schedule_id = :sid AND apply_url = :url
        """), {"sid": board, "url": URL_A})

        future = (await conn.execute(text(
            "SELECT last_seen_at FROM job_sources WHERE schedule_id = :sid AND apply_url = :url"
        ), {"sid": board, "url": URL_A})).scalar()

        # A second upsert should not push it backward.
        await update_sources(conn, board, [URL_A])

        after = (await conn.execute(text(
            "SELECT last_seen_at FROM job_sources WHERE schedule_id = :sid AND apply_url = :url"
        ), {"sid": board, "url": URL_A})).scalar()
        assert after >= future


async def test_update_sources_empty_list_is_noop(database):
    """An empty URL list inserts nothing."""
    async with get_engine().begin() as conn:
        board = await _seed_schedule(conn)
        await update_sources(conn, board, [])

        count = (await conn.execute(text(
            "SELECT count(*) FROM job_sources WHERE schedule_id = :sid"
        ), {"sid": board})).scalar()
        assert count == 0
