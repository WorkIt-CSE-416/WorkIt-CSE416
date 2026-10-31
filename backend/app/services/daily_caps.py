"""
Per-account daily caps on the extension's writes (KAN-478): fix reports and
job system requests today, any other write later (KAN-476's fill events add
a Capped kind and its setting). Days are UTC; the caps are env settings in
app.config (`<kind>_daily_cap`).

A route calls `take_daily` after it has validated the body and before it
writes, in the same session: the count is one atomic upsert that goes up
only while under the cap, so two requests at once can't both slip past it.
It flushes, never commits: the route's own commit keeps the count and the
row together.
"""

import datetime
import uuid
from enum import StrEnum

from fastapi import HTTPException, status
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.models.daily_counts import Daily_Count


class Capped(StrEnum):
    FILL_REPORT = "fill_report"
    JOB_SYSTEM_REQUEST = "job_system_request"


# What the 429 says, which the extension shows as it is.
REFUSALS = {
    Capped.FILL_REPORT: "You've sent a lot of reports today. Try again tomorrow.",
    Capped.JOB_SYSTEM_REQUEST: "You've sent a lot of requests today. Try again tomorrow.",
}


async def take_daily(db: AsyncSession, account_id: uuid.UUID, kind: Capped) -> None:
    """Counts one `kind` write for the account today; a 429 (nothing counted) once it is at the cap."""
    cap = getattr(get_settings(), f"{kind}_daily_cap")
    table = Daily_Count.__table__
    counted = await db.scalar(
        insert(table)
        .values(account_id=account_id, kind=kind, day=datetime.datetime.now(datetime.UTC).date(), count=1)
        .on_conflict_do_update(
            index_elements=["account_id", "kind", "day"],
            set_={"count": table.c.count + 1},
            where=table.c.count < cap,
        )
        .returning(table.c.count)
    )
    if counted is None or cap < 1:
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, REFUSALS[kind])
    await db.flush()
