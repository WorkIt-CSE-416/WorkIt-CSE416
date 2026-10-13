"""Request/response shapes for built resumes (KAN-207)."""

import datetime
from typing import Annotated
from uuid import UUID

from pydantic import BaseModel, StringConstraints

Name = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=80)]


class BuiltResumeCreate(BaseModel):
    """POST body for Generate. With no name the resume is "Base Resume"."""

    name: Name = "Base Resume"


class BuiltResumeResponse(BaseModel):
    id: UUID
    name: str
    template: str
    job_posting_id: UUID | None
    is_default: bool
    created_at: datetime.datetime


class RenderResponse(BaseModel):
    """The rendered PDF, base64, with what the student is warned about
    before download. The editor overlay (slice 5) adds the boxes."""

    pdf: str
    page_count: int
    missing_characters: list[str]
