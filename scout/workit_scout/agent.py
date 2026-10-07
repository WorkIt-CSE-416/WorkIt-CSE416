"""
One Scout turn: the conversation so far in, a stream of ScoutEvents out.

No HTTP and no database here. The API's router authenticates, rate-limits,
loads the user's resume and the job, and hands them over with the model.
"""

from collections.abc import AsyncIterator, Sequence

from workit_scout.llm import LLM, ScoutUnavailable
from workit_scout.prompt import SYSTEM_PROMPT, facts
from workit_scout.schemas import (
    ChatMessage,
    ErrorEvent,
    JobFacts,
    ResumeFacts,
    ScoutEvent,
    TextEvent,
)

# About 600 tokens. The prompt asks for short replies; this is the backstop
# that keeps a rambling one from costing more than it should. Providers count
# length limits differently, so it is enforced here rather than requested.
MAX_REPLY_CHARS = 2400


async def run(
    messages: Sequence[ChatMessage],
    llm: LLM,
    *,
    resume: ResumeFacts | None = None,
    job: JobFacts | None = None,
) -> AsyncIterator[ScoutEvent]:
    prompt = [
        # Facts after the frozen prompt, in the same message: the prefix providers
        # cache stays identical across users, and the facts carry its authority.
        {"role": "system", "content": f"{SYSTEM_PROMPT}\n{facts(resume, job)}"},
        *({"role": m.role, "content": m.content} for m in messages),
    ]
    sent = 0
    try:
        async for delta in llm.stream(prompt):
            yield TextEvent(delta=delta)
            sent += len(delta)
            if sent >= MAX_REPLY_CHARS:
                return
    except ScoutUnavailable as exc:
        yield ErrorEvent(message=str(exc))
