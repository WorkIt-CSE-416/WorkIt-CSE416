"""Per-board source tracking and two-complete-read closure detection.

update_sources: upsert job_sources rows for one board's complete read.
detect_and_close: find jobs stale on every enabled board and close them,
with a surge guard against mass closures.
"""

from __future__ import annotations

import logging

from sqlalchemy import func, text
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncConnection

from app.models.scraper import Job_Source

logger = logging.getLogger(__name__)

_sources = Job_Source.__table__

# Same thresholds as app.scripts.import_jobs.
_MASS_CLOSE_SHARE = 0.5
_MASS_CLOSE_FLOOR = 20

# Jobs stale on every enabled board and supported by none.  Reused by the
# count check and the close.
_STALE_CTE = """\
WITH stale AS (
    SELECT js.apply_url
    FROM job_sources js
    JOIN scraper_schedules ss ON js.schedule_id = ss.id
    WHERE ss.enabled = TRUE
      AND ss.prior_read_at IS NOT NULL
      AND js.last_seen_at < ss.prior_read_at
),
supported AS (
    SELECT js.apply_url
    FROM job_sources js
    JOIN scraper_schedules ss ON js.schedule_id = ss.id
    WHERE ss.enabled = TRUE
      AND ss.prior_read_at IS NOT NULL
      AND js.last_seen_at >= ss.prior_read_at
),
to_close AS (
    SELECT DISTINCT apply_url FROM stale
    WHERE apply_url NOT IN (SELECT apply_url FROM supported)
)"""

_PUBLISHED_SCRAPED = (
    "company_id IS NULL AND status = 'published' AND added_by_student = FALSE"
)


async def update_sources(
    conn: AsyncConnection, schedule_id, apply_urls: list[str]
) -> None:
    """Upsert job_sources for one board's complete read.  GREATEST prevents a
    stale retry from pushing last_seen_at backward."""
    if not apply_urls:
        return
    rows = [{"schedule_id": schedule_id, "apply_url": url} for url in apply_urls]
    stmt = insert(_sources).values(rows)
    stmt = stmt.on_conflict_do_update(
        index_elements=[_sources.c.schedule_id, _sources.c.apply_url],
        set_={
            "last_seen_at": func.greatest(
                _sources.c.last_seen_at, stmt.excluded.last_seen_at
            )
        },
    )
    await conn.execute(stmt)


async def detect_and_close(conn: AsyncConnection) -> int:
    """Find jobs stale on every enabled board and close them.  Returns count
    closed, or 0 when the surge guard refuses."""

    # How many published scraped jobs would close?
    to_close = await conn.scalar(
        text(
            f"{_STALE_CTE}\n"
            f"SELECT count(*) FROM job_postings\n"
            f"WHERE apply_url IN (SELECT apply_url FROM to_close)\n"
            f"  AND {_PUBLISHED_SCRAPED}"
        )
    )
    if not to_close:
        return 0

    # Surge guard: same thresholds as the feed import.
    published = await conn.scalar(
        text(f"SELECT count(*) FROM job_postings WHERE {_PUBLISHED_SCRAPED}")
    )
    if published > _MASS_CLOSE_FLOOR and to_close > _MASS_CLOSE_SHARE * published:
        logger.error(
            "Surge guard: refusing to close %d of %d published scraped jobs",
            to_close,
            published,
        )
        return 0

    # Close them.
    result = await conn.execute(
        text(
            f"{_STALE_CTE}\n"
            "UPDATE job_postings\n"
            "SET status = 'closed',\n"
            "    closes_at = LEAST(COALESCE(closes_at, now()), now()),\n"
            "    closed_reason = 'gone_from_board',\n"
            "    updated_at = now()\n"
            f"WHERE apply_url IN (SELECT apply_url FROM to_close)\n"
            f"  AND {_PUBLISHED_SCRAPED}"
        )
    )
    closed = result.rowcount
    if closed:
        logger.info("Closed %d jobs gone from all boards", closed)
    return closed
