"""
Load the scraper's feed.json into job_postings and job_locations.

    uv run python -m app.scripts.import_jobs                  the default feed
    uv run python -m app.scripts.import_jobs path/to/feed.json
    uv run python -m app.scripts.import_jobs --dry-run        do it all, then roll back

The default feed is the one GET /jobs reads: scraper/feed.json when a local
scraper run has written one, else data/feed.json (app/config.py).

A job is known by its apply_url, which the scraper dedupes on and the table
holds unique. One run, in one transaction:

1. validates every row against schemas/jobs.py (the feed's contract);
2. resolves each distinct location string (services/location_resolver.py)
   against the countries and states in the database;
3. inserts new jobs and updates changed ones, description included,
   ON CONFLICT (apply_url). A row
   whose fields all match is left alone, so updated_at means something and a
   second run on the same feed changes nothing;
4. brings each job's job_locations rows in line with what the resolver says;
5. closes scraped jobs no longer in the feed. The scraper drops a job only
   after reading its board in full without it (scraper/CLAUDE.md), so absence
   is evidence. A job that comes back is published again.

Step 5 refuses to close more than half the published scraped jobs at once, and
the whole run rolls back: a broken scrape mustn't empty the site. Pass
--allow-mass-close when that many really did go.

Company-posted jobs (company_id set) are never read or written here.
"""

import argparse
import asyncio
import datetime
import sys
from collections.abc import Iterable
from dataclasses import dataclass, field
from pathlib import Path

from pydantic import TypeAdapter, ValidationError
from sqlalchemy import (
    Text,
    all_,
    and_,
    any_,
    delete,
    func,
    literal,
    literal_column,
    or_,
    select,
    update,
)
from sqlalchemy.dialects.postgresql import ARRAY, insert
from sqlalchemy.ext.asyncio import AsyncConnection

from app.config import get_settings
from app.db import get_engine
from app.models import dto
from app.models.jobs import Job_Location, Job_Post
from app.models.locations import Country, State
from app.schemas.jobs import JobListing
from app.services.location_resolver import LocationResolver, Place

_FEED = TypeAdapter(list[JobListing])
_jobs = Job_Post.__table__
_locations = Job_Location.__table__

# The columns the feed owns, compared to decide whether a known job changed.
_FEED_COLUMNS = (
    "title", "company_name", "company_logo_url", "description",
    "experience_level", "work_style", "location_raw", "posted_at",
)
# asyncpg allows 32,767 parameters a statement; a row here binds 10.
_CHUNK = 1000
# Closing more than this share of the published scraped jobs in one run is
# refused without --allow-mass-close.
_MASS_CLOSE_SHARE = 0.5
# ...unless there are this few, as on a first import or a test database.
_MASS_CLOSE_FLOOR = 20


class ImportRefused(Exception):
    '''
    the run would do something it shouldn't do unasked; nothing was written
    '''


@dataclass
class Prepared:
    '''
    the feed as database rows, before any database is involved
    '''
    rows: list[dict]
    places: dict[str, tuple[Place, ...]]
    # location text -> the pieces of it that matched nothing
    unresolved: dict[str, tuple[str, ...]] = field(default_factory=dict)
    no_place: int = 0
    duplicates: int = 0


@dataclass
class Report:
    feed_rows: int = 0
    inserted: int = 0
    updated: int = 0
    unchanged: int = 0
    closed: int = 0
    locations_changed: int = 0
    duplicates: int = 0
    no_place: int = 0
    unresolved: dict[str, tuple[str, ...]] = field(default_factory=dict)


def parse_posted_at(value: str | None) -> datetime.datetime | None:
    '''
    the feed's ISO timestamp; a value without a zone is UTC, and one that
    doesn't parse is dropped rather than failing the run
    '''
    if not value:
        return None
    try:
        parsed = datetime.datetime.fromisoformat(value)
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=datetime.UTC)


