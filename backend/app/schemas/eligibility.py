"""
Evidence-backed job requirements and informational comparisons, never gates.
Users eligibility checklist
"""

from datetime import date
from typing import Literal

from pydantic import BaseModel, Field

RequirementKind = Literal["graduation_window", "degree", "sponsorship"]

class EligibilityFact(BaseModel):
    kind: RequirementKind
    label: str
    evidence: str | None = None
    importance: Literal["required", "preferred", "stated"] = "stated"

# What posting says: info found in the posting, including its exact wording as evidence
# Currently three kinds: graduation_window, degree, spoonsorship
class EligibilityRequirement(EligibilityFact):
    # Extracted requirements must have src evidence
    evidence: str
    earliest_month: date | None = None
    latest_month: date | None = None
    degree_levels: list[str] = Field(default_factory=list)

# contains the student's degree and graduation information
class Education(BaseModel):
    degree: str | None = None
    field_of_study: str | None = None
    end_month: date | None = None
    end_kind: str | None = None

# UI after comparison: adds comparison status and explanation to requirement
class EligibilityItem(EligibilityFact):
    status: Literal["matches", "potential_mismatch", "needs_confirmation", "not_stated"]
    explanation: str

class EligibilityChecklist(BaseModel):
    items: list[EligibilityItem]
    description_available: bool
