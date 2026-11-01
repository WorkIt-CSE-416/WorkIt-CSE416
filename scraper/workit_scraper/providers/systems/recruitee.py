"""Reading recruitee company job boards: its reader and its record."""

from __future__ import annotations

import re

from workit_scraper import details
from workit_scraper.providers import fetch
from workit_scraper.providers.fetch import _iso
from workit_scraper.providers.model import Job, Provider
from workit_scraper.providers.registry import listing_url
from workit_scraper.providers.text import (
    _listing_page,
    _places,
)


def recruitee(token: str, company: str) -> list[Job]:
    payload = fetch._get_json(listing_url("recruitee", token))
    assert isinstance(payload, dict)
    jobs = []
    for row in payload.get("offers") or []:
        title = (row.get("title") or "").strip()
        markup = "<br>".join(row.get(field) or "" for field in ("description", "requirements"))
        shortlist_tags, page = _listing_page(
            title,
            markup,
            stated_type=details.job_type_label(row.get("employment_type_code")),
            stated_style=_recruitee_work_style(row),
            stated_pay=_recruitee_pay(row),
        )
        jobs.append(
            Job(
                ats="recruitee",
                token=token,
                company=company,
                external_id=str(row["id"]),
                title=title,
                apply_url=row.get("careers_url") or "",
                location=_recruitee_location(row),
                department=row.get("department") or None,
                posted_at=_iso(row.get("published_at") or row.get("created_at")),
                shortlist_tags=shortlist_tags,
                page=page,
            )
        )
    return jobs


def _recruitee_location(row: dict) -> str | None:
    """The place names the employer typed. The split fields beside each are a
    form's defaults -- Hard Rock Digital's "United States" has the city "United
    States" in Florida -- and `location` is only "Remote job" on a remote posting."""
    named = _places(place.get("name") for place in row.get("locations") or [])
    return named or ("Remote" if row.get("remote") else row.get("location") or None)


def _recruitee_work_style(row: dict) -> str | None:
    """Three flags, and a posting can set two: 5 of Hard Rock Digital's 58 are
    remote and hybrid. One that can be done remotely is what someone filtering
    for remote work wants, so remote wins."""
    if row.get("remote"):
        return "Remote"
    if row.get("hybrid"):
        return "Hybrid"
    if row.get("on_site"):
        return "On site"
    return None


def _recruitee_pay(row: dict) -> details.Pay | None:
    # Amounts arrive as strings ("1000"), per Recruitee's API reference.
    salary = row.get("salary") or {}
    return details.Pay.from_interval(
        salary.get("currency"),
        _number(salary.get("min")),
        _number(salary.get("max")),
        salary.get("period"),
    )


def _number(value: object) -> float | None:
    try:
        return float(value) if isinstance(value, int | float | str) else None
    except ValueError:
        return None


PROVIDER = Provider(
    # Recruitee and BambooHR give each company its own subdomain, so its own
    # origin and robots.txt; `polite` still paces each provider as one host.
    listing_url="https://{token}.recruitee.com/api/offers/",
    read=recruitee,
    # One subdomain per company: {company}.recruitee.com/o/{offer}. `www` is
    # the vendor's own site.
    apply_link=re.compile(r"//(?!www\.)([a-z0-9-]+)\.recruitee\.com", re.I),
    subdomains="recruitee.com",
    # No logo yet: it sits inside a 1 MB board page, for the one board we read.
    # Its cards show initials.
)
