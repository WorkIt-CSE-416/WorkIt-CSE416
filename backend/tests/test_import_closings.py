"""Why the feed import closed a scraped job (KAN-412): `job_postings.closed_reason`,
from the scraper's closings.json. Against real Postgres (backend/CLAUDE.md,
"Tests against real Postgres"). A wrong or missing reason sends whoever looks
for a bad close to the wrong cause, so each case is one way it could be."""

import json

import pytest
from sqlalchemy import text

from app.db import get_engine
from app.schemas.jobs import JobListing
from app.scripts.import_jobs import import_feed, read_closings

pytestmark = pytest.mark.anyio

STAYS = "https://boards.example.com/acme/1"
GONE = "https://boards.example.com/acme/2"
FILTERED = "https://boards.example.com/acme/3"


def _listing(url: str) -> JobListing:
    return JobListing(
        id=url, title="Backend Intern", company="Acme", apply_url=url,
        experience_level="student", job_type="internship", work_style="onsite", location="Austin, TX",
        posted_at="2026-10-06T02:42:06+00:00", logo_url=None, description="Build services.",
    )


async def _import(urls: list[str], closings: dict[str, str] | None = None):
    async with get_engine().begin() as conn:
        return await import_feed(conn, [_listing(url) for url in urls], closings=closings)


async def _rows() -> dict[str, tuple[str, str | None]]:
    async with get_engine().connect() as conn:
        result = await conn.execute(text("SELECT apply_url, status, closed_reason FROM job_postings"))
        return {url: (status, reason) for url, status, reason in result}


async def test_each_close_takes_the_scrapers_reason(database):
    await _import([STAYS, GONE, FILTERED])
    report = await _import([STAYS], {GONE: "gone_from_board", FILTERED: "filtered_out"})
    assert await _rows() == {
        STAYS: ("published", None),
        GONE: ("closed", "gone_from_board"),
        FILTERED: ("closed", "filtered_out"),
    }
    assert report.closed == 2
    assert report.closed_by_reason == {"gone_from_board": 1, "filtered_out": 1}


async def test_a_job_the_file_does_not_name_is_unknown(database):
    await _import([STAYS, GONE])
    report = await _import([STAYS], {FILTERED: "filtered_out"})
    assert (await _rows())[GONE] == ("closed", "unknown")
    assert report.had_closings


async def test_no_closings_file_still_closes_as_unknown(database):
    # A local run or an older feed has no closings.json; its closes are real.
    await _import([STAYS, GONE])
    report = await _import([STAYS], None)
    assert (await _rows())[GONE] == ("closed", "unknown")
    assert not report.had_closings


async def test_a_reason_this_import_does_not_know_is_unknown(database):
    # A newer scraper's reason must not fail the CHECK and roll the run back.
    await _import([STAYS, GONE])
    report = await _import([STAYS], {GONE: "expired"})
    assert (await _rows())[GONE] == ("closed", "unknown")
    assert report.strange_reasons == {"expired"}


async def test_a_job_that_comes_back_has_no_reason(database):
    await _import([STAYS, GONE])
    await _import([STAYS], {GONE: "board_gone"})
    await _import([STAYS, GONE])
    assert (await _rows())[GONE] == ("published", None)


async def test_a_closed_job_keeps_the_reason_it_closed_with(database):
    # The next run's file may say something else; only a close writes it.
    await _import([STAYS, GONE])
    await _import([STAYS], {GONE: "board_gone"})
    await _import([STAYS], {GONE: "replaced"})
    assert (await _rows())[GONE] == ("closed", "board_gone")


async def test_the_database_refuses_a_misspelled_reason(database):
    await _import([STAYS])
    with pytest.raises(Exception, match="job_postings_closed_reason"):
        async with get_engine().begin() as conn:
            await conn.execute(text("UPDATE job_postings SET closed_reason = 'gone'"))


def test_read_closings(tmp_path):
    path = tmp_path / "closings.json"
    assert read_closings(path) is None
    path.write_text(json.dumps({GONE: "board_gone"}), encoding="utf-8")
    assert read_closings(path) == {GONE: "board_gone"}
    path.write_text("[1, 2]", encoding="utf-8")
    assert read_closings(path) is None
    path.write_text("{not json", encoding="utf-8")
    assert read_closings(path) is None
