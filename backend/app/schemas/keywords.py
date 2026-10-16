"""Shapes for a job posting's keywords and a built resume's keyword match (KAN-215)."""

from typing import Literal
from uuid import UUID

from pydantic import BaseModel


class Keyword(BaseModel):
    keyword: str
    kind: Literal["required", "preferred"]


class KeywordReading(BaseModel):
    """The model's reply. More than 20, repeats and blanks are trimmed after
    the check (services/keywords.py), not rejected."""

    keywords: list[Keyword]


class KeywordMatchResponse(BaseModel):
    """The keyword match: len(matched) of len(matched) + len(missing), as
    "12 of 18". Required keywords come first in each list. `uses_left` is
    today's Tailor uses; only an extraction (a posting seen for the first
    time, or whose description changed) spends one."""

    job_posting_id: UUID
    matched: list[Keyword]
    missing: list[Keyword]
    uses_left: int
