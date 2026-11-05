"""Board catalog sync, due-schedule selection and read advancement.

Reimplements store.py's board health logic (rest_for, consecutive_failures)
in Postgres, using the same constants.
"""

from __future__ import annotations

import csv
from datetime import timedelta
from pathlib import Path

from sqlalchemy import select, text, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncConnection

from app.models.scraper import Scraper_Schedule

_schedules = Scraper_Schedule.__table__

# Same constants as workit_scraper.store
REST_AFTER = 3
REST_FIRST = timedelta(hours=6)
REST_LONGEST = timedelta(hours=24)

BOARDS_CSV = Path(__file__).resolve().parents[3] / "scraper" / "boards.csv"


def rest_for(failures: int) -> timedelta | None:
    """How long a board unread `failures` runs in a row rests."""
    if failures < REST_AFTER:
        return None
    return min(REST_FIRST * 2 ** (failures - REST_AFTER), REST_LONGEST)


async def sync_catalog(conn: AsyncConnection, boards_csv: Path = BOARDS_CSV) -> int:
    """Upsert boards.csv into scraper_schedules. Returns count of new rows."""
    boards = _load_csv(boards_csv)
    if not boards:
        return 0
    stmt = insert(_schedules).values(boards)
    stmt = stmt.on_conflict_do_update(
        index_elements=[_schedules.c.ats, _schedules.c.token],
        set_={"company": stmt.excluded.company},
    ).returning(text("xmax = 0"))
    result = await conn.execute(stmt)
    return sum(1 for row in result if row[0])


async def select_due(conn: AsyncConnection) -> list:
    """Schedules due for a read: enabled, not resting."""
    stmt = select(_schedules).where(
        _schedules.c.enabled.is_(True),
        _schedules.c.rest_until.is_(None) | (_schedules.c.rest_until <= text("now()")),
    )
    return (await conn.execute(stmt)).all()


async def advance_reads(
    conn: AsyncConnection, schedule_id, *, now_expr=text("now()")
) -> None:
    """After a complete board read: move last_read_at to prior_read_at, so the
    last two complete reads are kept, then advance last_read_at and clear
    failures and rest."""
    await conn.execute(
        update(_schedules)
        .where(_schedules.c.id == schedule_id)
        .values(
            # The old value: SET reads every column as it was before the UPDATE.
            prior_read_at=_schedules.c.last_read_at,
            last_read_at=now_expr,
            missing_at=None,
            consecutive_failures=0,
            rest_until=None,
        )
    )


async def record_missing(conn: AsyncConnection, schedule_id) -> None:
    """A board said 'no such board'. First time: note it. Second: treat as a
    complete read with nothing open (same logic as store.update)."""
    row = (
        await conn.execute(
            select(_schedules.c.missing_at, _schedules.c.last_read_at).where(
                _schedules.c.id == schedule_id
            )
        )
    ).one()
    if row.missing_at is None:
        await conn.execute(
            update(_schedules)
            .where(_schedules.c.id == schedule_id)
            .values(missing_at=text("now()"))
        )
    else:
        # Second miss: count as complete read with nothing listed.
        # Clear failures and rest, same as advance_reads.
        await conn.execute(
            update(_schedules)
            .where(_schedules.c.id == schedule_id)
            .values(
                prior_read_at=_schedules.c.missing_at,
                last_read_at=text("now()"),
                missing_at=None,
                consecutive_failures=0,
                rest_until=None,
            )
        )


async def record_failure(conn: AsyncConnection, schedule_id) -> None:
    """Increment consecutive_failures and set rest_until if past threshold."""
    row = (
        await conn.execute(
            select(_schedules.c.consecutive_failures).where(
                _schedules.c.id == schedule_id
            )
        )
    ).one()
    new_failures = row.consecutive_failures + 1
    rest = rest_for(new_failures)
    await conn.execute(
        update(_schedules)
        .where(_schedules.c.id == schedule_id)
        .values(
            consecutive_failures=new_failures,
            rest_until=text(f"now() + interval '{int(rest.total_seconds())} seconds'")
            if rest
            else None,
        )
    )


def _load_csv(path: Path) -> list[dict]:
    with path.open(newline="", encoding="utf-8") as f:
        rows = csv.DictReader(line for line in f if not line.startswith("#"))
        result = []
        for row in rows:
            ats = (row.get("ats") or "").strip()
            token = (row.get("token") or "").strip()
            if ats and token:
                result.append(
                    {
                        "ats": ats,
                        "token": token,
                        "company": (row.get("company") or token).strip(),
                    }
                )
        return result
