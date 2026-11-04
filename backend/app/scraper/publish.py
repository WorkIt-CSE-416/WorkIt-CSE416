"""Build JobListing rows from observations and publish through import_jobs.

Bridges observations → the existing import_feed pipeline, so scraped jobs
enter job_postings with locations, roles and keyword caches intact.
"""

from __future__ import annotations

from app.schemas.jobs import JobListing
from app.scraper.observations import get_closings, get_listed

# The same work_style mapping as feed.py.
_WORK_STYLE = {"Remote": "remote", "Hybrid": "hybrid", "On site": "onsite"}


def observation_to_listing(obs) -> JobListing:
    """Turn a scraper_observations row into a JobListing the import understands."""
    facts = obs.facts or {}
    meta = obs.metadata_ if hasattr(obs, "metadata_") else (obs.metadata or {})

    pay = facts.get("pay") or {}

    return JobListing(
        id=str(obs.id),
        title=obs.title,
        company=obs.company,
        apply_url=obs.apply_url,
        experience_level=_experience_level(facts),
        work_style=_WORK_STYLE.get(facts.get("work_style")),
        location=obs.location,
        location_label=None,
        posted_at=obs.posted_at.isoformat() if obs.posted_at else None,
        logo_url=None,
        company_domain=meta.get("company_domain"),
        description=obs.description,
        job_type=_job_type(facts),
        salary=None,
        salary_min=pay.get("low"),
        salary_max=pay.get("high"),
        salary_currency=pay.get("currency"),
        salary_period=pay.get("period"),
        min_years_experience=facts.get("min_years"),
        start_term=facts.get("start_term"),
        sponsorship=facts.get("sponsorship"),
    )


async def build_listings(conn, schedule_id) -> list[JobListing]:
    """Listed observations → JobListing objects ready for import_feed."""
    rows = await get_listed(conn, schedule_id)
    return [observation_to_listing(r) for r in rows]


async def build_closings(conn, schedule_id) -> dict[str, str]:
    """Observations gone from the board → {apply_url: reason} for _close_missing."""
    rows = await get_closings(conn, schedule_id)
    return {r.apply_url: "gone_from_board" for r in rows}


def _experience_level(facts: dict) -> str | None:
    """Map facts to the feed's experience_level values."""
    jt = facts.get("job_type")
    if jt == "internship":
        return "student"
    return "new_grad"


def _job_type(facts: dict) -> str | None:
    """Map facts to the feed's job_type values."""
    jt = facts.get("job_type")
    if jt == "internship":
        return "internship"
    return jt
