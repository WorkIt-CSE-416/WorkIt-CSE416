"""Reading ashby company job boards: its reader and its record."""

from __future__ import annotations

import re

from workit_scraper import details
from workit_scraper.providers import fetch
from workit_scraper.providers.fetch import _iso
from workit_scraper.providers.model import Job, Provider
from workit_scraper.providers.registry import listing_url
from workit_scraper.providers.text import (
    _described,
    _page,
    _work_style,
)


def _ashby_pay(row: dict) -> details.Pay | None:
    for part in (row.get("compensation") or {}).get("summaryComponents") or []:
        if part.get("compensationType") == "Salary":
            return details.Pay.from_interval(
                part.get("currencyCode"),
                part.get("minValue"),
                part.get("maxValue"),
                part.get("interval"),
            )
    return None


def ashby(token: str, company: str) -> list[Job]:
    payload = fetch._get_json(listing_url("ashby", token))
    assert isinstance(payload, dict)
    jobs = []
    for row in payload.get("jobs") or []:
        # Ashby is the only one that tells us a posting is unlisted. Believe it.
        if not row.get("isListed", True):
            continue
        title = (row.get("title") or "").strip()
        full, roles = _described(row.get("descriptionPlain") or row.get("descriptionHtml"))
        jobs.append(
            Job(
                ats="ashby",
                token=token,
                company=company,
                external_id=str(row["id"]),
                title=title,
                apply_url=row.get("applyUrl") or row.get("jobUrl") or "",
                location=row.get("location"),
                department=row.get("department"),
                posted_at=_iso(row.get("publishedAt")),
                page=_page(
                    title,
                    full,
                    roles=roles,
                    stated_type=details.job_type_label(row.get("employmentType")),
                    # Some boards leave `workplaceType` unset but still flag `isRemote`.
                    stated_style=_work_style(
                        row.get("workplaceType") or ("Remote" if row.get("isRemote") else None),
                        row.get("location"),
                    ),
                    stated_pay=_ashby_pay(row),
                ),
            )
        )
    return jobs


PROVIDER = Provider(
    # Pay is left out of Ashby's list unless asked for.
    listing_url="https://api.ashbyhq.com/posting-api/job-board/{token}?includeCompensation=true",
    read=ashby,
    apply_link=re.compile(r"jobs\.ashbyhq\.com/([a-z0-9_.-]+)", re.I),
    logo_page="https://jobs.ashbyhq.com/{}",
    # The square mark, not `logoWordmarkImageUrl`: the card's tile is square.
    logo_pattern=re.compile(r'"logoSquareImageUrl":"(https://app\.ashbyhq\.com/api/images/[^"]+)"'),
)
