"""Per-board source tracking and two-complete-read closure detection.

update_sources: upsert job_sources rows for one board's complete read.
detect_and_close: find jobs stale on every enabled board and close them,
with a surge guard against mass closures.
"""

from __future__ import annotations

import logging
import uuid

from sqlalchemy import func, text
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncConnection

from app.models.scraper import Job_Source
from app.scraper.constants import MASS_CLOSE_FLOOR, MASS_CLOSE_SHARE

logger = logging.getLogger(__name__)

_sources = Job_Source.__table__

# One statement: identify stale jobs, count them against the surge guard, and
# close in a single snapshot.  The guard CTE gates the UPDATE: when it returns
# no rows (surge refused or nothing to close), the UPDATE touches nothing.
#
# NOT EXISTS instead of NOT IN: if `supported` ever returned a NULL apply_url,
# NOT IN would evaluate to UNKNOWN and close nothing silently.
_DETECT_AND_CLOSE_SQL = text("""\
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
    SELECT DISTINCT s.apply_url FROM stale s
    WHERE NOT EXISTS (
        SELECT 1 FROM supported sup WHERE sup.apply_url = s.apply_url
    )
),
counts AS (
    SELECT
        (SELECT count(*) FROM job_postings
         WHERE apply_url IN (SELECT apply_url FROM to_close)
           AND company_id IS NULL
           AND status = 'published'
           AND added_by_student = FALSE) AS closing,
        (SELECT count(*) FROM job_postings
         WHERE company_id IS NULL
           AND status = 'published'
           AND added_by_student = FALSE) AS total
),
guard AS (
    SELECT closing, total FROM counts
    WHERE closing > 0
      AND (total <= :floor OR closing <= :share * total)
),
closed AS (
    UPDATE job_postings
    SET status = 'closed',
        closes_at = LEAST(COALESCE(closes_at, now()), now()),
        closed_reason = 'gone_from_board',
        updated_at = now()
    WHERE apply_url IN (SELECT apply_url FROM to_close)
      AND company_id IS NULL
      AND status = 'published'
      AND added_by_student = FALSE
      AND EXISTS (SELECT 1 FROM guard)
    RETURNING 1
)
SELECT
    (SELECT closing FROM counts) AS closing,
    (SELECT total FROM counts) AS total,
    (SELECT count(*) FROM closed) AS closed,
    EXISTS (SELECT 1 FROM guard) AS allowed
""")


async def update_sources(
    conn: AsyncConnection, schedule_id: uuid.UUID, apply_urls: list[str]
) -> None:
    """Upsert job_sources for one board's complete read.  GREATEST prevents a
    stale retry from pushing last_seen_at backward.

    An empty list is valid: the board returned nothing, so no source records
    update.  advance_reads still runs after this, moving prior_read_at forward,
    which makes every prior source for this board stale — the intended
    semantics of "the board listed nothing."
    """
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
    closed, or 0 when the surge guard refuses.

    One statement, one snapshot: the count, the guard check and the UPDATE
    share a single CTE chain, so no concurrent transaction can change the
    row set between the check and the close."""
    row = (
        await conn.execute(
            _DETECT_AND_CLOSE_SQL,
            {"floor": MASS_CLOSE_FLOOR, "share": MASS_CLOSE_SHARE},
        )
    ).first()

    closing, total, closed, allowed = row.closing, row.total, row.closed, row.allowed

    if closing and not allowed:
        logger.error(
            "Surge guard: refusing to close %d of %d published scraped jobs",
            closing,
            total,
        )
        return 0

    if closed:
        logger.info("Closed %d jobs gone from all boards", closed)
    return closed
