"""
POST /intake/turn — one turn of intake (KAN-213), streamed back as NDJSON.

Body: IntakeTurnRequest {section, messages, draft} (app/schemas/intake.py).
The browser holds this entry's chat and the card, and sends both every turn,
the card with the student's own edits; the API stores neither.

Lines, like Scout's: {"type": "text", "delta"} with the whole reply, then
{"type": "draft", "draft", "done"} with the full draft, checked against the
entry schema, then {"type": "usage", "uses_left"}. A model that is down, or
answers in the wrong shape, gives one {"type": "error", "message"} line and
the usage line instead, on a 200, and does not count. Not signed in, not an
applicant, or out of today's intake turns are HTTP errors (401, 403, 429).
Saving the entry is the bank's POST, not this route.
"""

from collections.abc import AsyncIterator

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from workit_scout.llm import LLM, ScoutUnavailable
from workit_scout.schemas import ErrorEvent, TextEvent, UsageEvent

from app.db import get_session
from app.deps import get_current_account
from app.routers.scout import get_llm
from app.schemas.auth import AccountType, AuthenticatedAccount
from app.schemas.intake import DraftEvent, IntakeTurnRequest
from app.services import intake
from app.services.ai_messages import AIMessages
from app.services.identity import load_identity
from app.services.usage import Feature, count_use, uses_left

router = APIRouter(prefix="/intake", tags=["intake"])

AI = AIMessages(
    spent="You've used all of today's intake messages. Fill in the card yourself, "
    "or come back after midnight UTC.",
    offline="WorkIt can't answer right now. Try again in a minute.",
    lost="WorkIt lost track of that answer. Try sending it again.",
    busy="WorkIt has hit today's AI limit. Fill in the card yourself, or try again tomorrow.",
)


async def _ndjson(events: list[BaseModel]) -> AsyncIterator[bytes]:
    for event in events:
        yield event.model_dump_json().encode() + b"\n"


@router.post("/turn")
async def take_turn(
    body: IntakeTurnRequest,
    account: AuthenticatedAccount = Depends(get_current_account),
    llm: LLM = Depends(get_llm),
    db: AsyncSession = Depends(get_session),
) -> StreamingResponse:
    if account.account_type is not AccountType.APPLICANT:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Intake is for job seekers.")
    left = await uses_left(db, account.id, Feature.INTAKE)
    if left <= 0:
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, AI.spent)

    identity = await load_identity(db, account)
    try:
        answer = await intake.turn(
            body.section, body.messages, body.draft, llm, identity=identity
        )
    except ScoutUnavailable as exc:
        events: list[BaseModel] = [ErrorEvent(message=AI.failure(exc))]
    else:
        await count_use(db, account.id, Feature.INTAKE)
        await db.commit()
        left -= 1
        events = [
            TextEvent(delta=answer.reply),
            DraftEvent(draft=answer.draft, done=answer.done),
        ]
    events.append(UsageEvent(uses_left=left))
    return StreamingResponse(_ndjson(events), media_type="application/x-ndjson")
