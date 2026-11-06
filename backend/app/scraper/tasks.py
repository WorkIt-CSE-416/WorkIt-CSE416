"""Per-board work items with lease-based claiming.

Creates one task per due schedule, claims with FOR UPDATE SKIP LOCKED so
concurrent workers never double-read a board, and marks done/failed after.
"""

from __future__ import annotations

from datetime import timedelta

from sqlalchemy import select, text, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncConnection

from app.models.scraper import Scraper_Task

_tasks = Scraper_Task.__table__

LEASE_DURATION = timedelta(minutes=30)


async def create_tasks(conn: AsyncConnection, schedule_ids: list) -> int:
    """Insert one pending task per schedule id. Returns count inserted.

    Skips schedules that already have a pending or claimed task, so repeated
    cycles never pile up duplicate work items.
    """
    if not schedule_ids:
        return 0
    # Exclude schedules that already have an active (pending/claimed) task.
    existing = (
        await conn.execute(
            select(_tasks.c.schedule_id).where(
                _tasks.c.schedule_id.in_(schedule_ids),
                _tasks.c.status.in_(["pending", "claimed"]),
            )
        )
    ).all()
    already = {row.schedule_id for row in existing}
    to_create = [sid for sid in schedule_ids if sid not in already]
    if not to_create:
        return 0
    result = await conn.execute(
        insert(_tasks).values([{"schedule_id": sid} for sid in to_create])
    )
    return result.rowcount


async def claim_task(conn: AsyncConnection, worker_id: str) -> object | None:
    """Claim one pending task with FOR UPDATE SKIP LOCKED. Returns the row or None."""
    # Raw SQL: SQLAlchemy Core doesn't expose SKIP LOCKED on UPDATE ... RETURNING.
    result = await conn.execute(
        text("""
            UPDATE scraper_tasks
            SET status = 'claimed',
                claimed_by = :worker,
                claimed_at = now(),
                lease_expires_at = now() + :lease
            WHERE id = (
                SELECT id FROM scraper_tasks
                WHERE status = 'pending'
                ORDER BY created_at
                FOR UPDATE SKIP LOCKED
                LIMIT 1
            )
            RETURNING *
        """),
        {
            "worker": worker_id,
            "lease": LEASE_DURATION,
        },
    )
    return result.first()


async def mark_started(conn: AsyncConnection, task_id) -> None:
    """Record when the actual scrape began."""
    await conn.execute(
        update(_tasks).where(_tasks.c.id == task_id).values(started_at=text("now()"))
    )


async def mark_done(
    conn: AsyncConnection,
    task_id,
    *,
    boards_s: float | None = None,
    pages_s: float | None = None,
) -> None:
    """Mark a task as successfully completed."""
    await conn.execute(
        update(_tasks)
        .where(_tasks.c.id == task_id)
        .values(
            status="done",
            finished_at=text("now()"),
            boards_s=boards_s,
            pages_s=pages_s,
        )
    )


async def mark_failed(
    conn: AsyncConnection, task_id, *, error: str | None = None
) -> None:
    """Mark a task as failed."""
    await conn.execute(
        update(_tasks)
        .where(_tasks.c.id == task_id)
        .values(
            status="failed",
            finished_at=text("now()"),
            error=error[:2000] if error else None,
        )
    )


async def expire_leases(conn: AsyncConnection) -> int:
    """Reset stale claimed tasks back to pending. Returns count expired."""
    result = await conn.execute(
        update(_tasks)
        .where(
            _tasks.c.status == "claimed",
            _tasks.c.lease_expires_at <= text("now()"),
        )
        .values(
            status="pending",
            claimed_by=None,
            claimed_at=None,
            lease_expires_at=None,
        )
    )
    return result.rowcount
