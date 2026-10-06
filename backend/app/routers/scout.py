"""
POST /scout/chat — one turn with Scout, streamed back as NDJSON.

Each line of the response is a ScoutEvent (scout/workit_scout/schemas.py). A model
that is down or out of quota still answers 200 with a single `error` line,
so the panel has one place to show it; only problems with the request itself
(not signed in, not an applicant, out of turns) are HTTP errors.

Applicants only: Scout is the seeker's assistant, and nothing it does yet
means anything to a company account.

Each turn hands Scout two sets of facts: the applicant's parsed resume (their
default one, else their newest parsed one) and, when the panel names one, the
job they asked about. app/services/scout_facts.py decides what of each Scout
may see.
"""

from collections.abc import AsyncIterator
from functools import lru_cache

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import StreamingResponse
from pydantic import TypeAdapter
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from workit_scout.agent import run
from workit_scout.llm import LLM
from workit_scout.quota import DailyQuota
from workit_scout.schemas import ChatRequest, ResumeFacts, ScoutEvent
from workit_scout.settings import ScoutSettings

from app.config import ENV_FILE
from app.db import get_session
from app.deps import get_current_account
from app.models.dto import ParsedResume
from app.models.profiles import Applicant_Profile
from app.models.resume import Resume
from app.schemas.auth import AccountType, AuthenticatedAccount
from app.services.job_feed import find_job
from app.services.scout_facts import job_facts, resume_facts

router = APIRouter(prefix="/scout", tags=["scout"])

_EVENT = TypeAdapter(ScoutEvent)
_quota = DailyQuota()


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
) -> ResumeFacts | None:
    """The applicant's default resume if it parsed, else their newest that did."""
    default_id = await db.scalar(
        select(Applicant_Profile.default_resume_id).where(
            Applicant_Profile.id == account.id
        )
    )
    parsed = await db.scalar(
        select(Resume.parsed_json)
        .where(Resume.applicant_id == account.id, Resume.parsed_json.is_not(None))
        .order_by((Resume.id == default_id).desc(), Resume.created_at.desc())
        .limit(1)
    )
    return resume_facts(ParsedResume.model_validate(parsed)) if parsed else None


async def _ndjson(events: AsyncIterator[ScoutEvent]) -> AsyncIterator[bytes]:
    async for event in events:
        yield _EVENT.dump_json(event) + b"\n"


@router.post("/chat")
async def chat(
    body: ChatRequest,
    account: AuthenticatedAccount = Depends(get_current_account),
    resume: ResumeFacts | None = Depends(get_resume_facts),
    llm: LLM = Depends(get_llm),
) -> StreamingResponse:
    if account.account_type is not AccountType.APPLICANT:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Scout is for job seekers.")
    if not _quota.take(account.id, get_scout_settings().daily_turns):
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS,
            "You've used all of today's Scout messages. They reset at midnight UTC.",
        )

    job = await find_job(body.job_id) if body.job_id else None
    events = run(body.messages, llm, resume=resume, job=job_facts(job) if job else None)
    return StreamingResponse(_ndjson(events), media_type="application/x-ndjson")
