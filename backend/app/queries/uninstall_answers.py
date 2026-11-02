"""The uninstall survey's queries, behind app/routers/uninstall_answers.py (KAN-471). No HTTP: the route decides the status code and commits."""

import datetime

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.uninstall_answers import Uninstall_Answer


async def count_answered_since(db: AsyncSession, since: datetime.datetime) -> int:
    """How many answers arrived at or after `since`, from everyone."""
    return await db.scalar(select(func.count()).select_from(Uninstall_Answer).where(Uninstall_Answer.created_at >= since))


def add_answer(db: AsyncSession, *, reason: str, detail: str | None, extension_version: str | None) -> None:
    """Adds one answer, naming no account; the route commits."""
    db.add(Uninstall_Answer(reason=reason, detail=detail, extension_version=extension_version))
