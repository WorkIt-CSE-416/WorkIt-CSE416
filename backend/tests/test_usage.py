"""
`services/usage.py` (KAN-210) on real Postgres: a count is part of the
caller's transaction, so the router decides whether it lands (backend/
CLAUDE.md, Services: a service flushes and never commits).
"""

import uuid

import pytest
from sqlalchemy import text

from app.config import get_settings
from app.services.usage import Feature, count_use, uses_left

pytestmark = pytest.mark.anyio


async def test_a_count_lands_with_the_callers_commit_and_not_after_a_rollback(database):
    account = uuid.uuid4()
    cap = get_settings().ai_tailor_cap
    async with database() as session:
        await session.execute(text("INSERT INTO auth.users (id) VALUES (:id)"), {"id": account})
        await session.commit()

        await count_use(session, account, Feature.TAILOR)
        await session.rollback()
    async with database() as session:
        assert await uses_left(session, account, Feature.TAILOR) == cap

        await count_use(session, account, Feature.TAILOR)
        await session.commit()
    async with database() as session:
        assert await uses_left(session, account, Feature.TAILOR) == cap - 1
