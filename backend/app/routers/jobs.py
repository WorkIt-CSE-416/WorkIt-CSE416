"""
GET /jobs — the scraper's shortlist, served to the seeker feed.

Reads scraper/feed.json, which every scraper run writes from the same roles as
its own page: classification and deduplication happen there, once, and this
route only validates and slices. It imports nothing from scraper/ —
backend/CLAUDE.md keeps anything outside backend/ out of this build.

Public on purpose: a list of public job postings says nothing about the
caller. No database session either — moving these rows into a table later
only changes this file.

The file read blocks, so it goes through `asyncio.to_thread` like every other
blocking call here (routers/CLAUDE.md) — routes stay `async def`.

Descriptions are left out of the response: the cards never show them, and at
up to 3,000 characters each they would make every feed load several times
heavier. Scout reads them through `read_feed`.
"""

import asyncio

from fastapi import APIRouter, HTTPException, Query, status
from pydantic import TypeAdapter

from app.config import get_settings
from app.schemas.jobs import JobListing

router = APIRouter(prefix="/jobs", tags=["jobs"])

_FEED = TypeAdapter(list[JobListing])


async def read_feed() -> list[JobListing]:
    """Newest first, as the scraper wrote them. FileNotFoundError until it has run."""
    raw = await asyncio.to_thread(get_settings().scraper_feed.read_bytes)
    return _FEED.validate_json(raw)


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
