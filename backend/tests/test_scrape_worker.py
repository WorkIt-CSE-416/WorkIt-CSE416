"""The backend's scraper worker (KAN-605): app/scraper/. Against real Postgres
(backend/CLAUDE.md, "Tests against real Postgres"). No test here reads a real
board: the provider read is replaced."""

import datetime

import pytest
from sqlalchemy import text

from app.db import get_engine
from app.scraper import schedules

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
