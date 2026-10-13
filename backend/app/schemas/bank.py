"""Request/response shapes for the experience bank (KAN-206).

Months travel as "YYYY-MM" and are stored as the first day of the month.
`EntryFields` is the one place that decides which fields an entry of each
section may hold and how its dates fit together; the PATCH route re-checks
the merged entry through it, so a partial edit cannot leave a bad row.
"""

import datetime
import re
from decimal import Decimal
from typing import Annotated
from uuid import UUID

from pydantic import (
    BaseModel,
    BeforeValidator,
    ConfigDict,
    Field,
    PlainSerializer,
    StringConstraints,
    model_validator,
)

from app.models.dto import bank_section, entry_end_kind

_MONTH_RE = re.compile(r"^(\d{4})-(0[1-9]|1[0-2])$")


def _parse_month(value: object) -> object:
    if isinstance(value, str):
        match = _MONTH_RE.match(value)
        if not match:
            raise ValueError("Use a month as YYYY-MM")
        return datetime.date(int(match[1]), int(match[2]), 1)
    if isinstance(value, datetime.date):
        return value.replace(day=1)
    return value


Month = Annotated[
    datetime.date,
    BeforeValidator(_parse_month),
    PlainSerializer(lambda d: d.strftime("%Y-%m"), return_type=str, when_used="json"),
]

Text = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]
LongText = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=500)]
Name = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=60)]
Grade = Annotated[Decimal, Field(gt=0, le=100, max_digits=5, decimal_places=2)]

# The fields only one section holds. Any other section must leave them empty.
SECTION_FIELDS: dict[bank_section, tuple[str, ...]] = {
    bank_section.education: ("degree", "field_of_study", "gpa", "gpa_scale", "coursework", "honors"),
    bank_section.projects: ("link",),
    bank_section.certifications: ("issuer",),
    bank_section.awards: ("award_date",),
}
_ALL_SECTION_FIELDS = {f for fields in SECTION_FIELDS.values() for f in fields}


class EntryFields(BaseModel):
    """Every field of an entry, checked as a whole."""

    section: bank_section
    title: Text
    organization: Text | None = None
    location: Text | None = None
    start_month: Month | None = None
    end_month: Month | None = None
    end_kind: entry_end_kind | None = None
    degree: Text | None = None
    field_of_study: Text | None = None
    gpa: Grade | None = None
    gpa_scale: Grade | None = None
    coursework: list[Text] = Field(default_factory=list, max_length=40)
    honors: LongText | None = None
    link: LongText | None = None
    issuer: Text | None = None
    award_date: Month | None = None

    @model_validator(mode="after")
    def _fits_together(self) -> "EntryFields":
        own = set(SECTION_FIELDS.get(self.section, ()))
        stray = [f for f in sorted(_ALL_SECTION_FIELDS - own) if getattr(self, f) not in (None, [])]
        if stray:
            raise ValueError(f"A {self.section.value} entry has no {', '.join(stray)}")

        if self.end_kind is entry_end_kind.present and self.end_month is not None:
            raise ValueError("An entry that runs to Present has no end month")
        if self.end_kind in (entry_end_kind.month, entry_end_kind.expected) and self.end_month is None:
            raise ValueError("This end needs an end month")
        if self.end_kind is None and self.end_month is not None:
            self.end_kind = entry_end_kind.month
        if self.start_month and self.end_month and self.end_month < self.start_month:
            raise ValueError("The end month comes before the start month")

        if self.gpa is not None and self.gpa_scale is not None and self.gpa > self.gpa_scale:
            raise ValueError("The GPA is higher than its scale")
        return self


class EntryCreate(EntryFields):
    """POST body: an entry, optionally with its bullets in order."""

    bullets: list[LongText] = Field(default_factory=list, max_length=30)


class EntryUpdate(BaseModel):
    """PATCH body. Only fields present in the JSON change; send null to clear
    one. The section is fixed once the entry exists."""

    model_config = ConfigDict(extra="forbid")

    title: Text | None = None
    organization: Text | None = None
    location: Text | None = None
    start_month: Month | None = None
    end_month: Month | None = None
    end_kind: entry_end_kind | None = None
    degree: Text | None = None
    field_of_study: Text | None = None
    gpa: Grade | None = None
    gpa_scale: Grade | None = None
    coursework: list[Text] | None = Field(None, max_length=40)
    honors: LongText | None = None
    link: LongText | None = None
    issuer: Text | None = None
    award_date: Month | None = None


class BulletCreate(BaseModel):
    text: LongText


class BulletUpdate(BaseModel):
    """PATCH body: new wording and/or a new place in the entry (0 is first)."""

    text: LongText | None = None
    position: int | None = Field(None, ge=0)


class BulletResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    position: int
    text: str


class EntryResponse(EntryFields):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    gpa: float | None = None
    gpa_scale: float | None = None
    bullets: list[BulletResponse] = []


class SkillCreate(BaseModel):
    name: Name
    group: Name | None = None


class SkillUpdate(BaseModel):
    """PATCH body. Only fields present in the JSON change."""

    name: Name | None = None
    group: Name | None = None


class SkillResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    name: str
    group: str | None


class BankResponse(BaseModel):
    """The whole bank: entries in section order, ongoing first and then
    newest, each with its bullets in order; skills by group, then name."""

    entries: list[EntryResponse]
    skills: list[SkillResponse]


class DuplicateEntry(BaseModel):
    """The 409 body when a new entry matches one already in the bank."""

    detail: str
    duplicate: EntryResponse


class ImportRequest(BaseModel):
    """POST body for import. Without a resume id, import reads the default
    resume, else the newest upload."""

    resume_id: UUID | None = None


class DraftEntry(EntryCreate):
    """A draft entry from import: the body POST /entries takes, plus the id of
    the bank entry it matches ("Already in your bank"), if any."""

    gpa: float | None = None
    gpa_scale: float | None = None
    duplicate_of: UUID | None = None


class DraftSkill(BaseModel):
    name: str
    group: str | None
    # A skill of that name, ignoring case, is already in the bank.
    in_bank: bool


class ImportResponse(BaseModel):
    """What import read from one uploaded resume. Nothing here is saved."""

    resume_id: UUID
    filename: str | None
    entries: list[DraftEntry]
    skills: list[DraftSkill]
