"""Reading lever company job boards: its reader and its record."""

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
    plain_text,
    title_name,
)


def _lever_pay(row: dict) -> details.Pay | None:
    salary = row.get("salaryRange") or {}
    return details.Pay.from_interval(
        salary.get("currency"), salary.get("min"), salary.get("max"), salary.get("interval")
    )


def lever(token: str, company: str) -> list[Job]:
    # The odd one out: a bare JSON array, `text` for the title, and `createdAt` as
    # epoch milliseconds in a string.
    payload = fetch._get_json(listing_url("lever", token))
    assert isinstance(payload, list)
    jobs = []
    for row in payload:
        categories = row.get("categories") or {}
        title = (row.get("text") or "").strip()
        full, roles = _described(_lever_markup(row))
        jobs.append(
            Job(
                ats="lever",
                token=token,
                company=company,
                external_id=str(row["id"]),
                title=title,
                apply_url=row.get("hostedUrl") or row.get("applyUrl") or "",
                location=categories.get("location"),
                department=categories.get("team"),
                posted_at=_iso(row.get("createdAt")),
                page=_page(
                    title,
                    full,
                    roles=roles,
                    stated_type=details.job_type_label(categories.get("commitment")),
                    # Some boards put the work model in `commitment` ("Remote").
                    stated_style=_work_style(row.get("workplaceType"), categories.get("location"))
                    or _work_style(categories.get("commitment"), None),
                    stated_pay=_lever_pay(row),
                ),
            )
        )
    return jobs


def _lever_markup(row: dict) -> str:
    """Lever splits a posting in three: an intro (`descriptionPlain`), titled lists
    that usually hold the requirements (`lists`, HTML items), and a closing
    (`additionalPlain`). The intro alone is often just a company blurb. A list's
    title is its heading, so it is marked as one."""
    sections = [row.get("descriptionPlain") or ""]
    for block in row.get("lists") or []:
        sections.append(f"<h3>{block.get('text') or ''}</h3><ul>{block.get('content') or ''}</ul>")
    sections.append(row.get("additionalPlain") or "")
    return "<br>".join(section for section in sections if section)


def _lever_description(row: dict) -> str | None:
    """A Lever posting's whole text (`_lever_markup`)."""
    return plain_text(_lever_markup(row))


PROVIDER = Provider(
    # `api` and `site` are Lever's US hosts, or its EU ones for an "eu/{slug}"
    # token (`registry._parts`). Its EU boards (jobs.eu.lever.co: Quantinuum,
    # Cirrus) went unread until 2026-10-27: the pattern missed the `.eu.`, as
    # Greenhouse's once did.
    listing_url="https://{api}/v0/postings/{slug}?mode=json",
    read=lever,
    apply_link=re.compile(r"jobs\.(?:(eu)\.)?lever\.co/([a-z0-9_.-]+)", re.I),
    logo_page="https://{site}/{slug}",
    # The header logo, not `og:image` -- Lever's is a 1200x630 banner with a
    # tagline. Older uploads use the bucket's dash host, `s3-us-west-2` (Daniels
    # Health).
    logo_pattern=re.compile(
        r'class="main-header-logo"[^>]*>\s*<img[^>]*\ssrc="'
        r'(https://lever-client-logos\.s3(?:[.-]us-west-2)?\.amazonaws\.com/[^"]+)"'
    ),
    # The board page's title is the company's name alone ("Palantir Technologies").
    name_url="https://{site}/{slug}",
    read_name=title_name,
)
