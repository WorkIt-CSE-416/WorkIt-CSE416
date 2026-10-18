"""
POST /scout/chat — one turn with Scout, streamed back as NDJSON.

Each line of the response is a ScoutEvent (scout/workit_scout/schemas.py). A model
that is down or out of quota still answers 200 with a single `error` line,
so the panel has one place to show it; only problems with the request itself
(not signed in, not an applicant, out of turns) are HTTP errors.

Applicants only: Scout is the seeker's assistant, and nothing it does yet
means anything to a company account.

Each turn hands Scout two sets of facts: the applicant's experience bank (never
an uploaded resume: for an empty bank Scout is told only whether an upload
exists) and, when the panel names one, the job they asked about, as JSON
data. workit_scout.facts decides what of each Scout may see.
"""

from collections.abc import AsyncIterator
from functools import lru_cache

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import StreamingResponse
from pydantic import TypeAdapter
from sqlalchemy import exists, select
from sqlalchemy.ext.asyncio import AsyncSession
from workit_scout.agent import run
from workit_scout.facts import bank_facts, job_facts
from workit_scout.llm import LLM
from workit_scout.schemas import (
    ChatRequest,
    ErrorEvent,
    JobFacts,
    ResumeFacts,
    ScoutEvent,
    UsageEvent,
)
from workit_scout.settings import ScoutSettings

from app.config import ENV_FILE
from app.db import get_session, get_sessionmaker
from app.deps import get_current_account
from app.models.resume import Resume
from app.queries.jobs.listings import fetch_listing
from app.schemas.auth import AccountType, AuthenticatedAccount
from app.services.bank import bank_response, load_bank
from app.services.identity import load_identity
from app.services.usage import Feature, count_use, uses_left

router = APIRouter(prefix="/scout", tags=["scout"])

_EVENT = TypeAdapter(ScoutEvent)


@lru_cache
def get_scout_settings() -> ScoutSettings:
    """SCOUT_* from the environment and the repo's .env, read once."""
    return ScoutSettings(_env_file=ENV_FILE)


@lru_cache
def get_llm() -> LLM:
    """Built on first use, so the API starts whether or not a model is set up."""
    return LLM.from_settings(get_scout_settings())


async def get_resume_facts(
    account: AuthenticatedAccount = Depends(get_current_account),
    db: AsyncSession = Depends(get_session),
) -> ResumeFacts:
    """The applicant's experience bank, and whether they have an upload (an
    empty bank beside one means the parser read nothing in it, ADR 0003). An
    uploaded resume's own text never reaches Scout."""
    bank = bank_response(await load_bank(db, account.id))
    has_upload = await db.scalar(select(exists().where(Resume.applicant_id == account.id)))
    return bank_facts(bank.model_dump(mode="json"), has_upload=bool(has_upload))


async def find_job(db: AsyncSession, job_id: str) -> JobFacts | None:
    """The listed job with this id (the one GET /jobs sent), or None — including
    when it has closed since, since "that job is gone" is the honest answer."""
    job = await fetch_listing(db, job_id)
    return job_facts(job.model_dump()) if job else None


async def _counted(
    events: AsyncIterator[ScoutEvent], account_id, left: int
) -> AsyncIterator[ScoutEvent]:
    """The turn's events, then the uses left. The turn counts only when it
    ended without an error; a reader who leaves early is not charged."""
    failed = False
    async for event in events:
        failed = failed or isinstance(event, ErrorEvent)
        yield event
    if not failed:
        # Its own session: the request's may be closed once streaming starts.
        async with get_sessionmaker()() as db:
            await count_use(db, account_id, Feature.SCOUT)
            await db.commit()
        left -= 1
    yield UsageEvent(uses_left=left)


async def _ndjson(events: AsyncIterator[ScoutEvent]) -> AsyncIterator[bytes]:
    async for event in events:
        yield _EVENT.dump_json(event) + b"\n"


@router.post("/chat")
async def chat(
    body: ChatRequest,
    account: AuthenticatedAccount = Depends(get_current_account),
    resume: ResumeFacts | None = Depends(get_resume_facts),
    llm: LLM = Depends(get_llm),
    db: AsyncSession = Depends(get_session),
) -> StreamingResponse:
    if account.account_type is not AccountType.APPLICANT:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Scout is for job seekers.")
    left = await uses_left(db, account.id, Feature.SCOUT)
    if left <= 0:
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS,
            "You've used all of today's Scout messages. They reset at midnight UTC.",
        )

    identity = await load_identity(db, account)
    job = await find_job(db, body.job_id) if body.job_id else None
    events = run(body.messages, llm, identity=identity, resume=resume, job=job)
    return StreamingResponse(
        _ndjson(_counted(events, account.id, left)),
        media_type="application/x-ndjson",
    )
