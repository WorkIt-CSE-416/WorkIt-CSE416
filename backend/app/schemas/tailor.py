"""Request/response shapes for Tailor (KAN-217)."""

from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, Field, StringConstraints, model_validator

from app.schemas.built_resume import BuiltResumeResponse
from app.schemas.keywords import Keyword


class Reword(BaseModel):
    bullet: str
    text: str


class Placement(BaseModel):
    """Where one picked skill goes: a `group` (the resume's, or a new one)
    and `after`, the prompt's number of the skill it follows, 0 for first in
    its group. `services/tailor.py`'s `place_skills` checks each one."""

    skill: str
    group: str | None = None
    after: int | None = None


class TailorReading(BaseModel):
    """The model's reply: new wordings for the resume's bullets, each named
    by its handle in the prompt (b1), and a placement for each picked skill.
    Unknown handles are ignored; every wording then faces the truth-rule
    check."""

    rewords: list[Reword] = []
    placements: list[Placement] = []


class TailorSource(BaseModel):
    """The resume the student picked to tailor: exactly one of a built
    resume (its choices) or an uploaded resume (the entries it owns,
    built in memory and never saved; `services/tailor.py`'s
    `upload_choices`). The match and the run both name it."""

    built_resume_id: UUID | None = None
    uploaded_resume_id: UUID | None = None

    @model_validator(mode="after")
    def _one_source(self) -> "TailorSource":
        if (self.built_resume_id is None) == (self.uploaded_resume_id is None):
            raise ValueError("Give exactly one of built_resume_id and uploaded_resume_id")
        return self


class TailorRun(TailorSource):
    """POST /tailor body. `skills`: the missing keywords the student picked
    to add to the resume (`docs/tailor_resume.md`); any other name is
    ignored."""

    job_posting_id: UUID
    skills: list[Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=60)]] = Field(
        default=[], max_length=20)


class TailorChange(BaseModel):
    """One change a run makes, before it is saved (`services/tailor.py`).

    - `reword`: show `text` for `bullet_id` (in place of `original`).
    - `order`: show `entry_id`'s bullets in the order `bullet_ids`.
    """

    kind: Literal["reword", "order"]
    bullet_id: UUID | None = None
    entry_id: UUID | None = None
    bullet_ids: list[UUID] = []
    text: str | None = None
    original: str | None = None
    label: str | None = None


class TailorEdit(BaseModel):
    """One change a run saved on the tailored resume, with what it replaced,
    so the editor can mark it and revert it until Save
    (`docs/tailor_resume.md`, "Marking and reverting changes"). The browser
    keeps these; the API stores no record of them.

    - `reword`: `bullet_id` now shows `text` (variant `variant_id`); it
      showed `before` (variant `before_variant_id`, null for the bank's own
      wording). Revert: the choices PATCH with `variant_id=before_variant_id`.
    - `order`: `entry_id`'s bullets are now in the order `bullet_ids`; they
      were in `before_ids`. Revert: the choices PATCH with those positions.
    - `skill`: `skill_id` is a picked skill, `label` in `group`, local to
      this resume. Revert: hide it (the choices PATCH, `shown=False`).
    """

    kind: Literal["reword", "order", "skill"]
    bullet_id: UUID | None = None
    entry_id: UUID | None = None
    skill_id: UUID | None = None
    label: str | None = None
    text: str | None = None
    variant_id: UUID | None = None
    before: str | None = None
    before_variant_id: UUID | None = None
    bullet_ids: list[UUID] = []
    before_ids: list[UUID] = []
    group: str | None = None


class TailorMatchRequest(TailorSource):
    """POST /tailor/match body."""

    job_posting_id: UUID


class TailorMatch(BaseModel):
    """The picked resume's keyword match before a run, for the student to
    pick the missing keywords to add. `tailored_resume_id`: the posting's
    tailored resume, when it has one (a run is then refused).
    `weak_match`: the posting has no description, so WorkIt read its title
    only."""

    job_posting_id: UUID
    tailored_resume_id: UUID | None
    weak_match: bool
    matched: list[Keyword]
    missing: list[Keyword]


class TailorRunResult(BaseModel):
    """A run, saved as the posting's tailored resume (`resume`).
    `matched`/`missing`: the source's match; `after_matched`/`after_missing`:
    the tailored resume's. `edits`: what the run changed, for the editor.
    `dropped`: wordings the truth-rule or overlap check removed."""

    resume: BuiltResumeResponse
    weak_match: bool
    matched: list[Keyword]
    missing: list[Keyword]
    after_matched: list[Keyword]
    after_missing: list[Keyword]
    edits: list[TailorEdit]
    dropped: int
    uses_left: int
