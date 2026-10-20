"""
GET and PATCH for a student's answers to the questions hiring systems repeat
(KAN-283): work authorization, sponsorship, citizenship and visa status,
security clearance, gender, veteran status and disability.

    GET /applicants/{applicant_id}/autofill-answers
        The saved answers (schemas/autofill_answers.py), every one null when
        none are saved.

    PATCH /applicants/{applicant_id}/autofill-answers
        Writes only the keys in the body; a key sent as null is cleared, and a
        key left out keeps its answer. Answers the whole bank after the write.

Onboarding's second step writes them; auto apply's fill and My Profile read
them. They are the student's own and go to no model: the gender, veteran and
disability answers are voluntary self-identification, read only by their owner.
"""

import logging
import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import Text, func, literal, select
from sqlalchemy.dialects.postgresql import ARRAY, JSONB
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_session
from app.deps import owned_applicant
from app.models.autofill_answers import Autofill_Answers
from app.schemas.autofill_answers import QUESTIONS, AutofillAnswers, answers_from_bank

logger = logging.getLogger(__name__)

router = APIRouter()

_PATH = "/applicants/{applicant_id}/autofill-answers"


@router.get(_PATH, response_model=AutofillAnswers)
async def get_autofill_answers(
    applicant_id: uuid.UUID = Depends(owned_applicant),
    session: AsyncSession = Depends(get_session),
) -> AutofillAnswers:
    bank = await session.scalar(
        select(Autofill_Answers.answers).where(Autofill_Answers.applicant_id == applicant_id)
    )
    return answers_from_bank(bank or {})


@router.patch(_PATH, response_model=AutofillAnswers)
async def patch_autofill_answers(
    body: AutofillAnswers,
    applicant_id: uuid.UUID = Depends(owned_applicant),
    session: AsyncSession = Depends(get_session),
) -> AutofillAnswers:
    sent = body.model_dump(include=body.model_fields_set)
    written = {
        key: {"question_text": QUESTIONS[key], "answer": answer}
        for key, answer in sent.items()
        if answer is not None
    }
    cleared = [key for key, answer in sent.items() if answer is None]

    # Merged in the database, key by key (|| adds or replaces the keys sent,
    # - drops the cleared ones), never replaced from the browser's copy: a
    # second tab's save would otherwise erase the answers this one lacks.
    upsert = pg_insert(Autofill_Answers).values(applicant_id=applicant_id, answers=written)
    merged = (
        Autofill_Answers.answers.op("||", return_type=JSONB)(upsert.excluded.answers)
        .op("-", return_type=JSONB)(literal(cleared, ARRAY(Text)))
    )
    try:
        bank = await session.scalar(
            upsert.on_conflict_do_update(
                index_elements=[Autofill_Answers.applicant_id],
                set_={"answers": merged, "updated_at": func.now()},
            ).returning(Autofill_Answers.answers)
        )
        await session.commit()
    except Exception:
        await session.rollback()
        logger.exception("Saving autofill answers failed", extra={"applicant_id": str(applicant_id)})
        raise HTTPException(500, "Failed to save your answers")

    return answers_from_bank(bank)
