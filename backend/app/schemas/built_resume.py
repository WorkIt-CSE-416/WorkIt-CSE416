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


SECTION_ORDER = ("education", "experience", "projects", "leadership", "awards", "certifications", "skills")


class PageSettings(BaseModel):
    """How a built resume's page is set (KAN-435): resume_render's
    PageSettings, as the API takes and answers it. Its defaults are Jake's
    page, and each value is one of the lists the student picks from, or a
    typed size inside resume_render's scales, in half points."""

    font_size: Literal[10, 11, 12] = 11
    line_spacing: Literal[1.0, 1.15, 1.3] = 1.0
    side_margin: Literal[0.5, 0.75, 1.0] = 0.5
    top_margin: Literal[0.5, 0.75, 1.0] = 0.5
    alignment: Literal["left", "justified"] = "left"
    section_spacing: Literal[0, 4, 8, 12] = 0
    entry_spacing: Literal[0, 2, 4, 6] = 0
    accent: Literal["#000000", "#1E3A5F", "#14532D", "#7F1D1D", "#4C1D95"] = "#000000"
    bullet: Literal["dot", "dash"] = "dot"
    show_divider: bool = True
    header_alignment: Literal["left", "center", "right"] = "center"
    section_order: list[str] = list(SECTION_ORDER)
    font_family: Literal[
        "latin_modern", "tinos", "caladea", "eb_garamond", "charter", "arimo", "carlito", "open_sans", "lato",
    ] = "latin_modern"
    # A size per kind of text; null follows `font_size`, as Jake's does
    name_size: Annotated[float, Field(ge=14, le=36, multiple_of=0.5)] | None = None
    heading_size: Annotated[float, Field(ge=9, le=18, multiple_of=0.5)] | None = None
    title_size: Annotated[float, Field(ge=8, le=16, multiple_of=0.5)] | None = None
    body_size: Annotated[float, Field(ge=8, le=14, multiple_of=0.5)] | None = None

    @model_validator(mode="after")
    def _every_section_once(self) -> "PageSettings":
        if sorted(self.section_order) != sorted(SECTION_ORDER):
            raise ValueError("Send every section once")
        return self


class RenderPoint(BaseModel):
    """Where a \\wipoint landed (resume_render.Point): a skill line's start,
    which Fit to One Page reads a line's width from."""

    name: str = Field(max_length=200)
    page: int
    x: float
    y: float


class RenderShrink(BaseModel):
    """One start marker's page total and shrink (resume_render.Shrink): how
    far the glue under it can give, which Fit to One Page counts."""

    name: str = Field(max_length=200)
    page: int
    total: float
    shrink: float


class RenderArea(BaseModel):
    """The page's text area (resume_render.TextArea), in PDF points."""

    top: float
    height: float
    right: float


class RenderMeasure(BaseModel):
    """What Fit to One Page measures a render by (fit_page.Page), as the
    editor holds it from a render's answer, with no PDF: the editor sends it
    back so a fit needs no compile of the page it already shows (KAN-584)."""

    page_count: int = Field(ge=1)
    boxes: list[RenderBox] = Field(max_length=5000)
    points: list[RenderPoint] = Field(max_length=500)
    area: RenderArea | None = None
    shrinks: list[RenderShrink] = Field(max_length=5000)
    wrapped_line: float = 12.0


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
    # How the page is set, and the distance between a wrapped bullet's
    # baselines there, which reads a box's height as lines
    page_settings: PageSettings = PageSettings()
    wrapped_line: float = 12.0
    # What Fit to One Page measures the page by (RenderMeasure): the editor
    # sends them back with the boxes, so a fit plans with no compile
    points: list[RenderPoint] = []
    area: RenderArea | None = None
    shrinks: list[RenderShrink] = []


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
    page_settings: PageSettings = PageSettings()


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
    """An edit to render, never saved: a typed line (`line`), a choice
    change (`changes`, the choices PATCH body) or the page's settings
    (`page`, KAN-435), exactly one, made to the editor's copy (`source`,
    required: the render reads no database) in memory."""

    line: LineEdit | None = None
    changes: ChoicesUpdate | None = None
    page: PageSettings | None = None
    source: ResumeCopy

    @model_validator(mode="after")
    def _one_edit(self) -> "EditRender":
        if sum(edit is not None for edit in (self.line, self.changes, self.page)) != 1:
            raise ValueError("Send one of a line, changes or page settings")
        return self


class EditRendered(BaseModel):
    """The resume with the edit made, rendered, and what the edit changed in
    the copy, as the editor holds it: the choices after a typed bullet or a
    choice change, the entry after a typed entry field (its own fields only:
    `bullets` and `resume_ids` empty), the header in `render.identity`."""

    render: RenderResponse
    choices: ChoicesResponse | None = None
    entry: EntryResponse | None = None


class FitPlan(BaseModel):
    """One cycle of Fit to One Page from the editor (KAN-584), with no
    compile and no read of the resume's content: `source`, the editor's copy
    as it stood when the fit began, and `first`, the measure of the PDF that
    copy printed, which every cycle plans from; `now`, the measure of the
    PDF after the first `taken` steps (none on the first cycle)."""

    source: ResumeCopy
    first: RenderMeasure
    now: RenderMeasure | None = None
    taken: int = Field(0, ge=0, le=10_000)


class FitPlanned(BaseModel):
    """This cycle's cuts: `hide`, the PATCH .../choices body that makes
    them, which the editor renders and saves as any edit; `undo`, the body
    that shows them again; and `taken`, the steps made so far, sent back on
    the next cycle. An empty `hide` means the page fits, or nothing is left
    to cut."""

    hide: ChoicesUpdate
    undo: ChoicesUpdate
    taken: int


class FitResponse(BaseModel):
    """Fit to One Page (KAN-218, KAN-320): the bullets it hid, in the order
    it hid them; `undo`, the PATCH .../choices body that shows everything it
    hid again (whole entries and skills too); and the render after, one
    page."""

    hidden: list[UUID]
    undo: ChoicesUpdate
    render: RenderResponse
