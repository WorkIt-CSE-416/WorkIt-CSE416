"""
Request and response shapes for POST /scout/chat — the wire format the API's
route and frontend/src/components/scout/stream.ts both speak.

The response is not one JSON document but a stream of them, one per line
(NDJSON), each a `ScoutEvent`. A plain text stream would do for chat alone, but
later events carry structure the panel renders as UI — a preference change to
confirm, a list of matched jobs — so every line says what it is from the start.
"""

from typing import Annotated, Literal

from pydantic import BaseModel, Field

# The history is held by the browser and sent whole each turn, so these bound
# what one request can make the model read.
MAX_MESSAGE_CHARS = 4000
MAX_MESSAGES = 40


class ChatMessage(BaseModel):
    # No "system": the system prompt is the server's, never the caller's.
    role: Literal["user", "assistant"]
    content: str = Field(min_length=1, max_length=MAX_MESSAGE_CHARS)


class ChatRequest(BaseModel):
    messages: list[ChatMessage] = Field(min_length=1, max_length=MAX_MESSAGES)
    # The job the user asked about from its card: the feed's id, its apply URL.
    # Sent with every message after, so follow-ups keep the job in view.
    job_id: str | None = Field(None, max_length=2048)


class JobFacts(BaseModel):
    """What Scout may say about the job. Only what the posting stated."""

    title: str
    company: str
    location: str | None = None
    work_style: str | None = None
    experience_level: str | None = None
    description: str | None = None


class ResumeFacts(BaseModel):
    """
    What Scout may say about the user, one line per item. Parsed sections only
    — never a name, email, phone or link: the production model is a free tier
    that may train on prompts, so contact details must never reach it.
    """

    skills: list[str] = []
    experience: list[str] = []
    education: list[str] = []
    projects: list[str] = []


class TextEvent(BaseModel):
    """A piece of Scout's reply, to append to what has arrived so far."""

    type: Literal["text"] = "text"
    delta: str


class ErrorEvent(BaseModel):
    """Scout could not answer. `message` is written for the user."""

    type: Literal["error"] = "error"
    message: str


ScoutEvent = Annotated[TextEvent | ErrorEvent, Field(discriminator="type")]
