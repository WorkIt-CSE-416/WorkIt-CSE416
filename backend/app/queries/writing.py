"""
A student's writing samples and style card (KAN-384, models/writing.py),
behind routers/writing_samples.py and the connector's tools. Each write
flushes, never commits: the caller does.

Any change to the samples deletes the style card in the same transaction,
so a card is always built from the samples the student has now; the
connector then asks their Claude for a new one (`card_needed`).

`sample_texts` is what the copying check (KAN-380) reads: the samples' text,
oldest first, empty when the student gave none.
"""

import uuid

from sqlalchemy import delete, exists, func, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.writing import Style_Card, Writing_Sample
from app.schemas.writing import MAX_SAMPLES, Sample


class TooMany(Exception):
    """The student has MAX_SAMPLES samples already."""


async def fetch_samples(db: AsyncSession, applicant_id: uuid.UUID) -> list[Sample]:
    rows = await db.execute(
        select(Writing_Sample.id, Writing_Sample.text)
        .where(Writing_Sample.applicant_id == applicant_id)
        .order_by(Writing_Sample.created_at, Writing_Sample.id)
    )
    return [Sample(id=id, text=text) for id, text in rows]


async def sample_texts(db: AsyncSession, applicant_id: uuid.UUID) -> tuple[str, ...]:
    return tuple(s.text for s in await fetch_samples(db, applicant_id))


async def fetch_style_card(db: AsyncSession, applicant_id: uuid.UUID) -> str | None:
    return await db.scalar(select(Style_Card.card).where(Style_Card.applicant_id == applicant_id))


async def card_needed(db: AsyncSession, applicant_id: uuid.UUID) -> bool:
    '''the student has samples and no style card built from them'''
    has_samples = exists().where(Writing_Sample.applicant_id == applicant_id)
    has_card = exists().where(Style_Card.applicant_id == applicant_id)
    return bool(await db.scalar(select(has_samples & ~has_card)))


async def _drop_card(db: AsyncSession, applicant_id: uuid.UUID) -> None:
    await db.execute(delete(Style_Card).where(Style_Card.applicant_id == applicant_id))


async def add_sample(db: AsyncSession, applicant_id: uuid.UUID, text: str) -> Sample:
    '''raises TooMany at MAX_SAMPLES. Two adds at once could both pass the
    count; a fourth sample harms nothing, so no lock is taken.'''
    count = await db.scalar(
        select(func.count()).select_from(Writing_Sample).where(Writing_Sample.applicant_id == applicant_id)
    )
    if count >= MAX_SAMPLES:
        raise TooMany
    sample = Writing_Sample(applicant_id=applicant_id, text=text)
    db.add(sample)
    await db.flush()
    await _drop_card(db, applicant_id)
    return Sample(id=sample.id, text=sample.text)


async def replace_sample(db: AsyncSession, applicant_id: uuid.UUID, sample_id: uuid.UUID, text: str) -> Sample | None:
    '''None when the student has no such sample'''
    found = await db.scalar(
        update(Writing_Sample)
        .where(Writing_Sample.id == sample_id, Writing_Sample.applicant_id == applicant_id)
        .values(text=text, updated_at=func.now())
        .returning(Writing_Sample.id)
    )
    if found is None:
        return None
    await _drop_card(db, applicant_id)
    return Sample(id=found, text=text)


async def remove_sample(db: AsyncSession, applicant_id: uuid.UUID, sample_id: uuid.UUID) -> bool:
    '''False when the student has no such sample'''
    found = await db.scalar(
        delete(Writing_Sample)
        .where(Writing_Sample.id == sample_id, Writing_Sample.applicant_id == applicant_id)
        .returning(Writing_Sample.id)
    )
    if found is None:
        return False
    await _drop_card(db, applicant_id)
    return True


async def save_style_card(db: AsyncSession, applicant_id: uuid.UUID, card: str) -> None:
    '''adds or replaces the student's card'''
    upsert = pg_insert(Style_Card).values(applicant_id=applicant_id, card=card)
    await db.execute(upsert.on_conflict_do_update(
        index_elements=[Style_Card.applicant_id], set_={"card": card, "updated_at": func.now()},
    ))
