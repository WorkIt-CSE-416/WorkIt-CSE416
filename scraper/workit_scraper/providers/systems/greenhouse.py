"""Reading greenhouse company job boards: its reader, its page reader and its record."""

from __future__ import annotations

import re
from dataclasses import replace

from workit_scraper import details
from workit_scraper.providers import fetch
from workit_scraper.providers.fetch import _iso
from workit_scraper.providers.model import Job, Provider
from workit_scraper.providers.registry import job_url, listing_url
from workit_scraper.providers.text import (
    _described,
    _page,
    _work_style,
    plain_text,
)


def greenhouse(token: str, company: str) -> list[Job]:
    payload = fetch._get_json(listing_url("greenhouse", token))
    assert isinstance(payload, dict)
    return [
        Job(
            ats="greenhouse",
            token=token,
            # Not Greenhouse's `company_name`: boards carry internal labels there
            # ("LinkedIn Job Wrapping", "DRW - University Jobs") that split one
            # company's roles apart. boards.csv names the company once.
            company=company,
            external_id=str(row["id"]),
            title=(row.get("title") or "").strip(),
            apply_url=row.get("absolute_url") or "",
            location=(row.get("location") or {}).get("name"),
            posted_at=_iso(row.get("first_published") or row.get("updated_at")),
            # No page: its own page is read once (`describe_greenhouse`).
        )
        for row in payload.get("jobs") or []
    ]


def describe_greenhouse(job: Job) -> Job:
    """The same Greenhouse posting with what only its own page says: the
    description, the offices, pay ranges and any employment-type field."""
    payload = fetch._get_json(job_url("greenhouse", job.token, job.external_id))
    assert isinstance(payload, dict)
    full, roles = _described(payload.get("content"))
    return replace(
        job,
        page=_page(
            job.title,
            full,
            roles=roles,
            stated_type=_greenhouse_job_type(payload.get("metadata") or []),
            # Greenhouse has no work-model field, but boards name one as the
            # location: Cloudflare's "In-Office", others' "Hybrid".
            stated_style=_work_style(job.location, job.location)
            or _greenhouse_work_style(payload.get("metadata") or []),
            stated_pay=_greenhouse_pay(payload.get("pay_input_ranges") or []),
            offices=tuple(o["name"] for o in payload.get("offices") or [] if o.get("name")),
        ),
    )


def _greenhouse_work_style(metadata: list[dict]) -> str | None:
    """A board's own work-model field: "Working Conditions: Hybrid" (Ashby-style
    location types), "Is Remote?: true"."""
    for field in metadata:
        name, value = str(field.get("name")), field.get("value")
        named = re.search(
            r"working conditions|work(?:place)? (?:type|model|arrangement)|location type",
            name,
            re.I,
        )
        if named and (style := _work_style(value, None)):
            return style
        if re.search(r"\bis remote\b|\bremote\??$", name, re.I) and value is True:
            return "Remote"
    return None


def _greenhouse_job_type(metadata: list[dict]) -> str | None:
    """Greenhouse has no employment-type field, but boards add one under their own
    name: "Employment Type" (Attentive), "Employment Length" (Canonical)."""
    for field in metadata:
        named = re.search(r"employment|time type|job type|worker", str(field.get("name")), re.I)
        if named and (kind := details.job_type_label(field.get("value"))):
            return kind
    return None


def _greenhouse_pay(ranges: list[dict]) -> details.Pay | None:
    """Pay ranges in cents, one per zone or state, with the period only in a title
    ("Hourly Pay Range") -- or nowhere, when only the amount can tell."""
    currencies = {r.get("currency_type") for r in ranges}
    if len(currencies) != 1:
        return None
    cents = [c for r in ranges for c in (r.get("min_cents"), r.get("max_cents"))]
    if not all(isinstance(c, int) for c in cents):
        return None
    titles = " ".join(f"{r.get('title') or ''} {plain_text(r.get('blurb')) or ''}" for r in ranges)
    return details.Pay.from_amounts(currencies.pop(), min(cents) / 100, max(cents) / 100, titles)


PROVIDER = Provider(
    listing_url="https://boards-api.greenhouse.io/v1/boards/{token}/jobs",
    read=greenhouse,
    # An EU board (job-boards.eu.greenhouse.io) is answered by the same
    # boards-api.greenhouse.io as a US one, so it is the same kind of board.
    apply_link=re.compile(
        r"(?:boards|job-boards)(?:\.eu)?\.greenhouse\.io/(?:embed/job_app\?for=)?([a-z0-9_-]+)",
        re.I,
    ),
    # Greenhouse's list leaves descriptions out unless asked with `content=true`,
    # which sends every posting's full HTML -- hundreds of megabytes across all
    # boards to describe the ~1% we keep. So a kept Greenhouse posting is fetched
    # on its own, once: the store carries what it says forward after that.
    # `pay_transparency` adds the pay ranges a board entered in Greenhouse's own
    # pay fields.
    job_url=(
        "https://boards-api.greenhouse.io/v1/boards/{token}/jobs/{job_id}?pay_transparency=true"
    ),
    describe=describe_greenhouse,
    # `job-boards.`, not `boards.greenhouse.io`: the latter redirects there, and
    # `web.get` refuses a cross-origin redirect.
    logo_page="https://job-boards.greenhouse.io/{}",
    logo_pattern=re.compile(
        r'"(https://[\w-]*recruiting\.cdn\.greenhouse\.io/external_greenhouse_job_boards/logos/[^"]+)"'
    ),
)
