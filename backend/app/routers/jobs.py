"""
GET /jobs — the scraper's shortlist, served to the seeker feed.

Reads scraper/feed.json through app/services/job_feed.py, which Scout shares:
classification and deduplication happen in the scraper, once, and this route
only slices. It imports nothing from scraper/ — backend/CLAUDE.md keeps anything
outside backend/ out of this build.

Public on purpose: a list of public job postings says nothing about the
caller. No database session either — moving these rows into a table later
only changes job_feed.py.

Descriptions are left out of the response: the cards never show them, and at
up to 3,000 characters each they would make every feed load several times
heavier. Scout reads them from the feed directly.
"""

from fastapi import APIRouter, HTTPException, Query, status

from app.schemas.jobs import JobListing
from app.services.job_feed import read_feed

router = APIRouter(prefix="/jobs", tags=["jobs"])


@router.get(
    "",
    response_model=list[JobListing],
    response_model_exclude={"__all__": {"description"}},
)
async def list_jobs(limit: int = Query(50, ge=1, le=500)) -> list[JobListing]:
    """Newest roles first, in the order the scraper wrote them."""
    try:
        jobs = await read_feed()
    except FileNotFoundError:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="No scraped jobs yet. Run `python3 -m workit_scraper` in scraper/.",
        ) from None
    return jobs[:limit]
