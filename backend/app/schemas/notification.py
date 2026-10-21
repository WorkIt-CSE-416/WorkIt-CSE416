"""Request/response shapes for GET and POST .../notifications (KAN-298)."""

import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict


class DigestJob(BaseModel):
    """One job inside a job_alert notification's `data` — enough to render
    a link with no second query."""

    job_id: str
    title: str
    company: str
    match: int


class NotificationResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    type: str
    title: str
    body: str
    data: list[DigestJob]
    read_at: datetime.datetime | None
    created_at: datetime.datetime


class NotificationList(BaseModel):
    """GET .../notifications: newest first, plus the unread count in the
    same round trip rather than a second request for the bell's badge."""

    notifications: list[NotificationResponse]
    unread_count: int