def prepare(listings: Iterable[JobListing], resolver: LocationResolver) -> Prepared:
    '''
    one row per apply_url (the first wins: the feed is newest first), with its
    places. Each distinct location string is resolved once.
    '''
    rows: list[dict] = []
    places: dict[str, tuple[Place, ...]] = {}
    resolved: dict[str | None, tuple[Place, ...]] = {}
    unresolved: dict[str, tuple[str, ...]] = {}
    no_place = duplicates = 0

    for listing in listings:
        if listing.apply_url in places:
            duplicates += 1
            continue
        if listing.location not in resolved:
            result = resolver.resolve(listing.location)
            resolved[listing.location] = result.places
            if result.unresolved and not result.places:
                unresolved[listing.location] = result.unresolved
        found = resolved[listing.location]
        if not found:
            no_place += 1
        places[listing.apply_url] = found
        rows.append({
            "apply_url": listing.apply_url,
            "title": listing.title,
            "company_name": listing.company,
            "company_logo_url": listing.logo_url,
            # Scout reads it; the job cards don't. Absent from feeds written
            # before the scraper captured descriptions.
            "description": listing.description,
            "experience_level": dto.experience_level(listing.experience_level),
            "work_style": listing.work_style,
            "location_raw": listing.location,
            "posted_at": parse_posted_at(listing.posted_at),
            "status": dto.job_post_status.published,
        })
    return Prepared(rows, places, unresolved, no_place, duplicates)


def _text_array(values: list[str]):
    # One array parameter rather than one parameter per value, so the feed's
    # size never meets asyncpg's parameter limit.
    return literal(values, type_=ARRAY(Text))


async def _upsert(conn: AsyncConnection, rows: list[dict], report: Report) -> None:
    for start in range(0, len(rows), _CHUNK):
        stmt = insert(_jobs).values(rows[start:start + _CHUNK])
        changed = or_(
            _jobs.c.status != dto.job_post_status.published,
            *(_jobs.c[col].is_distinct_from(stmt.excluded[col]) for col in _FEED_COLUMNS),
        )
        stmt = stmt.on_conflict_do_update(
            index_elements=[_jobs.c.apply_url],
            set_={
                **{col: stmt.excluded[col] for col in _FEED_COLUMNS},
                "status": dto.job_post_status.published,
                # A job closed by an earlier run and back in the feed is open
                # again, so the date it closed no longer applies.
                "closes_at": None,
                "updated_at": func.now(),
            },
            # Never touch a company's job, and leave an unchanged one alone.
            where=and_(_jobs.c.company_id.is_(None), changed),
        ).returning(literal_column("xmax = 0").label("inserted"))
        for row in await conn.execute(stmt):
            if row.inserted:
                report.inserted += 1
            else:
                report.updated += 1
    report.unchanged = len(rows) - report.inserted - report.updated


async def _sync_locations(conn: AsyncConnection, places: dict[str, tuple[Place, ...]], report: Report) -> None:
    urls = list(places)
    ids = {
        row.apply_url: row.id
        for row in await conn.execute(
            select(_jobs.c.id, _jobs.c.apply_url).where(
                _jobs.c.company_id.is_(None), _jobs.c.apply_url == any_(_text_array(urls))
            )
        )
    }
    existing: dict = {}
    for row in await conn.execute(
        select(_locations.c.id, _locations.c.job_id, _locations.c.country, _locations.c.state).where(
            _locations.c.job_id.in_(select(_jobs.c.id).where(_jobs.c.apply_url == any_(_text_array(urls))))
        )
    ):
        existing.setdefault(row.job_id, {})[Place(row.country, row.state)] = row.id

    stale: list = []
    fresh: list[dict] = []
    for url, wanted in places.items():
        job_id = ids.get(url)
        if job_id is None:
            continue
        have = existing.get(job_id, {})
        gone = [loc_id for place, loc_id in have.items() if place not in wanted]
        new = [p for p in wanted if p not in have]
        if gone or new:
            report.locations_changed += 1
            stale.extend(gone)
            fresh.extend({"job_id": job_id, "country": p.country, "state": p.state} for p in new)

    if stale:
        await conn.execute(delete(_locations).where(_locations.c.id.in_(stale)))
    for start in range(0, len(fresh), _CHUNK * 2):
        await conn.execute(insert(_locations).values(fresh[start:start + _CHUNK * 2]))


