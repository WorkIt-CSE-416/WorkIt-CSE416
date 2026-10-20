"""
Pick the top 3 most informative reasons a job matches (or doesn't) an
applicant's experience bank. Pure functions, no DB access.
"""

from __future__ import annotations

from collections.abc import Sequence


def generate_highlights(
    job_title: str,
    job_min_years: int | None,
    job_start_term: str | None,
    skills: Sequence[str],
    field_of_study: str | None,
    semantic: float | None,
    skill_overlap: float,
    title_fit: float,
    eligibility: float,
    *,
    matched_skills: Sequence[str] = (),
    has_titles: bool = False,
) -> list[dict]:
    """Up to 3 highlights, each ``{"text": str, "met": bool}``.

    `has_titles`: the bank has Experience titles or a field of study for the
    title check to compare, so a low title fit is a finding, not a blank.
    """
    candidates: list[dict] = []

    # --- positive ---
    if matched_skills:
        top_skills = ", ".join(matched_skills[:3])
        candidates.append({"text": f"Posting mentions your skills: {top_skills}", "met": True})

    if title_fit > 0.3:
        if field_of_study:
            candidates.append({"text": f"Aligns with your {field_of_study} background", "met": True})
        else:
            candidates.append({"text": "Aligns with your experience", "met": True})

    if semantic is not None and semantic > 0.6:
        candidates.append({"text": "Strong overall fit with your experience", "met": True})

    # --- negative ---
    if job_min_years is not None and eligibility < 1.0:
        candidates.append({
            "text": f"Asks for {job_min_years}+ years experience",
            "met": False,
        })

    # Start-term highlight omitted until eligibility() compares grad date
    # vs start term (matching/CLAUDE.md "Still open"). Without that check,
    # this would fire on years-of-experience mismatches and mislead.

    # --- a weak match's caveats ---
    # A job none of the rules above speak for would show its score with no
    # reasons (KAN-256). Say what the score found missing instead. Neither
    # names a skill the job wants, which needs each job's own skill list
    # (matching/CLAUDE.md): they say only what of the bank the posting lacks.
    if not candidates:
        if skills and not matched_skills:
            candidates.append({"text": "None of your skills appear in this posting", "met": False})
        if has_titles and title_fit <= 0.3:
            candidates.append({"text": "Title isn't close to your past roles", "met": False})

    # Positive first, then negative, capped at 3
    positives = [c for c in candidates if c["met"]]
    negatives = [c for c in candidates if not c["met"]]
    return positives[:max(0, 3 - len(negatives))] + negatives[:3]
