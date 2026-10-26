"""Reading rippling company job boards: its reader, its page reader and its record."""

from __future__ import annotations

import re
from collections.abc import Iterable
from dataclasses import replace

from workit_scraper import details
from workit_scraper.providers import fetch
from workit_scraper.providers.fetch import _iso
from workit_scraper.providers.model import Job, Provider, TooLarge
from workit_scraper.providers.registry import job_url, listing_url
from workit_scraper.providers.text import (
    _described,
    _page,
    _places,
    _work_style,
)


def rippling(token: str, company: str) -> list[Job]:
    """A Rippling board, in one request: the list its careers page reads, asked for
    the page size its own client caps at (1,000). A board past one page is not read
    (`TooLarge`): a partial list would be evidence of nothing."""
    payload = fetch._get_json(listing_url("rippling", token))
    assert isinstance(payload, dict)
    if (payload.get("totalPages") or 1) > 1:
        raise TooLarge(f"{payload.get('totalItems'):,} postings")
    # Like Workable's widget, the list has a job once per office, under one id
    # (Kraken Robotics' internships: Mount Pearl and Dartmouth).
    rows: dict[str, list[dict]] = {}
    for row in payload.get("items") or []:
        rows.setdefault(str(row["id"]), []).append(row)
    jobs = []
    for job_id, copies in rows.items():
        first = copies[0]
        offices = [place for row in copies for place in row.get("locations") or []]
        jobs.append(
            Job(
                ats="rippling",
                token=token,
                company=company,
                external_id=job_id,
                title=(first.get("name") or "").strip(),
                apply_url=first.get("url") or "",
                location=_places(place.get("name") for place in offices),
                department=(first.get("department") or {}).get("name"),
                # No date and no page: its own record has both (`describe_rippling`).
                work_style=_rippling_work_style(place.get("workplaceType") for place in offices),
            )
        )
    return jobs


def _rippling_work_style(kinds: Iterable[object]) -> str | None:
    """`REMOTE`, `HYBRID` or `ON_SITE` for each office. A job that may be done
    remotely in any of them is remote, as on Recruitee, then hybrid."""
    styles = {_work_style(kind, None) for kind in kinds}
    return next((style for style in ("Remote", "Hybrid", "On site") if style in styles), None)


def describe_rippling(job: Job) -> Job:
    """The same Rippling posting with what only its own record says: the
    description (the company's part, then the role's, as its page shows them),
    the date it went up, its employment type and its pay ranges."""
    payload = fetch._get_json(job_url("rippling", job.token, job.external_id))
    assert isinstance(payload, dict)
    text = payload.get("description") or {}
    full, roles = _described("".join(text.get(part) or "" for part in ("company", "role")))
    return replace(
        job,
        posted_at=_iso(payload.get("createdOn")) or job.posted_at,
        page=_page(
            job.title,
            full,
            roles=roles,
            stated_type=details.job_type_label((payload.get("employmentType") or {}).get("id")),
            stated_style=job.work_style or _work_style(None, job.location),
            stated_pay=_rippling_pay(payload.get("payRangeDetails") or []),
        ),
    )


def _rippling_pay(ranges: list[dict]) -> details.Pay | None:
    """One range per office; the card's is the widest, when all share a currency
    and a period (Tavern Research's "USD", "YEAR")."""
    kinds = {(r.get("currency"), str(r.get("frequency") or "").lower()) for r in ranges}
    if len(kinds) != 1:
        return None
    currency, period = kinds.pop()
    amounts = [a for r in ranges for a in (r.get("rangeStart"), r.get("rangeEnd"))]
    if not all(isinstance(a, int | float) for a in amounts):
        return None
    return details.Pay.from_interval(currency, min(amounts), max(amounts), period)


PROVIDER = Provider(
    # What a Rippling careers page itself reads (`/api/v2/board/...`), not a
    # documented public API (an accepted risk, like Workday's). Its robots.txt
    # disallows only `/internal/` (2026-10-26).
    listing_url="https://ats.rippling.com/api/v2/board/{token}/jobs?page=0&pageSize=1000",
    read=rippling,
    # ats.rippling.com/{locale}/{board}/jobs/{id}. The locale ("en-GB") is
    # optional, so it is skipped only when a board and `/jobs` follow it.
    apply_link=re.compile(r"ats\.rippling\.com/(?:[a-z]{2}-[a-z]{2}/)?([a-z0-9_-]+)/jobs", re.I),
    # The list has the title, offices and work model; the description, date,
    # employment type and pay are on the posting's own record.
    job_url="https://ats.rippling.com/api/v2/board/{token}/jobs/{job_id}",
    describe=describe_rippling,
    # No logo: the board's is a signed URL that expires, so a stored one would
    # break. Its cards show initials.
)
