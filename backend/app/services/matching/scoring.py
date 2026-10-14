"""
Score a job against a resume. Pure functions, no DB access.

Weights are guesses until tuned on real data. Each component is 0-1,
combined into a 0-100 integer.
"""

from __future__ import annotations

import logging
import re
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import date

from app.models.dto import Experience

logger = logging.getLogger(__name__)

# --- weights (tunable) ---
W_SEMANTIC = 0.45       # cosine similarity via pg_vector
W_SKILL = 0.25          # fraction of distinct resume skills mentioned in posting
W_TITLE = 0.15          # word overlap of resume titles & job title
W_ELIGIBILITY = 0.15    # stated years-of-experience requirement (not a gate)


@dataclass(frozen=True)
class ScoreComponent:
    """Points are on the 0-100 scale before freshness is applied."""

    value: float | None
    weight: float
    points: float


@dataclass(frozen=True)
class ScoreBreakdown:
    semantic: ScoreComponent
    skill_overlap: ScoreComponent
    title_fit: ScoreComponent
    eligibility: ScoreComponent
    freshness_multiplier: float
    weighted_score: float
    score_before_rounding: float
    final_score: int


def compute_breakdown(
    semantic: float | None,
    skill_overlap: float,
    title_fit: float,
    eligibility: float,
    freshness: float,
) -> ScoreBreakdown:
    """Explain the same weighted, freshness-adjusted score used for ranking.

    Semantic is cosine similarity (can be negative); other component values
    are 0-1. Missing semantic similarity redistributes its weight.
    """
    weights = (W_SEMANTIC, W_SKILL, W_TITLE, W_ELIGIBILITY)
    if semantic is None:
        logger.debug("No semantic weight")
        total = W_SKILL + W_TITLE + W_ELIGIBILITY
        weights = (0.0, W_SKILL / total, W_TITLE / total, W_ELIGIBILITY / total)
    values = (semantic, skill_overlap, title_fit, eligibility)
    components = tuple(
        ScoreComponent(value, weight, (value if value is not None else 0.0) * weight * 100)
        for value, weight in zip(values, weights, strict=True)
    )
    # Preserve the scoring operation order before converting to percentage points.
    weighted = sum((value if value is not None else 0.0) * weight
                   for value, weight in zip(values, weights, strict=True))
    adjusted = weighted * freshness * 100
    return ScoreBreakdown(
        *components,
        freshness_multiplier=freshness,
        weighted_score=weighted * 100,
        score_before_rounding=adjusted,
        final_score=max(0, min(100, round(adjusted))),
    )


def compute_score(
    semantic: float | None,
    skill_overlap: float,
    title_fit: float,
    eligibility: float,
    freshness: float,
) -> int:
    """0-100 match score, including fallback weights and freshness."""
    return compute_breakdown(semantic, skill_overlap, title_fit, eligibility, freshness).final_score


# --- helpers ---

_WORD_RE = re.compile(r"[a-z0-9]+")


def _stem_words(text: str) -> set[str]:
    """Lowercase alphanumeric tokens â€” poor-man's stemming, good enough for
    overlap of short title strings."""
    return set(_WORD_RE.findall(text.lower()))


# Filler words that inflate every title's overlap without signalling fit.
_STOP = frozenset({
    "a", "an", "the", "and", "or", "of", "in", "at", "for", "to", "is",
    "with", "on", "by", "as", "from", "i", "ii", "iii", "iv", "v",
})

# Simple overlap check
def title_fit(job_title: str, resume_titles: Sequence[str], field_of_study: str | None) -> float:
    """Word overlap between a job title and the resume's experience titles +
    field of study, as a ratio of the job title's word count (0-1)."""
    job_words = _stem_words(job_title) - _STOP
    if not job_words:
        return 0.0
    resume_words: set[str] = set()
    for t in resume_titles:
        resume_words |= _stem_words(t)
    if field_of_study:
        resume_words |= _stem_words(field_of_study)
    resume_words -= _STOP
    return len(job_words & resume_words) / len(job_words)


def freshness(days_old: float) -> float:
    """1.0 for today, decaying linearly to 0.7 over 300 days."""
    return max(0.7, 1.0 - 0.3 * max(0.0, days_old) / 300)


def experience_years(experience: Sequence[Experience], *, today: date) -> float:
    """Elapsed experience, counting ongoing roles and overlapping dates once.

    Missing end dates mean ongoing. Missing starts and reversed/future ranges
    contribute no duration; future end dates cannot add unearned experience.
    """
    intervals = sorted(
        (role.start_date, min(role.end_date or today, today))
        for role in experience
        if role.start_date is not None
        and role.start_date < min(role.end_date or today, today)
    )
    days = 0
    end = None
    for start, stop in intervals:
        if end is not None:
            start = max(start, end)
        if stop > start:
            days += (stop - start).days
        end = max(end, stop) if end is not None else stop
    return days / 365.25


def eligibility(
    grad_end_date: str | None,
    start_term: str | None,
    min_years: int | None,
    years_experience: float,
) -> float:
    """0.0-1.0 additive experience fit; does not exclude a posting.

    1.0 = meets stated years or requirement unknown, 0.5 = partial fit,
    0.0 = substantial mismatch. Graduation/start dates are not evaluated:
    a start term alone is not a graduation requirement.
    """
    score = 1.0

    # Years-of-experience check
    if min_years is not None and min_years > 0:
        if years_experience < min_years * 0.5:
            return 0.0  # hard mismatch
        if years_experience < min_years:
            score = min(score, 0.5)

    return score
