"""
fill_events' queries, behind routers/fill_events.py (KAN-476): store one
fill's numbers within an account's daily cap, and the admins' per-system,
per-day rates. Events past 90 days go in the daily purge
(services/retention.py RETENTION, KAN-482).
"""

import datetime
import uuid

from sqlalchemy import Integer, func, select, true
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.fill_events import Fill_Event

# The most events one account sends in 24 hours: five batch tabs filling all day stay far below it.
DAILY_CAP = 500


async def store_event(db: AsyncSession, event: dict, account_id: uuid.UUID) -> uuid.UUID | None:
    '''adds the event from this account and commits, answering its id; None (nothing stored) past DAILY_CAP'''
    now = datetime.datetime.now(datetime.UTC)
    sent = await db.scalar(
        select(func.count()).select_from(Fill_Event)
        .where(Fill_Event.account_id == account_id, Fill_Event.created_at > now - datetime.timedelta(days=1))
    )
    if (sent or 0) >= DAILY_CAP:
        return None
    row = Fill_Event(**event, account_id=account_id)
    db.add(row)
    await db.commit()
    return row.id


async def fill_health(db: AsyncSession, *, days: int, engine_version: str | None = None) -> tuple[list[dict], list[str]]:
    '''
    the last `days` days' events by job system and day (UTC), newest day first: fills, the share with no
    failed field, needs-you fields over all fields, and the 3 most common error names; and every engine
    version those days' events name, newest first
    '''
    since = datetime.datetime.now(datetime.UTC) - datetime.timedelta(days=days)
    day = func.date(func.timezone("UTC", Fill_Event.created_at)).label("day")
    where = [Fill_Event.created_at >= since]
    if engine_version:
        where.append(Fill_Event.engine_version == engine_version)
    rows = (await db.execute(
        select(
            day, Fill_Event.job_system, func.count().label("fills"),
            func.count().filter(Fill_Event.failed == 0).label("clean"),
            func.sum(Fill_Event.needs_you).label("needs_you"), func.sum(Fill_Event.fields).label("fields"),
        ).where(*where).group_by(day, Fill_Event.job_system).order_by(day.desc(), Fill_Event.job_system)
    )).all()
    # Error names summed per system and day, from each event's {name: count}.
    error = func.jsonb_each_text(Fill_Event.errors).table_valued("key", "value").alias("error")
    errors = (await db.execute(
        select(day, Fill_Event.job_system, error.c.key, func.sum(error.c.value.cast(Integer)).label("count"))
        .select_from(Fill_Event).join(error, true()).where(*where)
        .group_by(day, Fill_Event.job_system, error.c.key)
    )).all()
    top: dict[tuple, list[dict]] = {}
    for r in errors:
        top.setdefault((r.day, r.job_system), []).append({"name": r.key, "count": int(r.count)})
    versions = (await db.execute(
        select(Fill_Event.engine_version).where(Fill_Event.created_at >= since)
        .group_by(Fill_Event.engine_version).order_by(func.max(Fill_Event.created_at).desc())
    )).scalars().all()
    return [
        {
            "day": r.day.isoformat(), "job_system": r.job_system, "fills": r.fills,
            "clean_share": r.clean / r.fills if r.fills else 0.0,
            "needs_you_rate": (r.needs_you or 0) / r.fields if r.fields else 0.0,
            "top_errors": sorted(top.get((r.day, r.job_system), []), key=lambda e: (-e["count"], e["name"]))[:3],
        }
        for r in rows
    ], list(versions)
