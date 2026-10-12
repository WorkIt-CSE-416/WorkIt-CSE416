'''
Request and response shapes for the Experience Bank and the resume builder
(routers/experience.py, KAN-176). Separate from models/experience.py: these
are what crosses HTTP, the models are rows.
'''
import uuid
from datetime import date

from pydantic import BaseModel, Field

from app.models.dto import EntrySection, ParsedResume

# Generous for a real resume, small enough that one request can't fill a row
MAX_BULLETS = 12
MAX_BULLET_CHARS = 400


class EntryDetails(BaseModel):
    '''What only some sections have. Unused keys stay null.'''
    field_of_study: str | None = Field(None, max_length=200)
    gpa: float | None = Field(None, ge=0, le=100)
    url: str | None = Field(None, max_length=500)
    technologies: str | None = Field(None, max_length=300)


class EntryDraft(BaseModel):
    '''An entry as the applicant writes it, before or without an id.'''
    section: EntrySection
    title: str = Field(min_length=1, max_length=200)
    organization: str | None = Field(None, max_length=200)
    location: str | None = Field(None, max_length=100)
    start_date: date | None = None
    end_date: date | None = None
    bullets: list[str] = Field(default=[], max_length=MAX_BULLETS)
    details: EntryDetails = EntryDetails()

    def model_post_init(self, _context) -> None:
        # Trim and drop blank lines here, so nothing downstream sees them
        self.bullets = [b.strip()[:MAX_BULLET_CHARS] for b in self.bullets if b.strip()]


class Entry(EntryDraft):
    id: uuid.UUID


class SkillDraft(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    category: str | None = Field(None, max_length=100)


class Bank(BaseModel):
    entries: list[Entry]
    skills: list[SkillDraft]


class SkillsUpdate(BaseModel):
    '''The whole skill list, in order. A PUT, like a resume's: what is left
    out is removed.'''
    skills: list[SkillDraft] = Field(max_length=100)


class ImportResult(BaseModel):
    added_entries: int
    added_skills: int


class ComposeRequest(BaseModel):
    '''Which entries and skills go on the resume, in the order they appear
    within their section. Ids that aren't the caller's are ignored.'''
    entry_ids: list[uuid.UUID] = Field(max_length=200)
    skill_names: list[str] | None = None  # None: every skill in the bank


class GenerateRequest(BaseModel):
    resume: ParsedResume
    template_key: str = "jakes"
    # Set when the resume was tailored to a job posting
    target_job_id: uuid.UUID | None = None
    name: str = Field("Resume", min_length=1, max_length=80)


class GeneratedResume(BaseModel):
    id: uuid.UUID
    original_filename: str
    pages: int


class BulletsRequest(BaseModel):
    entry: EntryDraft
    # What the applicant typed about it in their own words
    notes: str = Field("", max_length=2000)


class BulletsResponse(BaseModel):
    bullets: list[str]


class IntakeRequest(BaseModel):
    text: str = Field(min_length=1, max_length=4000)


class IntakeResponse(BaseModel):
    entries: list[EntryDraft]


class TailorRequest(BaseModel):
    job_id: uuid.UUID
    # The resume to start from; None starts from the whole bank
    resume_id: uuid.UUID | None = None


class Suggestion(BaseModel):
    '''One bullet the model would reword for this job. `path` says where it is:
    (section, item index, bullet index) in `resume`.'''
    section: str
    item: int
    bullet: int
    original: str
    suggested: str


class TailorResponse(BaseModel):
    # The starting resume, its items' bullets reordered most relevant first
    # and its skills those the posting mentions first. Saving it with the
    # accepted suggestions applied makes the Tailored Resume.
    resume: ParsedResume
    suggestions: list[Suggestion]
    # Set when the model couldn't answer: the reordering still stands
    notice: str | None = None
