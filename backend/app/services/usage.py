"""
Daily AI uses: one way for every model feature to check and count them.

A route calls `uses_left` before the model call and refuses with a 429 at 0,
then calls `count_use` only once the call has succeeded, so a failed or
rejected call costs the student nothing. Two limits apply, both env settings
in app.config: the feature's cap for each student, and the feature's share of
the daily pool across all students. Days are UTC.

Check, then call, then count is not atomic: two requests at once can both
pass the check and overshoot by one. That errs toward letting the student in,
which is fine while the limits exist to protect free tiers, not to bill.
"""

import datetime
import uuid
from enum import StrEnum

from sqlalchemy import or_, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.models.ai_usage import AI_Usage_Counter


class Feature(StrEnum):
    SCOUT = "scout"
    INTAKE = "intake"
    TAILOR = "tailor"
    PARSING = "parsing"
    ASSISTANT = "assistant"


def _today() -> datetime.date:
    return datetime.datetime.now(datetime.UTC).date()


async def uses_left(db: AsyncSession, account_id: uuid.UUID, feature: Feature) -> int:
    """Uses of `feature` the account has left today, under both limits."""
    settings = get_settings()
    cap = getattr(settings, f"ai_{feature}_cap")
    pool = int(settings.ai_daily_pool * getattr(settings, f"ai_{feature}_share"))
    rows = await db.execute(
        select(AI_Usage_Counter.account_id, AI_Usage_Counter.count).where(
            AI_Usage_Counter.feature == feature,
            AI_Usage_Counter.day == _today(),
            or_(
                AI_Usage_Counter.account_id == account_id,
                AI_Usage_Counter.account_id.is_(None),
            ),
        )
    )
    mine = pooled = 0
    for owner, count in rows:
        if owner is None:
            pooled = count
        else:
            mine = count
    return max(0, min(cap - mine, pool - pooled))


async def count_use(db: AsyncSession, account_id: uuid.UUID, feature: Feature) -> None:
    """One successful use: the account's row and the pool's row each go up by 1."""
    table = AI_Usage_Counter.__table__
    for owner in (account_id, None):
        await db.execute(
            insert(table)
            .values(account_id=owner, feature=feature, day=_today(), count=1)
            .on_conflict_do_update(
                index_elements=["account_id", "feature", "day"],
                set_={"count": table.c.count + 1},
            )
        )
    await db.commit()
