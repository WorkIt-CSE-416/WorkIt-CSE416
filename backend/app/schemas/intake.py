"""Request/response shapes for intake (KAN-213): one turn of the chat that
fills a draft entry card.

The draft is the bank's entry schema (`EntryCreate`, so the same section
fields and date rules), with two changes for an entry still being drafted:
the title may be empty, and the JSON schema sent to the model spells a month
as a "YYYY-MM" string (a plain date would invite "2025-01-01", which the
entry schema rejects). GPA travels as a number, as in `EntryResponse`.
"""

from typing import Annotated, Literal

from pydantic import (
    BaseModel,
    Field,
    StringConstraints,
    WithJsonSchema,
    field_validator,
    model_validator,
)
from workit_scout.schemas import MAX_MESSAGES, ChatMessage

from app.models.dto import bank_section
from app.schemas.bank import EntryCreate, Month

DraftMonth = Annotated[
    Month, WithJsonSchema({"type": "string", "pattern": r"^\d{4}-(0[1-9]|1[0-2])$"})
]


class IntakeDraft(EntryCreate):
    """An entry as intake has drafted it so far."""

    title: Annotated[str, StringConstraints(strip_whitespace=True, max_length=200)] = ""
    start_month: DraftMonth | None = None
    end_month: DraftMonth | None = None
    award_date: DraftMonth | None = None
    gpa: float | None = Field(None, gt=0, le=100)
    gpa_scale: float | None = Field(None, gt=0, le=100)

    @field_validator("coursework", "bullets", mode="before")
    @classmethod
    def _null_is_empty(cls, value: object) -> object:
        # A live model sends null for a list it has nothing for, most often
        # Education's coursework in another section; that is an empty list,
        # not a reason to throw the whole turn away.
        return [] if value is None else value

    @field_validator(
        "organization", "location", "degree", "field_of_study", "honors", "link", "issuer",
        mode="before",
    )
    @classmethod
    def _blank_is_none(cls, value: object) -> object:
        # The same for a blank text field: the prompt says to leave it empty,
        # and a live model sends "" where the schema wants null.
        return None if isinstance(value, str) and not value.strip() else value

    @model_validator(mode="before")
    @classmethod
    def _no_end_month_no_end(cls, value: object) -> object:
        # "Summer 2024": a live model sent end_kind "month" with no end_month,
        # which the entry's end rule rejects. The end is a fact the student
        # has not given yet, not a reason to throw the whole turn away.
        if (
            isinstance(value, dict)
            and value.get("end_kind") in ("month", "expected")
            and not value.get("end_month")
        ):
            return {**value, "end_kind": None}
        return value


class IntakeTurnRequest(BaseModel):
    """One turn: the section being filled, this entry's chat so far (the
    browser holds it; the API stores none of it), and the card as it is now,
    with any edits the student typed into it."""

    section: bank_section
    messages: list[ChatMessage] = Field(min_length=1, max_length=MAX_MESSAGES)
    draft: IntakeDraft | None = None

    @model_validator(mode="after")
    def _draft_in_section(self) -> "IntakeTurnRequest":
        if self.draft is not None and self.draft.section != self.section:
            raise ValueError("The draft belongs to another section")
        return self


class IntakeReply(BaseModel):
    """What the model must answer, checked whole: its next line to the
    student, the full draft, and whether it has nothing more to ask."""

    reply: str = Field(min_length=1, max_length=1000)
    draft: IntakeDraft
    done: bool = False


class DraftEvent(BaseModel):
    """The NDJSON line after the reply: the whole draft, to replace the card."""

    type: Literal["draft"] = "draft"
    draft: IntakeDraft
    done: bool
