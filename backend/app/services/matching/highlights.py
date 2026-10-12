"""
Pick the top 3 most informative reasons a job matches (or doesn't) a resume.
Pure functions, no DB access.
"""

from __future__ import annotations

from app.models.dto import ParsedResume


def generate_highlights(
    job_title: str,
    job_min_years: int | None,
    job_start_term: str | None,
    resume: ParsedResume,
    semantic: float | None,
    skill_overlap: float,
    title_fit: float,
    eligibility: float,
) -> list[dict]:
    """Up to 3 highlights, each ``{"text": str, "met": bool}``."""
    candidates: list[dict] = []

    # --- positive ---
    if skill_overlap > 0.1 and resume.skills:
        top_skills = ", ".join(s.skill_name for s in resume.skills[:3])
        candidates.append({"text": f"Your {top_skills} skills match this role", "met": True})

    if title_fit > 0.3:
        field = next((e.field_of_study for e in resume.education if e.field_of_study), None)
        if field:
            candidates.append({"text": f"Aligns with your {field} background", "met": True})
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

    if job_start_term and eligibility < 1.0:
        candidates.append({
            "text": f"Starts {job_start_term}",
            "met": False,
        })

    # Positive first, then negative, capped at 3
    positives = [c for c in candidates if c["met"]]
    negatives = [c for c in candidates if not c["met"]]
    return (positives + negatives)[:3]
