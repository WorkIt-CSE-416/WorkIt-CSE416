import datetime
import uuid
from typing import Literal

from pydantic import BaseModel, Field, field_validator, model_validator

from app.models.dto import (
    application_event_kind,
    application_event_source,
    application_event_status,
    application_stage,
)


class StageChange(BaseModel):
    """PUT .../applications/{job_id}/stage: the stage menu's pick. Only
    applied or later: a record never goes back to a bookmark or the queue."""

    stage: Literal["applied", "interviewing", "offer", "rejected"]


class StageSet(BaseModel):
    """The application's stage after a change."""

    job_id: uuid.UUID
    stage: application_stage


class EventCreate(BaseModel):
    """POST .../applications/{job_id}/events: Add Event. Exactly one of `at`
    (an instant with its zone, for something at a time) or `on_day` (a
    date, for something due on a day). A confirmation only comes from an
    email, so it is not offered."""

    kind: Literal["assessment", "interview", "offer", "rejection", "other"]
    title: str = Field(min_length=1, max_length=120)
    at: datetime.datetime | None = None
    on_day: datetime.date | None = None
    note: str | None = Field(None, max_length=1000)
    meeting_url: str | None = Field(None, max_length=500)

    @field_validator("title")
    @classmethod
    def _title(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("Give the event a title.")
        return value.strip()

    @field_validator("note", "meeting_url")
    @classmethod
    def _strip(cls, value: str | None) -> str | None:
        # A blank box is no note, not an empty one
        value = value.strip() if value is not None else None
        return value or None

    @field_validator("meeting_url")
    @classmethod
    def _web_link(cls, value: str | None) -> str | None:
        # The tracker renders it as a link: only a web address, never a
        # javascript: or data: one
        if value is not None and not value.lower().startswith(("https://", "http://")):
            raise ValueError("The meeting link must start with https://")
        return value

    @model_validator(mode="after")
    def _one_when(self) -> "EventCreate":
        if (self.at is None) == (self.on_day is None):
            raise ValueError("Give either a time (at) or a day (on_day), not both.")
        if self.at is not None and self.at.tzinfo is None:
            raise ValueError("A time needs its zone, or it can't be placed on the Calendar.")
        return self


class EventResponse(BaseModel):
    """One event on an application, as the tracker draws it."""

    id: uuid.UUID
    job_id: uuid.UUID | None
    kind: application_event_kind
    status: application_event_status
    source: application_event_source
    title: str
    at: datetime.datetime | None
    on_day: datetime.date | None
    note: str | None
    meeting_url: str | None


class EventAccept(BaseModel):
    """POST .../events/{event_id}/accept's optional body: the application to
    put it on, in place of the one it was matched to (Wrong Job?), or for
    one that matched none (Couldn't Match)."""

    job_id: uuid.UUID | None = None


class EventAdded(BaseModel):
    """Add Event's answer: the event, and the application's stage after it
    (an interview moves an applied application to interviewing)."""

    event: EventResponse
    stage: application_stage
