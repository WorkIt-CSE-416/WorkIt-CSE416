"""Request/response shapes for built resumes (KAN-207)."""

import datetime
from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, Field, StringConstraints, model_validator

from app.schemas.bank import EntryResponse, SkillResponse
from app.schemas.profile import ApplicantProfileResponse

Name = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=80)]


class BuiltResumeCreate(BaseModel):
    """POST body for Generate. With no name the resume is "Resume #N"
    (`services/built_resumes.next_name`, KAN-258); every one made with no
    name was "Base Resume" before."""

    name: Name | None = None


class BuiltResumeRename(BaseModel):
    """PATCH body: the resume's new name (KAN-258)."""

    name: Name


class BuiltResumeResponse(BaseModel):
    id: UUID
    name: str
    template: str
    job_posting_id: UUID | None
    is_default: bool
    created_at: datetime.datetime
    # The last change to the resume itself: what shows, its order, its
    # wording or its name (KAN-258). It equals `created_at` until then. A
    # fix in the bank changes every resume and is not counted.
    edited_at: datetime.datetime
    # A tailored resume whose posting the Jobs page no longer lists.
    posting_closed: bool = False
    # A tailored resume's posting, so its card names the job and links to
    # it (KAN-268). Null on a base resume.
    posting_title: str | None = None
    posting_company: str | None = None


class RenderBox(BaseModel):
    """Where one line sits on the PDF, for the editor's click target
    (KAN-209). `item_id` is the bank id of the bullet, skill or entry the line
    shows; `kind` is "bullet", "skill" or the entry field (title,
    organization, location, dates, degree, gpa, coursework, honors). The
    header's lines have `item_id` "header" and the profile column as `kind`
    (full_name, phone_number, email, linkedin_url, ...). A
    rectangle in PDF points from the page's top left, y growing down;
    `page` counts from 1. One item and kind can have a box on each of two
    pages when its line splits across a page break. `text` is the line as
    printed, labels included ("GPA: 3.8/4.0"): the editor's typing field
    opens on it, and the live page shows it (KAN-391)."""

    item_id: UUID | Literal["header"]
    kind: str
    page: int
    x0: float
    y0: float
    x1: float
    y1: float
    text: str = ""


class IdentityCopy(BaseModel):
    """The header a PDF printed (resume_render.HeaderIdentity): sent with
    every render, so the editor can send it back in its `ResumeCopy`.
    `links` are (profile column, URL) pairs in print order."""

    name: str
    email: str | None = None
    phone: str | None = None
    links: list[tuple[str, str]] = []
    us_citizen: bool = False


class RenderResponse(BaseModel):
    """The rendered PDF, base64, with what the student is warned about
    before download and the editor's boxes, in page order."""

    pdf: str
    # What a download saves it as: the resume's name, header-safe
    # (services/built_resumes.file_name)
    file_name: str
    page_count: int
    # Lines of text past page 1 (0 on a one-page resume), for the page-count
    # chip; an estimate that can run a line or two short (Rendered.lines_over)
    lines_over: int
    missing_characters: list[str]
    boxes: list[RenderBox]
    identity: IdentityCopy | None = None
    # The resume's template id, which the editor sends back in its copy
    template: str = "jakes"


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


class ResumeCopy(BaseModel):
    """The editor's copy of what its PDF is built from (KAN-391): the bank
    as GET /bank sent it (the resume's own skills included), the choices as
    the choices routes send them, and the header the last render printed.
    With it, an edit's PDF compiles at once, from the copy with the edit
    made, with no database read. It shapes only the PDF sent back to the
    student who sent it, and the whole-entry check of a typed entry field;
    every write checks ownership in the database, and every download, Apply
    and sent resume reads the database."""

    entries: list[EntryResponse] = Field(max_length=500)
    skills: list[SkillResponse] = Field(max_length=1000)
    choices: ChoicesResponse
    identity: IdentityCopy
    # From the last render, so a render of the copy reads no resume row
    template: str = Field("jakes", max_length=40)
    file_name: str = Field("Resume.pdf", max_length=200)


class LineEdit(BaseModel):
    """One line typed in the editor (KAN-391): the clicked box's `item_id`
    and `kind`, and the text as typed. The API decides what it changes
    (services/resume_lines.py)."""

    item_id: UUID | Literal["header"]
    kind: str
    text: Annotated[str, StringConstraints(max_length=500)]


class LineSave(LineEdit):
    """A typed line to save. `source`, the editor's copy, gives a typed
    entry field the rest of its entry to be checked against, so the save
    reads nothing; without it the entry is read first."""

    source: ResumeCopy | None = None


class ResumeChanged(BaseModel):
    """When anything the resume's page prints last changed, and the
    database's clock now (KAN-391): the editor asks on a return to its tab
    after a while away, and reloads only when something changed while it
    was hidden. `now` lets it read its own clock against the database's."""

    changed_at: datetime.datetime
    now: datetime.datetime


class LineSaved(BaseModel):
    """What the save wrote that the editor cannot know: a typed bullet's
    local variant (`variant_id`, null when the original was typed back),
    and the profile after a header field (`profile`, its own columns as the
    write returned them)."""

    variant_id: UUID | None = None
    profile: ApplicantProfileResponse | None = None


class EditRender(BaseModel):
    """An edit to render, never saved: a typed line (`line`) or a choice
    change (`changes`, the choices PATCH body), exactly one, made to the
    editor's copy (`source`, required: the render reads no database) in
    memory."""

    line: LineEdit | None = None
    changes: ChoicesUpdate | None = None
    source: ResumeCopy

    @model_validator(mode="after")
    def _one_edit(self) -> "EditRender":
        if (self.line is None) == (self.changes is None):
            raise ValueError("Send a line or changes, not both")
        return self


class EditRendered(BaseModel):
    """The resume with the edit made, rendered, and what the edit changed in
    the copy, as the editor holds it: the choices after a typed bullet or a
    choice change, the entry after a typed entry field (its own fields only:
    `bullets` and `resume_ids` empty), the header in `render.identity`."""

    render: RenderResponse
    choices: ChoicesResponse | None = None
    entry: EntryResponse | None = None


class FitResponse(BaseModel):
    """Fit to One Page (KAN-218, KAN-320): the bullets it hid, in the order
    it hid them; `undo`, the PATCH .../choices body that shows everything it
    hid again (whole entries and skills too); and the render after, one
    page."""

    hidden: list[UUID]
    undo: ChoicesUpdate
    render: RenderResponse
