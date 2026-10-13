"""The editor assistant under /applicants/{applicant_id}/built-resumes/{rid}/assistant
(KAN-221). Checks the token's account owns `applicant_id` first. The rules
live in `app/services/assistant.py`.

POST /applicants/{id}/built-resumes/{rid}/assistant  AssistantTurn -> AssistantReply
     Reads one message and answers with one editor action: fit, hide,
     move_up, move_down, shorter (with the proposed wording) or none. Saves
     nothing but the count: the editor applies the action through PATCH
     .../choices or POST .../fit, and a shorter wording only once the
     student uses it. One assistant use, counted only when the model
     answers in schema. 404 unknown resume or a line outside the bank;
     422 more than one line; 429 at the assistant limit; 503 when the
     model fails or answers out of schema (nothing counted).
"""

import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from workit_scout.llm import LLM, OUT_OF_QUOTA, InvalidReply, ScoutUnavailable

from app.db import get_session
from app.deps import assert_applicant_owns, get_current_account
from app.routers.scout import get_llm
from app.schemas.assistant import AssistantReading, AssistantReply, AssistantTurn
from app.schemas.auth import AuthenticatedAccount
from app.services import assistant, built_resumes
from app.services.bank import NotFound, load_bank
from app.services.identity import load_identity
from app.services.usage import Feature, count_use, uses_left

router = APIRouter(prefix="/applicants/{applicant_id}/built-resumes/{resume_id}/assistant", tags=["assistant"])

AI_SPENT = "You've used today's assistant messages. They reset at midnight UTC. The bar above the page still works."
AI_BUSY = "WorkIt has hit today's AI limit. Try again tomorrow."
AI_OFFLINE = "The assistant can't reach WorkIt's AI right now. Try again in a minute."
AI_LOST = "The assistant couldn't make sense of the AI's answer. Try again."


def _ai_message(exc: ScoutUnavailable) -> str:
    if isinstance(exc, InvalidReply):
        return AI_LOST
    return AI_BUSY if str(exc) == OUT_OF_QUOTA else AI_OFFLINE


@router.post("", response_model=AssistantReply)
async def ask(
    body: AssistantTurn,
    applicant_id: uuid.UUID,
    resume_id: uuid.UUID,
    account: AuthenticatedAccount = Depends(get_current_account),
    llm: LLM = Depends(get_llm),
    session: AsyncSession = Depends(get_session),
) -> AssistantReply:
    assert_applicant_owns(account, applicant_id)
    try:
        await built_resumes.get_resume(session, applicant_id, resume_id)
        bank = await load_bank(session, applicant_id)
        choices = await built_resumes.load_choices(session, resume_id)
        line = assistant.selected_line(bank, choices, body)
    except NotFound:
        raise HTTPException(404, "Resume or line not found")
    left = await uses_left(session, applicant_id, Feature.ASSISTANT)
    if left <= 0:
        raise HTTPException(429, AI_SPENT)

    identity = await load_identity(session, account)
    try:
        reading = await llm.complete_json(assistant.prompt(body.message, line), AssistantReading, identity=identity)
    except ScoutUnavailable as exc:
        raise HTTPException(503, _ai_message(exc)) from exc
    answer = assistant.answer(reading, line, [s.name for s in bank.skills])
    await count_use(session, applicant_id, Feature.ASSISTANT)
    await session.commit()
    return AssistantReply(
        action=answer.action, reply=answer.reply, text=answer.text, original=answer.original, uses_left=left - 1)
