"""Reading iCIMS postings as a company's Jibe careers site lists them
(careers.amd.com): its reader and its record.

Not `icims`, which reads a tenant's own `{prefix}-{company}.icims.com` sitemap.
The curated lists link many iCIMS postings on the company's Jibe site instead
(`{host}/jobs/{id}?icims=1`), whose host is no icims.com subdomain, so `icims`
never sees them. The Jibe site's `/api/jobs` lists them whole, descriptions
included."""

from __future__ import annotations

import re
from collections.abc import Callable

from workit_scraper import details
from workit_scraper.providers import fetch
from workit_scraper.providers.fetch import _iso
from workit_scraper.providers.model import Incomplete, Job, Provider, TooLarge
from workit_scraper.providers.text import _listing_page, _place

#: Postings per Jibe request (its own page asks for 10).
JIBE_PAGE = 100
#: The largest Jibe board read, as Workday's `WORKDAY_MAX`: 50 requests, about four
#: minutes at Jibe's 5-second Crawl-delay. Past it were H&R Block (18,576 postings,
#: 15 minutes, no early-career role), Ulta (12,196, 22 roles) and UHS (6,100, none):
#: read every run, they held the lane at 31 minutes, and two of three scheduled
#: runs on 2026-10-30 hit the workflow's 60-minute timeout and imported nothing.
JIBE_MAX = 5000


def jibe(token: str, company: str, *, pace: Callable[[str], None] = lambda url: None) -> list[Job]:
    """Every iCIMS posting on a company's Jibe careers site, read whole or not at
    all, with its description. Jibe can front other systems too, so only rows it
    says are on iCIMS (`ats_code`) are kept. Jibe sites publish a Crawl-delay of
    5 s, which `pace` keeps between pages.

    A site can list one posting twice (MasTec: 1,258 rows, 1,211 postings, all
    pages read; 2026-10-26), so the rows served, not the distinct postings, must
    add up to the count; the twice-listed posting is kept once."""
    rows: dict[str, dict] = {}
    served, expected, number = 0, None, 1
    while expected is None or (number - 1) * JIBE_PAGE < expected:
        url = f"https://{token}/api/jobs?page={number}&limit={JIBE_PAGE}"
        if number > 1:
            pace(url)
        payload = fetch._get_json(url)
        assert isinstance(payload, dict)
        if expected is None:
            expected = int(payload.get("totalCount") or 0)
            if expected > JIBE_MAX:
                raise TooLarge(f"{expected:,} postings")
        page = [row.get("data") or {} for row in payload.get("jobs") or []]
        served += len(page)
        for row in page:
            rows.setdefault(str(row.get("slug") or row.get("req_id")), row)
        if not page:
            break
        number += 1
    if served != expected:
        raise Incomplete(f"read {served:,} postings of {expected:,}")
    jobs = []
    for slug, row in rows.items():
        if row.get("ats_code") != "icims":
            continue
        title = (row.get("title") or "").strip()
        markup = "<br>".join(
            row.get(part) or "" for part in ("description", "responsibilities", "qualifications")
        )
        shortlist_tags, page = _listing_page(
            title,
            markup,
            stated_type=details.job_type_label(row.get("employment_type")),
        )
        jobs.append(
            Job(
                ats="jibe",
                token=token,
                company=company,
                external_id=slug,
                title=title,
                # The posting on the company's site, as the curated lists link it;
                # its Apply goes on to the tenant's icims.com form.
                apply_url=f"https://{token}/jobs/{slug}?icims=1",
                location=_place(row.get("city"), row.get("state"), row.get("country"))
                or row.get("full_location")
                or None,
                posted_at=_iso(row.get("posted_date")),
                shortlist_tags=shortlist_tags,
                page=page,
            )
        )
    return jobs


PROVIDER = Provider(
    # `token` is the company's Jibe host (careers.amd.com).
    listing_url="https://{token}/api/jobs?page=1&limit=100",
    read=jibe,
    # {host}/jobs/{id}?icims=1: the board is that host, which lists them all.
    apply_link=re.compile(r"//([a-z0-9.-]+)/jobs/\d+[^\s#]*[?&]icims=1", re.I),
    paged=True,
    # As Workday's and Oracle's: past it the lane starts no board and leaves the rest
    # for the next run, so a slow site never holds the whole run past its timeout.
    budget_s=12 * 60,
    # The list carries every description, so no page is read. No logo yet.
)
