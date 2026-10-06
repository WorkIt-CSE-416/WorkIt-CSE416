"""
scraper/feed.json, read and validated: the one place the API loads it.

GET /jobs serves it and Scout looks jobs up in it, so both read it here rather
than each parsing the file its own way. It is data, read at request time;
nothing from scraper/ is imported (backend/CLAUDE.md).

The file read blocks, so it goes through `asyncio.to_thread` like every other
blocking call in this API.
"""

import asyncio
from pathlib import Path

from pydantic import TypeAdapter

from app.config import get_settings
from app.schemas.jobs import JobListing

_FEED = TypeAdapter(list[JobListing])

# The parsed feed and the file version it came from. The scraper rewrites the
# file at most a few times a day, and with descriptions it runs to megabytes, so
# re-parsing it on every feed load would be the slowest part of GET /jobs.
_cache: tuple[tuple[Path, int, int], list[JobListing]] | None = None


def _read(path: Path) -> list[JobListing]:
    global _cache
    stat = path.stat()
    version = (path, stat.st_mtime_ns, stat.st_size)
    if _cache is None or _cache[0] != version:
        _cache = (version, _FEED.validate_json(path.read_bytes()))
    return _cache[1]


async def read_feed() -> list[JobListing]:
    """Newest first, as the scraper wrote them. FileNotFoundError until it has run."""
    return await asyncio.to_thread(_read, get_settings().scraper_feed)


async def find_job(job_id: str) -> JobListing | None:
    """The feed's role with this id (its apply URL), or None — including when
    there is no feed yet, since "that job is gone" is the honest answer either way."""
    try:
        jobs = await read_feed()
    except FileNotFoundError:
        return None
    return next((job for job in jobs if job.id == job_id), None)
