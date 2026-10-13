"""Request/response shapes for Tailor (KAN-217)."""

from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field

from app.schemas.built_resume import BuiltResumeResponse
from app.schemas.keywords import Keyword


class Reword(BaseModel):
    bullet: str
    text: str


class TailorReading(BaseModel):
    """The model's reply: new wordings for bullets and the left-out entries
    to bring back, each named by its handle in the prompt (b1, e1). Unknown
    handles are ignored; every wording then faces the truth-rule check."""

    rewords: list[Reword] = []
    add_entries: list[str] = []


class TailorRun(BaseModel):
    """POST /tailor body."""

    job_posting_id: UUID


class TailorChange(BaseModel):
    """One proposed change, which the student accepts or rejects.

    - `reword`: show `text` for `bullet_id` (in place of `original`).
    - `show_entry`: put `entry_id` (left off the resume) back, with its bullets.
    - `show_skill`: show `skill_id`.
    - `order`: show `entry_id`'s bullets in the order `bullet_ids`.

    `label` and `keywords` (the posting's keywords this change alone would
    add to the match) are for display; Done ignores them.
    """

    kind: Literal["reword", "show_entry", "show_skill", "order"]
    bullet_id: UUID | None = None
    entry_id: UUID | None = None
    skill_id: UUID | None = None
    bullet_ids: list[UUID] = []
    text: str | None = None
    original: str | None = None
    label: str | None = None
    keywords: list[str] = []


class TailorProposal(BaseModel):
    """A run's proposals; nothing is saved until Done. `matched`/`missing`
    is the source resume's keyword match ("12 of 18"); `questions` are the
    missing keywords that are nowhere in the bank, to ask "Have you used
    X?" about, never to write in. `weak_match`: the posting has no
    description, so WorkIt read its title only. `dropped`: wordings the
    truth-rule check removed."""

    job_posting_id: UUID
    source_resume_id: UUID
    tailored_resume_id: UUID | None
    weak_match: bool
    matched: list[Keyword]
    missing: list[Keyword]
    questions: list[Keyword]
    changes: list[TailorChange]
    dropped: int
    uses_left: int


class TailorDone(BaseModel):
    """POST /tailor/done body: the accepted changes, applied to the source
    resume's choices and saved on the posting's one tailored resume."""

    job_posting_id: UUID
    source_resume_id: UUID
    changes: list[TailorChange] = Field(default_factory=list, max_length=200)


class TailorResult(BaseModel):
    resume: BuiltResumeResponse
    matched: list[Keyword]
    missing: list[Keyword]
