"""A generated answer to one open-ended application question, for the
autofiller extension's essay-question feature (KAN-164). Checks the token's
account owns `applicant_id` first. The rules live in
`app/services/essay_answer.py`.

POST /applicants/{id}/essay-answer  EssayAnswerRequest -> EssayAnswerResponse
     Grounds the answer in the applicant's experience bank; never the bank's
     text verbatim, a drafted paragraph. Saves nothing but the use count —
     the extension fills the field itself, the student reviews and edits it
     like every other autofilled value before they submit. One essay use,
     counted only when the model answers in schema and passes the truth-rule
     check. 429 at the essay limit; 503 when the model fails or answers out
     of schema; 422 when the model's draft invents a fact the bank doesn't
     hold (nothing counted in either failure case).
"""

import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from workit_scout.llm import LLM, ScoutUnavailable

from app.db import get_session
from app.deps import assert_applicant_owns, get_current_account
from app.routers.scout import get_llm
from app.schemas.auth import AuthenticatedAccount
from app.schemas.essay_answer import EssayAnswerRequest, EssayAnswerResponse
from app.services import essay_answer
from app.services.ai_messages import AIMessages
from app.services.bank import load_bank
from app.services.identity import load_identity
from app.services.usage import Feature, count_use, uses_left

router = APIRouter()

AI = AIMessages(
    spent="You've used today's AI essay-answer generations. They reset at midnight UTC — write this one yourself for now.",
    offline="WorkIt's AI can't be reached right now. Write this one yourself for now.",
    lost="That didn't come back right. Try again, or write this one yourself.",
)


@router.post("/applicants/{applicant_id}/essay-answer", response_model=EssayAnswerResponse)
async def generate_essay_answer(
    body: EssayAnswerRequest,
    applicant_id: uuid.UUID,
    account: AuthenticatedAccount = Depends(get_current_account),
    llm: LLM = Depends(get_llm),
    session: AsyncSession = Depends(get_session),
) -> EssayAnswerResponse:
    assert_applicant_owns(account, applicant_id)

    left = await uses_left(session, applicant_id, Feature.ESSAY)
    if left <= 0:
        raise HTTPException(429, AI.spent)

    bank = await load_bank(session, applicant_id)
    identity = await load_identity(session, account)

    try:
        answer = await essay_answer.generate(llm, identity, body, bank)
    except ScoutUnavailable as exc:
        raise HTTPException(503, AI.failure(exc)) from exc

    if answer is None:
        raise HTTPException(
            422, "Couldn't draft an answer grounded in your experience bank. Try rephrasing the question, "
            "or write this one yourself.")

    await count_use(session, applicant_id, Feature.ESSAY)
    await session.commit()
    return EssayAnswerResponse(answer=answer, uses_left=left - 1)
