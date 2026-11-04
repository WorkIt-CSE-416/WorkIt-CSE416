"""Per-posting versioned state: upsert, listed check and closing detection.

Each scrape of a board upserts its postings here. The two-read closing logic
from store.py is reimplemented in SQL: a posting whose last_seen_at matches
neither the schedule's last_read_at nor prior_read_at is gone from board.
"""

from __future__ import annotations

from sqlalchemy import text
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncConnection

from app.models.scraper import Scraper_Observation

_obs = Scraper_Observation.__table__


async def upsert_observations(
    conn: AsyncConnection,
    schedule_id,
    task_id,
    jobs: list,
    *,
    now_expr=text("now()"),
) -> int:
    """Upsert scraped jobs into scraper_observations. Returns count of new rows.

    Each Job from the provider becomes one row keyed on (schedule_id, external_id).
    first_seen_at is set once on insert and carried forward on conflict.
    """
    if not jobs:
        return 0

    rows = [
        {
            "schedule_id": schedule_id,
            "task_id": task_id,
            "external_id": job.external_id,
            "apply_url": job.apply_url,
            "title": job.title,
            "company": job.company,
            "location": getattr(job, "location", None),
            "description": job.description,
            "posted_at": job.posted_at,
            "first_seen_at": now_expr,
            "last_seen_at": now_expr,
            "page_version": job.page.version if job.page else None,
            "facts": _facts_json(job),
            "metadata": _meta_json(job),
        }
        for job in jobs
    ]

    new_count = 0
    for start in range(0, len(rows), 500):
        chunk = rows[start : start + 500]
        stmt = insert(_obs).values(chunk)
        stmt = stmt.on_conflict_do_update(
            constraint="scraper_observations_schedule_id_external_id_key",
            set_={
                "task_id": stmt.excluded.task_id,
                "apply_url": stmt.excluded.apply_url,
                "title": stmt.excluded.title,
                "company": stmt.excluded.company,
                "location": stmt.excluded.location,
                "description": stmt.excluded.description,
                "posted_at": stmt.excluded.posted_at,
                # Carry forward first_seen_at: never overwrite.
                "last_seen_at": stmt.excluded.last_seen_at,
                "page_version": stmt.excluded.page_version,
                "facts": stmt.excluded.facts,
                "metadata": stmt.excluded.metadata,
            },
        ).returning(text("xmax = 0"))
        result = await conn.execute(stmt)
        new_count += sum(1 for row in result if row[0])

    return new_count


async def get_listed(conn: AsyncConnection, schedule_id) -> list:
    """Observations whose last_seen_at matches the schedule's last or prior read.

    These are the postings still on the board — the same is_listed logic as
    store.py, but in SQL.
    """
    stmt = text("""
        SELECT o.* FROM scraper_observations o
        JOIN scraper_schedules s ON s.id = o.schedule_id
        WHERE o.schedule_id = :sid
          AND o.last_seen_at IS NOT NULL
          AND (o.last_seen_at = s.last_read_at OR o.last_seen_at = s.prior_read_at)
    """)
    return (await conn.execute(stmt, {"sid": schedule_id})).all()


async def get_closings(conn: AsyncConnection, schedule_id) -> list:
    """Observations gone from the board: last_seen_at is neither last_read_at
    nor prior_read_at. These should be closed in job_postings."""
    stmt = text("""
        SELECT o.* FROM scraper_observations o
        JOIN scraper_schedules s ON s.id = o.schedule_id
        WHERE o.schedule_id = :sid
          AND s.last_read_at IS NOT NULL
          AND (
              o.last_seen_at IS NULL
              OR (o.last_seen_at != s.last_read_at
                  AND (s.prior_read_at IS NULL OR o.last_seen_at != s.prior_read_at))
          )
    """)
    return (await conn.execute(stmt, {"sid": schedule_id})).all()


def _facts_json(job) -> dict | None:
    """Extract card facts from a Job into a JSON-friendly dict."""
    if not job.page:
        return None
    f = job.page.facts
    result = {}
    if f.work_style:
        result["work_style"] = f.work_style
    if f.job_type:
        result["job_type"] = f.job_type
    if f.pay:
        result["pay"] = {
            "low": f.pay.low,
            "high": f.pay.high,
            "currency": f.pay.currency,
            "period": f.pay.period,
        }
    if f.min_years is not None:
        result["min_years"] = f.min_years
    if f.start_term:
        result["start_term"] = f.start_term
    if f.sponsorship:
        result["sponsorship"] = f.sponsorship
    return result or None


def _meta_json(job) -> dict | None:
    """Extract metadata from a Job into a JSON-friendly dict."""
    result = {}
    if hasattr(job, "department") and job.department:
        result["department"] = job.department
    if job.page and job.page.offices:
        result["offices"] = list(job.page.offices)
    if job.page and job.page.requisition:
        result["requisition"] = job.page.requisition
    return result or None
