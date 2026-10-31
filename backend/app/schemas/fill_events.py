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


class FillEventStored(BaseModel):
    id: str


class ErrorCount(BaseModel):
    name: str
    count: int


class FillHealthRow(BaseModel):
    """One job system on one day (UTC): its fills, the share with no failed field, the share of fields left
    needing the student, and its most common error names."""

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
