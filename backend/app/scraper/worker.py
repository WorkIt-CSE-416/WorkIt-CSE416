"""Orchestrate one scrape cycle: sync catalog, create tasks, claim, scrape,
checkpoint observations, publish to job_postings.

Each board completes independently. A crash after upsert_observations but
before publish leaves observations in place; recovery re-publishes them.
"""

from __future__ import annotations

import asyncio
import logging
import time
import uuid

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncConnection
from workit_scraper.providers import PROVIDERS, BoardNotFound

from app.scraper.observations import upsert_observations
from app.scraper.schedules import (
    advance_reads,
    record_failure,
    record_missing,
    select_due,
    sync_catalog,
)
from app.scraper.tasks import (
    claim_task,
    create_tasks,
    expire_leases,
    mark_done,
    mark_failed,
    mark_started,
)

logger = logging.getLogger(__name__)

# ponytail: SURGE guard uses same threshold as __main__.scrape
SURGE = 3


async def run_cycle(conn: AsyncConnection, *, dry_run: bool = False) -> dict:
    """One full worker cycle. Returns a summary dict."""
    worker_id = f"worker-{uuid.uuid4().hex[:8]}"
    summary = {
        "worker": worker_id,
        "synced": 0,
        "tasks_created": 0,
        "boards_ok": 0,
        "boards_missing": 0,
        "boards_failed": 0,
        "observations_new": 0,
        "dry_run": dry_run,
    }

    # 1. Sync boards.csv into scraper_schedules.
    summary["synced"] = await sync_catalog(conn)
    await conn.commit()

    # 2. Expire any stale leases from prior crashes.
    expired = await expire_leases(conn)
    if expired:
        logger.info("Expired %d stale task leases", expired)
    await conn.commit()

    # 3. Select due schedules and create tasks.
    due = await select_due(conn)
    schedule_ids = [row.id for row in due]
    summary["tasks_created"] = await create_tasks(conn, schedule_ids)
    await conn.commit()

    if dry_run:
        logger.info("Dry run: would process %d boards", len(due))
        return summary

    # 4. Claim and process tasks.
    while True:
        task = await claim_task(conn, worker_id)
        await conn.commit()
        if task is None:
            break

        await _process_task(conn, task, summary)

    return summary


async def _process_task(conn: AsyncConnection, task, summary: dict) -> None:
    """Scrape one board, upsert observations, advance schedule reads."""
    schedule = (
        await conn.execute(
            text("SELECT * FROM scraper_schedules WHERE id = :sid"),
            {"sid": task.schedule_id},
        )
    ).first()

    if schedule is None:
        await mark_failed(conn, task.id, error="schedule not found")
        await conn.commit()
        return

    provider = PROVIDERS.get(schedule.ats)
    if provider is None:
        await mark_failed(conn, task.id, error=f"unknown provider: {schedule.ats}")
        await record_failure(conn, task.schedule_id)
        await conn.commit()
        summary["boards_failed"] += 1
        return

    await mark_started(conn, task.id)
    await conn.commit()

    t0 = time.monotonic()
    try:
        jobs = await asyncio.to_thread(provider.read, schedule.token, schedule.company)
    except BoardNotFound:
        boards_s = time.monotonic() - t0
        logger.info("Board %s/%s: not found", schedule.ats, schedule.token)
        await record_missing(conn, task.schedule_id)
        await mark_done(conn, task.id, boards_s=boards_s)
        await conn.commit()
        summary["boards_missing"] += 1
        return
    except Exception as exc:
        boards_s = time.monotonic() - t0
        logger.warning(
            "Board %s/%s failed: %s", schedule.ats, schedule.token, exc, exc_info=True
        )
        await record_failure(conn, task.schedule_id)
        await mark_failed(conn, task.id, error=str(exc))
        await conn.commit()
        summary["boards_failed"] += 1
        return

    boards_s = time.monotonic() - t0

    # Upsert observations.
    new = await upsert_observations(conn, task.schedule_id, task.id, jobs)
    summary["observations_new"] += new

    # Advance reads on the schedule.
    await advance_reads(conn, task.schedule_id)
    await mark_done(conn, task.id, boards_s=boards_s)
    await conn.commit()
    summary["boards_ok"] += 1

    logger.info(
        "Board %s/%s: %d jobs (%d new), %.1fs",
        schedule.ats,
        schedule.token,
        len(jobs),
        new,
        boards_s,
    )