async def _close_missing(conn: AsyncConnection, urls: list[str], report: Report, *, allow_mass_close: bool) -> None:
    published_scraped = and_(
        _jobs.c.company_id.is_(None), _jobs.c.status == dto.job_post_status.published
    )
    missing = and_(published_scraped, _jobs.c.apply_url != all_(_text_array(urls)))

    published = await conn.scalar(select(func.count()).where(published_scraped))
    to_close = await conn.scalar(select(func.count()).where(missing))
    if (
        not allow_mass_close
        and published > _MASS_CLOSE_FLOOR
        and to_close > _MASS_CLOSE_SHARE * published
    ):
        raise ImportRefused(
            f"This feed would close {to_close} of {published} published scraped jobs. "
            "That looks like a broken scrape; nothing was written. "
            "Re-run with --allow-mass-close if they really are gone."
        )

    now = func.now()
    result = await conn.execute(
        update(_jobs).where(missing).values(
            status=dto.job_post_status.closed,
            closes_at=func.least(func.coalesce(_jobs.c.closes_at, now), now),
            updated_at=now,
        )
    )
    report.closed = result.rowcount


async def import_feed(
    conn: AsyncConnection, listings: list[JobListing], *, allow_mass_close: bool = False
) -> Report:
    '''
    the whole import, on a connection whose transaction the caller owns
    '''
    if not listings:
        raise ImportRefused("The feed is empty; nothing was written.")

    countries = set((await conn.scalars(select(Country.code))).all())
    states = {row.code: row.name for row in await conn.execute(select(State.code, State.name))}
    # Reading the 3 MB gazetteer blocks; off the event loop like every other
    # blocking call here.
    resolver = await asyncio.to_thread(LocationResolver, countries, states)
    prepared = prepare(listings, resolver)

    report = Report(
        feed_rows=len(listings),
        duplicates=prepared.duplicates,
        no_place=prepared.no_place,
        unresolved=prepared.unresolved,
    )
    await _upsert(conn, prepared.rows, report)
    await _sync_locations(conn, prepared.places, report)
    await _close_missing(conn, list(prepared.places), report, allow_mass_close=allow_mass_close)
    return report


def _print_report(report: Report, *, dry_run: bool) -> None:
    print(f"{'DRY RUN, rolled back — ' if dry_run else ''}{report.feed_rows} rows in the feed")
    print(f"  inserted {report.inserted}, updated {report.updated}, unchanged {report.unchanged}")
    print(f"  closed (no longer in the feed) {report.closed}")
    print(f"  jobs whose locations changed {report.locations_changed}")
    if report.duplicates:
        print(f"  duplicate apply_urls skipped {report.duplicates}")
    print(f"  jobs naming no place {report.no_place}, of which unresolved strings:")
    for text, pieces in sorted(report.unresolved.items()):
        print(f"    {text!r}  (unknown: {', '.join(pieces)})")


async def _run(path: Path, *, dry_run: bool, allow_mass_close: bool) -> Report:
    listings = _FEED.validate_json(path.read_bytes())
    engine = get_engine()
    try:
        async with engine.connect() as conn:
            trans = await conn.begin()
            try:
                report = await import_feed(conn, listings, allow_mass_close=allow_mass_close)
            except BaseException:
                await trans.rollback()
                raise
            if dry_run:
                await trans.rollback()
            else:
                await trans.commit()
            return report
    finally:
        await engine.dispose()


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("feed", nargs="?", type=Path, help="feed.json to import (default: the one GET /jobs reads)")
    parser.add_argument("--dry-run", action="store_true", help="run every step, then roll back")
    parser.add_argument("--allow-mass-close", action="store_true", help="close however many jobs left the feed")
    args = parser.parse_args(argv)

    path = args.feed or get_settings().scraper_feed
    try:
        report = asyncio.run(_run(path, dry_run=args.dry_run, allow_mass_close=args.allow_mass_close))
    except FileNotFoundError:
        print(f"No feed at {path}. Run `python3 -m workit_scraper` in scraper/ first.", file=sys.stderr)
        return 1
    except ValidationError as exc:
        print(f"{path} doesn't match schemas/jobs.py; nothing was written.\n{exc}", file=sys.stderr)
        return 1
    except ImportRefused as exc:
        print(str(exc), file=sys.stderr)
        return 2
    _print_report(report, dry_run=args.dry_run)
    return 0


if __name__ == "__main__":
    sys.exit(main())
