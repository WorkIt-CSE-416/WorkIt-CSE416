"""
fill_events' queries, behind routers/fill_events.py (KAN-476): store one
fill's numbers, and the admins' per-system,
per-day rates. Events past 90 days go in the daily purge
(services/retention.py RETENTION, KAN-482).
"""

import datetime
import uuid

from sqlalchemy import Integer, func, select, true
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.fill_events import Fill_Event


async def store_event(db: AsyncSession, event: dict) -> uuid.UUID:
    '''adds the event and commits (with the route's daily count, services/daily_caps.py), answering its id'''
    row = Fill_Event(**event)
    db.add(row)
    await db.commit()
    return row.id


async def fill_health(db: AsyncSession, *, days: int, engine_version: str | None = None) -> tuple[list[dict], list[str]]:
    '''
    the last `days` days' events by job system and day (UTC), newest day first: fills (an event that is
    no Workday walk's non-final step, so a walk counts once), the share of pages (events) with no failed
    field, needs-you fields over the fields not skipped by choice, and the 3 most common error names; and
    every engine version those days' events name, newest first
    '''
    since = datetime.datetime.now(datetime.UTC) - datetime.timedelta(days=days)
    day = func.date(func.timezone("UTC", Fill_Event.created_at)).label("day")
    where = [Fill_Event.created_at >= since]
    if engine_version:
        where.append(Fill_Event.engine_version == engine_version)
    rows = (await db.execute(
        select(
            day, Fill_Event.job_system, func.count().label("pages"),
            func.count().filter(Fill_Event.final_step.is_not(False)).label("fills"),
            func.count().filter(Fill_Event.failed == 0).label("clean"),
            func.sum(Fill_Event.needs_you).label("needs_you"),
            func.sum(Fill_Event.fields - Fill_Event.skipped_by_choice).label("fields"),
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
            "clean_share": r.clean / r.pages if r.pages else 0.0,
            "needs_you_rate": (r.needs_you or 0) / r.fields if r.fields and r.fields > 0 else 0.0,
            "top_errors": sorted(top.get((r.day, r.job_system), []), key=lambda e: (-e["count"], e["name"]))[:3],
        }
        for r in rows
    ], list(versions)
