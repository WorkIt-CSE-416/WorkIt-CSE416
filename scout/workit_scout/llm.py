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
from typing import TypeVar

from openai import APIConnectionError, APIStatusError, AsyncOpenAI, RateLimitError
from pydantic import BaseModel, ValidationError

from workit_scout.identity import Identity
from workit_scout.settings import Endpoint, ScoutSettings

logger = logging.getLogger(__name__)

Message = dict[str, str]
T = TypeVar("T", bound=BaseModel)

OFFLINE = "Scout is offline right now. Try again in a minute."
OUT_OF_QUOTA = "Scout has hit today's limit. Try again tomorrow."
CUT_OFF = "Scout lost its connection mid-reply. Try asking again."


INVALID = "The model's answer came back in the wrong shape. Try again."


class ScoutUnavailable(Exception):
    """No configured model could answer. The message is written for the user."""


class InvalidReply(ScoutUnavailable):
    """A structured reply that is not JSON or fails its schema."""


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


def _effort(endpoint: Endpoint) -> dict[str, str]:
    # Sent only when set: not every provider accepts the parameter.
    if endpoint.reasoning_effort:
        return {"reasoning_effort": endpoint.reasoning_effort}
    return {}


def _log_failure(endpoint: Endpoint, exc: Exception) -> None:
    logger.warning(
        "Scout model %s at %s failed: %r", endpoint.model, endpoint.base_url, exc
    )


def _deidentified(messages: Sequence[Message], identity: Identity) -> list[Message]:
    # The seam's own guarantee: every message, system prompt included, loses
    # its identity data here, whatever the caller already removed.
    return [{**m, "content": identity.remove(m["content"])} for m in messages]


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

    async def stream(
        self, messages: Sequence[Message], *, identity: Identity
    ) -> AsyncIterator[str]:
        messages = _deidentified(messages, identity)
        failure = OFFLINE
        for endpoint, client in self._endpoints:
            started = False
            try:
                async for delta in self._complete(client, endpoint, messages):
                    started = True
                    yield delta
                return
            except (APIConnectionError, APIStatusError) as exc:
                _log_failure(endpoint, exc)
                if started:
                    raise ScoutUnavailable(CUT_OFF) from exc
                if not _worth_another_try(exc):
                    raise ScoutUnavailable(OFFLINE) from exc
                failure = _user_message(exc)
        raise ScoutUnavailable(failure)

    async def complete_json(
        self, messages: Sequence[Message], schema: type[T], *, identity: Identity
    ) -> T:
        """
        One whole reply, not streamed, as JSON checked against `schema`. Nothing
        reaches the user until it returns, so every endpoint in the chain may
        be tried. A reply that fails the check is rejected, not repaired: the
        caller decides whether to ask again.
        """
        messages = _deidentified(messages, identity)
        failure = OFFLINE
        for endpoint, client in self._endpoints:
            try:
                text = await self._complete_json(client, endpoint, messages, schema)
            except (APIConnectionError, APIStatusError) as exc:
                _log_failure(endpoint, exc)
                if not _worth_another_try(exc):
                    raise ScoutUnavailable(OFFLINE) from exc
                failure = _user_message(exc)
                continue
            try:
                return schema.model_validate_json(text)
            except ValidationError as exc:
                _log_failure(endpoint, exc)
                raise InvalidReply(INVALID) from exc
        raise ScoutUnavailable(failure)

    async def _complete_json(
        self,
        client: AsyncOpenAI,
        endpoint: Endpoint,
        messages: Sequence[Message],
        schema: type[BaseModel],
    ) -> str:
        # Not strict: providers disagree on which schemas strict mode accepts,
        # and the check above is what decides anyway.
        response = await client.chat.completions.create(
            model=endpoint.model,
            messages=list(messages),
            response_format={
                "type": "json_schema",
                "json_schema": {
                    "name": schema.__name__,
                    "schema": schema.model_json_schema(),
                },
            },
            **_effort(endpoint),
        )
        return response.choices[0].message.content or ""

    async def _complete(
        self, client: AsyncOpenAI, endpoint: Endpoint, messages: Sequence[Message]
    ) -> AsyncIterator[str]:
        stream = await client.chat.completions.create(
            model=endpoint.model,
            messages=list(messages),
            stream=True,
            **_effort(endpoint),
        )
        # The context manager closes the connection when the caller stops
        # reading early, which is also what stops the provider generating.
        async with stream:
            async for chunk in stream:
                if chunk.choices and (delta := chunk.choices[0].delta.content):
                    yield delta
