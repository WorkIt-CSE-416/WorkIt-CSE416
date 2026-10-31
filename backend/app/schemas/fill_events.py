"""The fill event's shapes (KAN-476): POST /fill-events takes only
FillEventRequest. Every part is a version, a job system's name, a count or an
error name from the extension's own list, so no value the student typed can
ride along (any other key or text is 422). The rest are GET
/admin/fill-health's answer (routers/fill_events.py)."""

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.fill_reports import ErrorName

Count = Field(ge=0, le=10_000)


class FillEventRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    job_system: str = Field(pattern=r"^[a-z][a-z0-9_-]{0,23}$")
    # A git describe ("v0.3.2-105-gfcaaf20") or a version number: letters, digits and . _ + -.
    engine_version: str = Field(pattern=r"^[A-Za-z0-9._+-]{1,64}$")
    extension_version: str = Field(pattern=r"^[0-9]{1,5}(\.[0-9]{1,5}){0,3}$")
    mode: Literal["single", "batch"]
    fields: int = Count
    filled: int = Count
    guessed: int = Count
    needs_you: int = Count
    failed: int = Count
    errors: dict[ErrorName, int] = Field(default_factory=dict)
    # At most an hour: a Workday walk or a page left open is still one fill.
    duration_ms: int = Field(ge=0, le=3_600_000)
    # Workday's one event per step: the step's number and whether it is the last (KAN-476).
    # Left out on a single-page fill.
    step: int | None = Field(default=None, ge=0, le=100)
    final_step: bool | None = Field(default=None, strict=True)
    # Fields left blank because their category is switched off: not counted in needs_you.
    skipped_by_choice: int = Field(default=0, ge=0, le=10_000)


class FillEventStored(BaseModel):
    id: str


class ErrorCount(BaseModel):
    name: str
    count: int


class FillHealthRow(BaseModel):
    """One job system on one day (UTC): its fills (a Workday walk once, at its final step), the share of
    pages (events; a Workday step is one) with no failed field, the share of fields left needing the
    student (fields skipped by choice left out), and its most common error names."""

    day: str
    job_system: str
    fills: int
    clean_share: float
    needs_you_rate: float
    top_errors: list[ErrorCount]


class FillHealth(BaseModel):
    rows: list[FillHealthRow]
    # Every engine version the period's events name, newest first: the page's filter.
    engine_versions: list[str]
