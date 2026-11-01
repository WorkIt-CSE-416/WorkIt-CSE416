"""Reading workable company job boards: its reader, its page reader and its record."""

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
    _place,
    _places,
    _work_style,
    json_name,
)


def workable(token: str, company: str) -> list[Job]:
    # The widget lists a job once per location under one shortcode: Trexquant's
    # "C++ Trading & Simulator Engineer (USA)" is a Stamford row and a New York
    # row. One posting, so the rows are merged and their places joined.
    payload = fetch._get_json(listing_url("workable", token))
    assert isinstance(payload, dict)
    by_code: dict[str, list[dict]] = {}
    for row in payload.get("jobs") or []:
        by_code.setdefault(str(row["shortcode"]), []).append(row)
    return [
        Job(
            ats="workable",
            token=token,
            company=company,
            external_id=shortcode,
            title=(rows[0].get("title") or "").strip(),
            apply_url=rows[0].get("url") or rows[0].get("shortlink") or "",
            location=_places(_workable_place(row) for row in rows),
            department=rows[0].get("department") or None,
            # The date the board shows. `created_at` is when the draft was
            # opened: Flexcompute's CFD developer was created 2024-05-14 and
            # published 2026-09-30.
            posted_at=_iso(rows[0].get("published_on") or rows[0].get("created_at")),
            # No page: its own page is read once (`describe_workable`).
        )
        for shortcode, rows in by_code.items()
    ]


def _workable_place(row: dict) -> str | None:
    """The row's locations the employer shows. A hidden one stays hidden: Hugging
    Face hides Paris on its "EMEA Remote" roles, where the top-level city still says
    it."""
    return _places(
        _place(place.get("city"), place.get("region"), place.get("country"))
        for place in row.get("locations") or []
        if not place.get("hidden")
    )


def describe_workable(job: Job) -> Job:
    """The same Workable posting with what only its own page says: the whole text,
    the work model (hybrid included, which the widget cannot say) and the salary."""
    payload = fetch._get_json(job_url("workable", job.token, job.external_id))
    assert isinstance(payload, dict)
    # Three fields, shown on the posting under these headings. The headings stay,
    # since `details` reads a visa line by the heading above it.
    sections = [payload.get("description") or ""]
    for heading, field in (("Requirements", "requirements"), ("Benefits", "benefits")):
        if payload.get(field):
            sections.append(f"<h3>{heading}</h3>{payload[field]}")
    # `type` is the widget's employment type, abbreviated. On the 34 postings kept
    # 2026-10-10: "full" (14), "temporary" (12), "other" (3), "part" (2), none (3).
    # Temporary and other say nothing about hours, so the description decides.
    kind = str(payload.get("type") or "")
    full, roles = _described("".join(sections))
    return replace(
        job,
        page=_page(
            job.title,
            full,
            roles=roles,
            stated_type=details.job_type_label(
                {"full": "full_time", "part": "part_time"}.get(kind, kind)
            ),
            stated_style=_work_style(
                payload.get("workplace") or ("remote" if payload.get("remote") else None),
                job.location,
            ),
            stated_pay=details.Pay.from_interval(
                payload.get("salary_currency_iso_code"),
                payload.get("salary_from"),
                payload.get("salary_to"),
                payload.get("salary_frequency"),
            ),
        ),
    )


PROVIDER = Provider(
    # The careers-page widget's feed, which Workable documents for embedding a
    # board. Without `details=true`: the description comes from a kept posting's
    # own page, which also has the work model and pay the widget leaves out.
    listing_url="https://apply.workable.com/api/v1/widget/accounts/{token}",
    read=workable,
    # apply.workable.com/{account}/j/{shortcode}/. A bare apply.workable.com/j/...
    # names no account, so `j` (and the `api`) is never one.
    apply_link=re.compile(r"apply\.workable\.com/(?!(?:j|api)/)([a-z0-9_-]+)", re.I),
    # What Workable's own careers page reads: the description, requirements and
    # benefits, plus `workplace` (hybrid included) and a salary, neither of which
    # the widget carries. Six of 14 sampled postings had a salary (2026-10-10).
    job_url="https://apply.workable.com/api/v2/accounts/{token}/jobs/{job_id}",
    describe=describe_workable,
    # The account behind the board, as JSON: what Workable's careers page draws
    # its header from, and the company's website besides.
    logo_page="https://apply.workable.com/api/v1/accounts/{}",
    # The account logo, not `open_graph_logo`. 120px tall: 8 of the first 25 read
    # were squares, the rest wordmarks up to 720 wide, which the card letterboxes.
    logo_pattern=re.compile(
        r'"logo":"(https://workablehr\.s3\.amazonaws\.com/uploads/account/logo/[^"]+)"'
    ),
    # The widget's own feed: {"name": "SAP Fioneer", "jobs": [...]}.
    name_url="https://apply.workable.com/api/v1/widget/accounts/{token}",
    read_name=json_name,
)
