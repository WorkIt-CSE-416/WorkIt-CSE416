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
    # Lines of text past page 1 (0 on a one-page resume), for the page-count
    # chip; an estimate that can run a line or two short (Rendered.lines_over)
    lines_over: int
    missing_characters: list[str]
    boxes: list[RenderBox]


class EntryChoiceResponse(BaseModel):
    entry_id: UUID
    shown: bool
    position: int
    show_gpa: bool
    show_coursework: bool


class BulletChoiceResponse(BaseModel):
    """`variant_id` and `text` name the wording that shows when it is not the
    bank's original (both null: the original)."""

    bullet_id: UUID
    shown: bool
    position: int
    variant_id: UUID | None
    text: str | None


class VariantResponse(BaseModel):
    """A wording the editor can switch a bullet to: Tailor's (with its
    `job_posting_id`) or this resume's own (`local`)."""

    id: UUID
    bullet_id: UUID
    text: str
    job_posting_id: UUID | None
    local: bool


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
    variants: list[VariantResponse]


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
    """`text` is wording typed on the page: it becomes this resume's local
    variant (one per bullet, updated in place), and typing the original back
    drops it. `variant_id` switches to one of the bullet's variants, or to
    the original with null. The bank's bullet never changes here."""

    bullet_id: UUID
    shown: bool | None = None
    position: int | None = None
    text: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=500)] | None = None
    variant_id: UUID | None = None


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


class FitResponse(BaseModel):
    """Fit to One Page (KAN-218): the bullets it hid, in the order it hid
    them (Undo shows them again through PATCH .../choices), and the render
    after, which can still be 2 pages when nothing more could be hidden."""

    hidden: list[UUID]
    render: RenderResponse
