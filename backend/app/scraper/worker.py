"""Orchestrate one scrape cycle: sync catalog, create tasks, claim, scrape,
publish to job_postings via import_feed, update per-board source records and
close jobs gone from all boards.

Each board completes independently. At the end of the claim loop, one
transaction publishes through import_feed (upsert only), records which boards
list which jobs (job_sources), advances each board's read timestamps, detects
jobs stale on every board (two-complete-read rule) and closes them.
"""

from __future__ import annotations

import asyncio
import logging
import time
import uuid
from dataclasses import dataclass

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncConnection
from workit_scraper import providers
from workit_scraper.board_read import BoardRead, ReadStatus, read_board
from workit_scraper.polite import Robots
from workit_scraper.providers import PROVIDERS, Board, Job
from workit_scraper.shortlist import classify, classify_with_description

from app.schemas.jobs import JobListing
from app.scraper.closures import detect_and_close, update_sources
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


def read_board_shortlist(board: Board) -> tuple[BoardRead, list[Job], float, float]:
    """One board read as the scheduled scrape reads it (workit_scraper.__main__):
    `read_board`'s robots.txt check and pacing, then each kept posting's own
    page (`with_page`), then the shortlist (`classify_with_description`), so
    only the postings the feed would carry are published, with their
    descriptions and facts. Blocking: run it in a thread. Also returns how long
    the board and the pages took.

    No store is carried in, so every kept posting's page is read, each run."""
    robots = Robots()
    t0 = time.monotonic()
    result = read_board(board, robots)
    boards_s = time.monotonic() - t0
    if result.status is not ReadStatus.OK:
        return result, [], boards_s, 0.0
    t1 = time.monotonic()
    paged = [_with_page(job, robots) for job in result.jobs]
    pages_s = time.monotonic() - t1
    kept = [job for job in paged if classify_with_description(job.title, job.description)]
    return result, kept, boards_s, pages_s


def _with_page(job: Job, robots: Robots) -> Job:
    """workit_scraper.__main__'s `with_page`, which can't be imported here:
    importing that module reads scraper/checked_websites.csv, which the
    installed package doesn't carry. The posting with its own page read when
    its provider's list leaves the page out and its title is shortlisted;
    a page robots.txt forbids, or that fails, leaves it without one."""
    provider = PROVIDERS.get(job.ats)
    current = job.page is not None and job.page.version == providers.PAGE_VERSION
    if not (provider and provider.job_url and not current and classify(job.title)):
        return job
    url = providers.job_url(job.ats, job.token, job.external_id)
    if not robots.allows(url):
        return job
    robots.pace(url)
    try:
        return providers.describe(job)
    except Exception:  # A missing description is not a failed board.
        logger.warning("%s: no description", job.key, exc_info=True)
        return job


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
        "jobs_closed": 0,
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

    # 4. Claim and process tasks, accumulating listings. A board read whole is
    # not checkpointed yet: its task stays claimed until its jobs publish.
    all_listings: list[JobListing] = []
    read: list[_Read] = []

    while True:
        task = await claim_task(conn, worker_id)
        await conn.commit()
        if task is None:
            break

        done = await _process_task(conn, task, summary)
        if done is not None:
            read.append(done)
            all_listings.extend(done.listings)

    # 5. One transaction: publish, record sources, advance reads, detect
    # closures and mark done.  If anything fails, no board looks read and
    # the next cycle reads it again.
    try:
        if all_listings:
            from app.scripts.import_jobs import import_feed

            await import_feed(conn, all_listings, close_missing=False)
        for done in read:
            await update_sources(
                conn,
                done.schedule_id,
                [l.apply_url for l in done.listings],
            )
            await advance_reads(conn, done.schedule_id)
        summary["jobs_closed"] = await detect_and_close(conn)
        for done in read:
            await mark_done(
                conn, done.task_id, boards_s=done.boards_s, pages_s=done.pages_s
            )
        await conn.commit()
    except Exception as exc:
        await conn.rollback()
        for done in read:
            await mark_failed(conn, done.task_id, error=f"publish failed: {exc}")
        await conn.commit()
        raise
    if all_listings:
        logger.info("Published %d listings through import_feed", len(all_listings))

    summary["jobs_scraped"] = len(all_listings)
    return summary


@dataclass(frozen=True)
class _Read:
    """A board read whole, waiting for its jobs to publish before its task is
    marked done and its schedule advanced."""

    task_id: object
    schedule_id: object
    listings: list[JobListing]
    boards_s: float
    pages_s: float


async def _process_task(conn: AsyncConnection, task, summary: dict) -> _Read | None:
    """Scrape one board. A board read whole comes back as a `_Read` for
    `run_cycle` to publish and checkpoint; any other outcome is recorded here
    and comes back as None."""
    schedule = (
        await conn.execute(
            text("SELECT * FROM scraper_schedules WHERE id = :sid"),
            {"sid": task.schedule_id},
        )
    ).first()

    if schedule is None:
        await mark_failed(conn, task.id, error="schedule not found")
        await conn.commit()
        return None

    provider = PROVIDERS.get(schedule.ats)
    if provider is None:
        await mark_failed(conn, task.id, error=f"unknown provider: {schedule.ats}")
        await record_failure(conn, task.schedule_id)
        await conn.commit()
        summary["boards_failed"] += 1
        return None

    await mark_started(conn, task.id)
    await conn.commit()

    board = Board(schedule.ats, schedule.token, schedule.company)
    result, jobs, boards_s, pages_s = await asyncio.to_thread(read_board_shortlist, board)
    if result.status is ReadStatus.MISSING:
        logger.info("Board %s/%s: not found", schedule.ats, schedule.token)
        await record_missing(conn, task.schedule_id)
        await mark_done(conn, task.id, boards_s=boards_s)
        await conn.commit()
        summary["boards_missing"] += 1
        return None
    if result.status is not ReadStatus.OK:
        # FAILED, or SKIPPED (robots.txt, too large): no complete read, which
        # is evidence of nothing, and the board rests after enough of them.
        error = f"{result.reason}: {result.error}" if result.error else result.reason
        logger.warning("Board %s/%s unread: %s", schedule.ats, schedule.token, error)
        await record_failure(conn, task.schedule_id)
        await mark_failed(conn, task.id, error=error)
        await conn.commit()
        summary["boards_failed"] += 1
        return None

    # Convert provider Jobs to JobListing objects.
    listings = [job_to_listing(job, schedule.company) for job in jobs]

    summary["boards_ok"] += 1

    logger.info(
        "Board %s/%s: %d of %d postings kept, %.1fs + %.1fs pages",
        schedule.ats,
        schedule.token,
        len(jobs),
        len(result.jobs),
        boards_s,
        pages_s,
    )

    return _Read(task.id, task.schedule_id, listings, boards_s, pages_s)
