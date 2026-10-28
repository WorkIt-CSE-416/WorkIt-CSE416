"""Reading bamboohr company job boards: its reader, its page reader and its record."""

from __future__ import annotations

import re
import urllib.error
import urllib.parse
from dataclasses import replace

from workit_scraper import details
from workit_scraper.providers import fetch
from workit_scraper.providers.fetch import _iso
from workit_scraper.providers.model import BoardNotFound, Job, Provider
from workit_scraper.providers.registry import job_url, listing_url
from workit_scraper.providers.text import (
    _described,
    _page,
    _place,
)


def bamboohr(token: str, company: str) -> list[Job]:
    url = listing_url("bamboohr", token)
    try:
        payload = fetch._get_json(url)
    except urllib.error.HTTPError as error:
        # No such company: BambooHR answers with a redirect to www.bamboohr.com,
        # which `web.get` refuses as cross-origin. That is BambooHR's 404.
        if 300 <= error.code < 400:
            raise BoardNotFound(url) from error
        raise
    assert isinstance(payload, dict)
    return [
        Job(
            ats="bamboohr",
            token=token,
            company=company,
            external_id=str(row["id"]),
            title=(row.get("jobOpeningName") or "").strip(),
            apply_url=f"https://{token}.bamboohr.com/careers/{row['id']}",
            location=_bamboohr_location(row),
            department=row.get("departmentLabel") or None,
            # No date and no page: both come from its own page (`describe_bamboohr`).
        )
        for row in payload.get("result") or []
    ]


def _bamboohr_location(row: dict) -> str | None:
    """The office ("Santa Clara, California"), or for a remote job with none, the
    area it is open to (Nexthop's "US East, United States")."""
    office = row.get("location") or {}
    area = row.get("atsLocation") or {}
    return (
        _place(office.get("city"), office.get("state"))
        or _place(area.get("city"), area.get("state") or area.get("province"), area.get("country"))
        or None
    )


#: BambooHR's `locationType`. Read off postings that say which they are: Picton
#: Mahoney's "2"s are hybrid, Alkira's "1"s remote, Nexthop's Santa Clara "0"s on site.
_BAMBOOHR_STYLE = {"0": "On site", "1": "Remote", "2": "Hybrid"}


def describe_bamboohr(job: Job) -> Job:
    """The same BambooHR posting with what only its own page says: the
    description, the date it went up, the work model and the pay."""
    payload = fetch._get_json(job_url("bamboohr", job.token, job.external_id))
    assert isinstance(payload, dict)
    opening = (payload.get("result") or {}).get("jobOpening") or {}
    compensation = str(opening.get("compensation") or "")
    full, roles = _described(opening.get("description"))
    return replace(
        job,
        posted_at=_iso(opening.get("datePosted")) or job.posted_at,
        page=_page(
            job.title,
            full,
            roles=roles,
            stated_type=details.job_type_label(opening.get("employmentStatusLabel")),
            stated_style=_BAMBOOHR_STYLE.get(str(opening.get("locationType"))),
            # Free text in a field that is only ever pay ("$90,000 to $115,000",
            # "$25-$30/hour"), so it gets the label prose would need to give it.
            stated_pay=details.pay(f"Compensation: {compensation}") if compensation else None,
        ),
    )


PROVIDER = Provider(
    listing_url="https://{token}.bamboohr.com/careers/list",
    read=bamboohr,
    # One subdomain per company: {company}.bamboohr.com/careers/{id}.
    apply_link=re.compile(r"//(?!www\.)([a-z0-9-]+)\.bamboohr\.com", re.I),
    # BambooHR's list has no description, no date and no pay.
    job_url="https://{token}.bamboohr.com/careers/{job_id}/detail",
    describe=describe_bamboohr,
    subdomains="bamboohr.com",
    # The careers page carries its header logo as JSON (`poData`).
    logo_page="https://{}.bamboohr.com/careers",
    # The uploaded header logo, slashes JSON-escaped. Mostly
    # `images7.bamboohr.com`, some on the company's own subdomain or
    # `pandabox.bamboohr.com`: next.config.ts allows `*.bamboohr.com`. Served as
    # application/octet-stream, but next/image sniffs the bytes (PNGs, all 41
    # read on 2026-10-19). 36 to 120px tall, mostly wordmarks, which the card
    # letterboxes.
    logo_pattern=re.compile(r'"logo":\{[^}]*"url":"(https:\\/\\/[\w-]+\.bamboohr\.com\\/[^"]+)"'),
)
