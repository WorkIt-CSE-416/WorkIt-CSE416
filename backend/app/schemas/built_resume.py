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


class EntryChoiceResponse(BaseModel):
    entry_id: UUID
    shown: bool
    position: int
    show_gpa: bool
    show_coursework: bool


class BulletChoiceResponse(BaseModel):
    bullet_id: UUID
    shown: bool
    position: int


class SkillChoiceResponse(BaseModel):
    skill_id: UUID
    shown: bool
    position: int


class ChoicesResponse(BaseModel):
    """A built resume's choice rows (KAN-218). A bank item with no row here
    is not on the resume: the editor's "Not on This Resume" tray lists it
    with the shown=False rows."""

    entries: list[EntryChoiceResponse]
    bullets: list[BulletChoiceResponse]
    skills: list[SkillChoiceResponse]


class EntryChoiceUpdate(BaseModel):
    """A field left out keeps its value. A bank entry with no row gets one,
    shown, at the end of its section, with a row for each of its bullets
    that has none."""

    entry_id: UUID
    shown: bool | None = None
    position: int | None = None
    show_gpa: bool | None = None
    show_coursework: bool | None = None


class BulletChoiceUpdate(BaseModel):
    bullet_id: UUID
    shown: bool | None = None
    position: int | None = None


class SkillChoiceUpdate(BaseModel):
    skill_id: UUID
    shown: bool | None = None
    position: int | None = None


class ChoicesUpdate(BaseModel):
    """PATCH body: every change in one request, saved together, so a move
    (a renumbered section or entry) or Fit's Undo never half-applies."""

    entries: list[EntryChoiceUpdate] = []
    bullets: list[BulletChoiceUpdate] = []
    skills: list[SkillChoiceUpdate] = []
