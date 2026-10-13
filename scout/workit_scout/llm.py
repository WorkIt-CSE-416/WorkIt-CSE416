"""
The model behind Scout, and the only module in the API that imports `openai`.

Every provider Scout runs on speaks OpenAI's chat-completions format — Ollama
on a laptop, Gemini's compatibility endpoint, OpenAI itself — so choosing a
model is configuration (`SCOUT_*`, see settings.py), never code. That seam is
the reason this file exists; keep provider-specific behaviour out of the rest
of this package.
"""

import logging
from collections.abc import AsyncIterator, Sequence

from openai import APIConnectionError, APIStatusError, AsyncOpenAI, RateLimitError

from workit_scout.settings import Endpoint, ScoutSettings

logger = logging.getLogger(__name__)

Message = dict[str, str]

OFFLINE = "Scout is offline right now. Try again in a minute."
OUT_OF_QUOTA = "Scout has hit today's limit. Try again tomorrow."
CUT_OFF = "Scout lost its connection mid-reply. Try asking again."


class ScoutUnavailable(Exception):
    """No configured model could answer. The message is written for the user."""


def _worth_another_try(exc: Exception) -> bool:
    """
    Down, unreachable or out of quota: another provider may well answer.
    Any other 4xx is a wrong key, model name or parameter — the fallback would
    get the same request, so stop and let the log say why.
    """
    if isinstance(exc, APIStatusError):
        return isinstance(exc, RateLimitError) or exc.status_code >= 500
    return isinstance(exc, APIConnectionError)


def _user_message(exc: Exception) -> str:
    return OUT_OF_QUOTA if isinstance(exc, RateLimitError) else OFFLINE


class LLM:
    """
    Asks the endpoint chain, in order, for one reply. It moves to the next
    endpoint when one is rate-limited (429), erroring (5xx) or unreachable
    *before it has said anything*. Once text has reached the user a retry would
    repeat it, so a failure mid-reply ends the reply instead.
    """

    def __init__(self, endpoints: Sequence[Endpoint]):
        if not endpoints:
            raise ValueError("The endpoint chain is empty.")
        # Building a client opens no connection, so all are made up front.
        # max_retries=0: a daily cap does not lift after a backoff, and a
        # laptop without Ollama will not start one. Fail over at once.
        self._endpoints = [
            (
                endpoint,
                AsyncOpenAI(
                    base_url=endpoint.base_url,
                    api_key=endpoint.api_key or "unused",
                    max_retries=0,
                ),
            )
            for endpoint in endpoints
        ]

    @classmethod
    def from_settings(cls, s: ScoutSettings) -> "LLM":
        return cls(s.chain())

    async def stream(self, messages: Sequence[Message]) -> AsyncIterator[str]:
        failure = OFFLINE
        for endpoint, client in self._endpoints:
            started = False
            try:
                async for delta in self._complete(client, endpoint, messages):
                    started = True
                    yield delta
                return
            except (APIConnectionError, APIStatusError) as exc:
                logger.warning(
                    "Scout model %s at %s failed: %r",
                    endpoint.model,
                    endpoint.base_url,
                    exc,
                )
                if started:
                    raise ScoutUnavailable(CUT_OFF) from exc
                if not _worth_another_try(exc):
                    raise ScoutUnavailable(OFFLINE) from exc
                failure = _user_message(exc)
        raise ScoutUnavailable(failure)

    async def _complete(
        self, client: AsyncOpenAI, endpoint: Endpoint, messages: Sequence[Message]
    ) -> AsyncIterator[str]:
        extra = (
            {"reasoning_effort": endpoint.reasoning_effort}
            if endpoint.reasoning_effort
            else {}
        )
        stream = await client.chat.completions.create(
            model=endpoint.model,
            messages=list(messages),
            stream=True,
            **extra,
        )
        # The context manager closes the connection when the caller stops
        # reading early, which is also what stops the provider generating.
        async with stream:
            async for chunk in stream:
                if chunk.choices and (delta := chunk.choices[0].delta.content):
                    yield delta
