"""
GET and PATCH for a student's answers to the questions hiring systems repeat
(KAN-283): work authorization, sponsorship, citizenship and visa status,
security clearance, gender, Hispanic or Latino, race, veteran status and
disability.

    GET /applicants/{applicant_id}/autofill-answers
        The saved answers (schemas/autofill_answers.py), every one null when
        none are saved.

    PATCH /applicants/{applicant_id}/autofill-answers
        Writes only the keys in the body; a key sent as null is cleared, and a
        key left out keeps its answer. Answers the whole bank after the write.

Onboarding's second step writes them; auto apply's fill and My Profile read
them. They are the student's own and go to no model: the gender, Hispanic or
Latino, race, veteran and disability answers are voluntary
self-identification, read only by their owner.
"""

import logging
import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_session
from app.deps import owned_applicant
from app.queries.autofill_answers import fetch_bank, merge_answers
from app.schemas.autofill_answers import AutofillAnswers, answers_from_bank

logger = logging.getLogger(__name__)

router = APIRouter()

_PATH = "/applicants/{applicant_id}/autofill-answers"


@router.get(_PATH, response_model=AutofillAnswers)
async def get_autofill_answers(
    applicant_id: uuid.UUID = Depends(owned_applicant),
    session: AsyncSession = Depends(get_session),
) -> AutofillAnswers:
    return answers_from_bank(await fetch_bank(session, applicant_id))


@router.patch(_PATH, response_model=AutofillAnswers)
async def patch_autofill_answers(
    body: AutofillAnswers,
    applicant_id: uuid.UUID = Depends(owned_applicant),
    session: AsyncSession = Depends(get_session),
) -> AutofillAnswers:
    sent = body.model_dump(include=body.model_fields_set)
    written = {key: answer for key, answer in sent.items() if answer is not None}
    cleared = [key for key, answer in sent.items() if answer is None]

    try:
        bank = await merge_answers(session, applicant_id, written, cleared)
        await session.commit()
    except Exception:
        await session.rollback()
        logger.exception("Saving autofill answers failed", extra={"applicant_id": str(applicant_id)})
        raise HTTPException(500, "Failed to save your answers")

    return answers_from_bank(bank)
