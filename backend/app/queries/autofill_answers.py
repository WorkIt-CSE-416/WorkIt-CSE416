"""
autofill_answers' queries, behind routers/autofill_answers.py: one student's
answer bank, read whole and merged a key at a time (models/autofill_answers.py).
Auto apply's fill will read the bank through fetch_bank too.
"""

import uuid

from sqlalchemy import Text, func, literal, select
from sqlalchemy.dialects.postgresql import ARRAY, JSONB
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.autofill_answers import Autofill_Answers


async def fetch_bank(db: AsyncSession, applicant_id: uuid.UUID) -> dict:
    '''the applicant's stored bank, {} when they have saved none'''
    bank = await db.scalar(
        select(Autofill_Answers.answers).where(Autofill_Answers.applicant_id == applicant_id)
    )
    return bank or {}


async def merge_answers(
    db: AsyncSession, applicant_id: uuid.UUID, written: dict, cleared: list[str]
) -> dict:
    '''
    adds or replaces the `written` keys and drops the `cleared` ones, and
    returns the whole bank after. Flushes nothing itself: the caller commits

    Merged in the database (|| then -), never replaced from the caller's
    copy: a second tab's save would otherwise erase the answers this one
    lacks. One statement, so two saves at once each merge into the latest.
    '''
    upsert = pg_insert(Autofill_Answers).values(applicant_id=applicant_id, answers=written)
    merged = (
        Autofill_Answers.answers.op("||", return_type=JSONB)(upsert.excluded.answers)
        .op("-", return_type=JSONB)(literal(cleared, ARRAY(Text)))
    )
    return await db.scalar(
        upsert.on_conflict_do_update(
            index_elements=[Autofill_Answers.applicant_id],
            set_={"answers": merged, "updated_at": func.now()},
        ).returning(Autofill_Answers.answers)
    )
