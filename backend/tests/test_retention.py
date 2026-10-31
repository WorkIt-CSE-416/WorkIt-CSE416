"""
The retention purge (KAN-482), against real Postgres: for each table, a row
just past its period is deleted and a row just inside it is kept.
"""

import datetime
import uuid

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_engine
from app.services import retention
from app.services.retention import Rule, purge

pytestmark = pytest.mark.anyio

NOW = datetime.datetime(2026, 10, 31, 12, 0, tzinfo=datetime.UTC)
MINUTE = datetime.timedelta(minutes=1)


async def _account(session) -> uuid.UUID:
    account_id = uuid.uuid4()
    await session.execute(text("INSERT INTO auth.users (id) VALUES (:id)"), {"id": account_id})
    return account_id


async def _fill_report(session, note: str, created_at, account_id=None) -> None:
    await session.execute(
        text(
            "INSERT INTO fill_reports (account_id, job_system, posting_url, engine_version,"
            " fields, note, created_at)"
            " VALUES (:account_id, 'greenhouse', 'https://example.com/job', '0.3.1',"
            " '[]'::jsonb, :note, :created_at)"
        ),
        {"account_id": account_id, "note": note, "created_at": created_at},
    )


async def _notes(session) -> set[str]:
    return set((await session.scalars(text("SELECT note FROM fill_reports"))).all())


async def test_fix_reports_past_a_year_are_deleted_with_or_without_an_account(database):
    year = datetime.timedelta(days=365)
    async with database() as session:
        account_id = await _account(session)
        await _fill_report(session, "old", NOW - year - MINUTE, account_id)
        await _fill_report(session, "old, no account", NOW - year - MINUTE)
        await _fill_report(session, "recent", NOW - year + MINUTE, account_id)
        await _fill_report(session, "recent, no account", NOW - year + MINUTE)
        await session.commit()

    async with database() as session:
        counts = await purge(session, now=NOW)

    assert counts["fill_reports"] == 2
    async with database() as session:
        assert await _notes(session) == {"recent", "recent, no account"}


async def test_ai_usage_counters_past_30_days_are_deleted(database):
    today = NOW.date()
    async with database() as session:
        account_id = await _account(session)
        for days_ago in (31, 30):
            day = today - datetime.timedelta(days=days_ago)
            # One account row and one pool row (account_id NULL) per day.
            for owner in (account_id, None):
                await session.execute(
                    text(
                        "INSERT INTO ai_usage_counters (account_id, feature, day, count)"
                        " VALUES (:a, 'tailor', :day, 3)"
                    ),
                    {"a": owner, "day": day},
                )
        await session.commit()

    async with database() as session:
        counts = await purge(session, now=NOW)

    assert counts["ai_usage_counters"] == 2
    async with database() as session:
        days = (await session.scalars(text("SELECT DISTINCT day FROM ai_usage_counters"))).all()
    assert days == [datetime.date(2026, 10, 1)]


async def test_read_notifications_past_90_days_are_deleted_unread_ones_kept(database):
    period = datetime.timedelta(days=90)
    async with database() as session:
        applicant_id = await _account(session)
        await session.execute(
            text("INSERT INTO applicant_profiles (id, email, full_name) VALUES (:id, 'sam@example.com', 'Sam')"),
            {"id": applicant_id},
        )
        for title, created_at, read_at in (
            ("old read", NOW - period - MINUTE, NOW - period),
            ("old unread", NOW - period - MINUTE, None),
            ("recent read", NOW - period + MINUTE, NOW),
        ):
            await session.execute(
                text(
                    "INSERT INTO notifications (applicant_id, type, title, body, created_at, read_at)"
                    " VALUES (:a, 'job_alert', :title, 'digest', :created_at, :read_at)"
                ),
                {"a": applicant_id, "title": title, "created_at": created_at, "read_at": read_at},
            )
        await session.commit()

    async with database() as session:
        counts = await purge(session, now=NOW)

    assert counts["notifications"] == 1
    async with database() as session:
        titles = set((await session.scalars(text("SELECT title FROM notifications"))).all())
    assert titles == {"old unread", "recent read"}


async def test_fill_events_past_90_days_are_deleted(database):
    # KAN-476's table does not exist yet: a temporary one of the same name
    # stands in (it shadows a real one too, so this keeps working after).
    # The session is held to one connection, where the temporary table lives.
    period = datetime.timedelta(days=90)
    async with get_engine().connect() as connection, AsyncSession(bind=connection) as session:
        await session.execute(
            text("CREATE TEMPORARY TABLE fill_events (name text, created_at timestamptz)")
        )
        await session.execute(
            text("INSERT INTO fill_events VALUES ('old', :old), ('recent', :recent)"),
            {"old": NOW - period - MINUTE, "recent": NOW - period + MINUTE},
        )
        counts = await purge(session, now=NOW)
        names = (await session.scalars(text("SELECT name FROM fill_events"))).all()

    assert counts["fill_events"] == 1
    assert names == ["recent"]


async def test_a_table_that_does_not_exist_is_skipped(database, monkeypatch):
    monkeypatch.setattr(
        retention,
        "RETENTION",
        (Rule("no_such_table", "created_at", 1), *retention.RETENTION),
    )
    year = datetime.timedelta(days=365)
    async with database() as session:
        await _fill_report(session, "old", NOW - year - MINUTE)
        await session.commit()

    async with database() as session:
        counts = await purge(session, now=NOW)

    assert counts["no_such_table"] is None
    assert counts["fill_reports"] == 1


async def test_a_dry_run_counts_what_it_would_delete_and_deletes_nothing(database):
    year = datetime.timedelta(days=365)
    async with database() as session:
        await _fill_report(session, "old", NOW - year - MINUTE)
        await _fill_report(session, "recent", NOW - year + MINUTE)
        await session.commit()

    async with database() as session:
        counts = await purge(session, now=NOW, dry_run=True)

    assert counts["fill_reports"] == 1
    async with database() as session:
        assert await _notes(session) == {"old", "recent"}
