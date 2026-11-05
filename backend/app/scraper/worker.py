"""Orchestrate one scrape cycle: sync catalog, create tasks, claim, scrape,
publish to job_postings via import_feed.

Each board completes independently. At the end of the claim loop, all scraped
jobs are published through import_feed in one transaction.
"""

from __future__ import annotations

import asyncio
import logging
import time
import uuid

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncConnection
from workit_scraper.providers import PROVIDERS, BoardNotFound

from app.schemas.jobs import JobListing
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

# Same work_style mapping as feed.py.
_WORK_STYLE = {"Remote": "remote", "Hybrid": "hybrid", "On site": "onsite"}


def job_to_listing(job, company: str) -> JobListing:
    """Convert a provider's Job object into a JobListing for import_feed."""
    facts = job.page.facts if job.page else None
    pay = facts.pay if facts else None

    return JobListing(
        id=job.apply_url,
        title=job.title,
        company=company,
        apply_url=job.apply_url,
        experience_level=_experience_level(facts),
        work_style=_work_style(job, facts),
        location=job.location,
        location_label=None,
        posted_at=job.posted_at,
        logo_url=None,
        company_domain=None,
        description=job.page.description if job.page else None,
        job_type=_job_type(facts),
        salary=None,
        salary_min=pay.low if pay else None,
        salary_max=pay.high if pay else None,
        salary_currency=pay.currency if pay else None,
        salary_period=pay.period if pay else None,
        min_years_experience=facts.min_years if facts else None,
        start_term=facts.start_term if facts else None,
        sponsorship=facts.sponsorship if facts else None,
    )


def _experience_level(facts) -> str | None:
    if facts is None:
        return None
    jt = facts.job_type
    if jt is None:
        return None
    if jt == "internship":
        return "student"
    return "new_grad"


def _job_type(facts) -> str | None:
    if facts is None:
        return None
    return facts.job_type


def _work_style(job, facts) -> str | None:
    # The job-level work_style (from the listing, e.g. Rippling) takes priority.
    ws = job.work_style
    if ws:
        return _WORK_STYLE.get(ws)
    if facts and facts.work_style:
        return _WORK_STYLE.get(facts.work_style)
    return None


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
        "jobs_scraped": 0,
        "dry_run": dry_run,
    }

    # 1-3 in one transaction, which a dry run rolls back: it reports what the
    # cycle would sync and queue, and writes nothing.
    # 1. Sync boards.csv into scraper_schedules.
    summary["synced"] = await sync_catalog(conn)

    # 2. Expire any stale leases from prior crashes.
    expired = await expire_leases(conn)
    if expired:
        logger.info("Expired %d stale task leases", expired)

    # 3. Select due schedules and create tasks.
    due = await select_due(conn)
    schedule_ids = [row.id for row in due]
    summary["tasks_created"] = await create_tasks(conn, schedule_ids)

    if dry_run:
        await conn.rollback()
        logger.info("Dry run: would process %d boards; nothing was written", len(due))
        return summary
    await conn.commit()

    # 4. Claim and process tasks, accumulating listings.
    all_listings: list[JobListing] = []

    while True:
        task = await claim_task(conn, worker_id)
        await conn.commit()
        if task is None:
            break

        listings = await _process_task(conn, task, summary)
        all_listings.extend(listings)

    # 5. Publish all scraped jobs through import_feed.
    if all_listings:
        from app.scripts.import_jobs import import_feed

        await import_feed(conn, all_listings)
        await conn.commit()
        logger.info("Published %d listings through import_feed", len(all_listings))

    summary["jobs_scraped"] = len(all_listings)
    return summary


async def _process_task(conn: AsyncConnection, task, summary: dict) -> list[JobListing]:
    """Scrape one board, advance schedule reads. Returns JobListing objects."""
    schedule = (
        await conn.execute(
            text("SELECT * FROM scraper_schedules WHERE id = :sid"),
            {"sid": task.schedule_id},
        )
    ).first()

    if schedule is None:
        await mark_failed(conn, task.id, error="schedule not found")
        await conn.commit()
        return []

    provider = PROVIDERS.get(schedule.ats)
    if provider is None:
        await mark_failed(conn, task.id, error=f"unknown provider: {schedule.ats}")
        await record_failure(conn, task.schedule_id)
        await conn.commit()
        summary["boards_failed"] += 1
        return []

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
        return []
    except Exception as exc:
        boards_s = time.monotonic() - t0
        logger.warning(
            "Board %s/%s failed: %s", schedule.ats, schedule.token, exc, exc_info=True
        )
        await record_failure(conn, task.schedule_id)
        await mark_failed(conn, task.id, error=str(exc))
        await conn.commit()
        summary["boards_failed"] += 1
        return []

    boards_s = time.monotonic() - t0

    # Convert provider Jobs to JobListing objects.
    listings = [job_to_listing(job, schedule.company) for job in jobs]

    # Advance reads on the schedule and mark task done.
    await advance_reads(conn, task.schedule_id)
    await mark_done(conn, task.id, boards_s=boards_s)
    await conn.commit()
    summary["boards_ok"] += 1

    logger.info(
        "Board %s/%s: %d jobs, %.1fs",
        schedule.ats,
        schedule.token,
        len(jobs),
        boards_s,
    )

    return listings
