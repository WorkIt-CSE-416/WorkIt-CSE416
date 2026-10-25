"""Request/response shapes for Tailor (KAN-217)."""

from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field, model_validator

from app.schemas.built_resume import BuiltResumeResponse
from app.schemas.keywords import Keyword


class Reword(BaseModel):
    bullet: str
    text: str


class TailorReading(BaseModel):
    """The model's reply: new wordings for the resume's bullets, each named
    by its handle in the prompt (b1). Unknown handles are ignored; every
    wording then faces the truth-rule check."""

    rewords: list[Reword] = []


class TailorSource(BaseModel):
    """The resume the student picked to tailor: exactly one of a built
    resume (its choices) or an uploaded resume (the entries it owns,
    built in memory and never saved; `services/tailor.py`'s
    `upload_choices`). Run and Done both name it, so Done rebuilds what the
    run proposed against."""

    built_resume_id: UUID | None = None
    uploaded_resume_id: UUID | None = None

    @model_validator(mode="after")
    def _one_source(self) -> "TailorSource":
        if (self.built_resume_id is None) == (self.uploaded_resume_id is None):
            raise ValueError("Give exactly one of built_resume_id and uploaded_resume_id")
        return self


class TailorRun(TailorSource):
    """POST /tailor body."""

    job_posting_id: UUID


class TailorChange(BaseModel):
    """One proposed change, which the student accepts or rejects.

    - `reword`: show `text` for `bullet_id` (in place of `original`).
    - `show_skill`: show `skill_id`.
    - `order`: show `entry_id`'s bullets in the order `bullet_ids`.

    `label` is for display; Done ignores it.
    """

    kind: Literal["reword", "show_skill", "order"]
    bullet_id: UUID | None = None
    entry_id: UUID | None = None
    skill_id: UUID | None = None
    bullet_ids: list[UUID] = []
    text: str | None = None
    original: str | None = None
    label: str | None = None


class TailorProposal(BaseModel):
    """A run's proposals; nothing is saved until Done, except what reading
    an uploaded source that owned nothing wrote into the bank. `built_resume_id` or
    `uploaded_resume_id` is the source the run was given, for Done to send
    back. `matched`/`missing` is the source resume's keyword match ("12 of 18"); `questions` are the
    missing keywords, to ask "Have you used X?" about, never to write in. `weak_match`: the posting has no
    description, so WorkIt read its title only. `dropped`: wordings the
    truth-rule check removed."""

    job_posting_id: UUID
    built_resume_id: UUID | None
    uploaded_resume_id: UUID | None
    tailored_resume_id: UUID | None
    weak_match: bool
    matched: list[Keyword]
    missing: list[Keyword]
    questions: list[Keyword]
    changes: list[TailorChange]
    dropped: int
    uses_left: int


class TailorDone(TailorSource):
    """POST /tailor/done body: the accepted changes, applied to the source
    resume's choices and saved on the posting's one tailored resume."""

    job_posting_id: UUID
    changes: list[TailorChange] = Field(default_factory=list, max_length=200)


class TailorResult(BaseModel):
    resume: BuiltResumeResponse
    matched: list[Keyword]
    missing: list[Keyword]
