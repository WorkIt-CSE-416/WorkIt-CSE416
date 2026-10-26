"""POST /fill-reports (KAN-403): the only shape a problem report may have.
Every model forbids other keys, so an answer, a reason or the page's text
is refused (422), never stored."""

from typing import Literal
from urllib.parse import urlsplit

from pydantic import BaseModel, ConfigDict, Field, field_validator

# The extension's error names (autofiller_extension/src/content/report.js ERRORS).
ErrorName = Literal["Readback", "FillError", "Handoff", "NoForm", "NoAnswer", "Error"]


class FillReportField(BaseModel):
    """One failed field: its kind, its label's shape (lower-case letters, # for digits, spaces), its error's name."""

    model_config = ConfigDict(extra="forbid")

    kind: str = Field(pattern=r"^[a-z_-]{1,24}$")
    label_shape: str = Field(max_length=120)
    error: ErrorName

    @field_validator("label_shape")
    @classmethod
    def _shape_only(cls, value: str) -> str:
        if not all(c.isalpha() or c in "# " for c in value):
            raise ValueError("a label shape holds only letters, # and spaces")
        return value


class FillReportRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    job_system: str = Field(pattern=r"^[a-z_]{1,24}$")
    posting_url: str = Field(max_length=2000)
    engine_version: str = Field(pattern=r"^[\w.+-]{1,64}$")
    fields: list[FillReportField] = Field(max_length=200)
    note: str | None = Field(default=None, max_length=1000)

    @field_validator("posting_url")
    @classmethod
    def _public_link(cls, value: str) -> str:
        parts = urlsplit(value)
        if parts.scheme != "https" or not parts.netloc or parts.query or parts.fragment or "@" in parts.netloc:
            raise ValueError("the posting's link, https with no query or fragment")
        return value


class FillReportStored(BaseModel):
    id: str
