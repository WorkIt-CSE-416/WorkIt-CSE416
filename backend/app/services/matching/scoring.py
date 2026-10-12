"""
Score a job against a resume. Pure functions, no DB access.

Weights are guesses until tuned on real data. Each component is 0-1,
combined into a 0-100 integer.
"""

from __future__ import annotations

import re
from collections.abc import Sequence

# --- weights (tunable) ---
W_SEMANTIC = 0.45       # cosine similarity via pg_vector
W_SKILL = 0.25          # ts_rank of skills against fts
W_TITLE = 0.15          # word overlap of resume titles & job title
W_ELIGIBILITY = 0.15    # grad date vs start term, years of exp


# Per job
def compute_score(
    semantic: float | None,
    skill_overlap: float,
    title_fit: float,
    eligibility: float,
    freshness: float,
) -> int:
    """0-100 match score.

    *semantic*: 1 - cosine_distance, or None when either side has no embedding.
    *skill_overlap*: normalized ts_rank, 0-1.
    *title_fit*: word-overlap ratio, 0-1.
    *eligibility*: 0.0 to 1.0.
    *freshness*: 1.0 (today) decaying to 0.7 over 300 days.
    """
    if semantic is not None:
        weighted = (
            W_SEMANTIC * semantic
            + W_SKILL * skill_overlap
            + W_TITLE * title_fit
            + W_ELIGIBILITY * eligibility
        )
    else:
        # No embedding: redistribute semantic weight across the others
        # NOTE: For now keep this as fallback.
        print("No semantic weight")
        total = W_SKILL + W_TITLE + W_ELIGIBILITY
        weighted = (
            (W_SKILL / total) * skill_overlap
            + (W_TITLE / total) * title_fit
            + (W_ELIGIBILITY / total) * eligibility
        )
    return max(0, min(100, round(weighted * freshness * 100)))


# --- helpers ---

_WORD_RE = re.compile(r"[a-z0-9]+")


def _stem_words(text: str) -> set[str]:
    """Lowercase alphanumeric tokens — poor-man's stemming, good enough for
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
    return max(0.7, 1.0 - days_old / 300)


def eligibility(
    grad_end_date: str | None,
    start_term: str | None,
    min_years: int | None,
    years_experience: float,
) -> float:
    """0.0-1.0 multiplier.

    1.0 = eligible or unknown, 0.5 = soft mismatch, 0.0 = hard mismatch.
    """
    score = 1.0

    # Years-of-experience check
    if min_years is not None and min_years > 0:
        if years_experience < min_years * 0.5:
            return 0.0  # hard mismatch
        if years_experience < min_years:
            score = min(score, 0.5)

    return score
