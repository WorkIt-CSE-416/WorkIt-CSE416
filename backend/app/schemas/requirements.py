"""Facts extracted from a public job posting, without applicant comparisons."""

from datetime import date
from typing import Literal

from pydantic import BaseModel

RequirementKind = Literal["graduation_window", "degree", "sponsorship", "citizenship", "clearance"]


class JobRequirement(BaseModel):
    kind: RequirementKind
    label: str
    evidence: str
    importance: Literal["required", "preferred", "stated"] = "stated"
    summary: str | None = None
    earliest_month: date | None = None
    latest_month: date | None = None
