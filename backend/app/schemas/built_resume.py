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


class RenderBox(BaseModel):
    """Where one line sits on the PDF, for the editor's click target
    (KAN-209). `item_id` is the bank id of the bullet, skill or entry the line
    shows; `kind` is "bullet", "skill" or the entry field (title,
    organization, location, dates, degree, gpa, coursework, honors). A
    rectangle in PDF points from the page's top left, y growing down;
    `page` counts from 1. One item and kind can have a box on each of two
    pages when its line splits across a page break."""

    item_id: UUID
    kind: str
    page: int
    x0: float
    y0: float
    x1: float
    y1: float


class RenderResponse(BaseModel):
    """The rendered PDF, base64, with what the student is warned about
    before download and the editor's boxes, in page order."""

    pdf: str
    page_count: int
    missing_characters: list[str]
    boxes: list[RenderBox]
