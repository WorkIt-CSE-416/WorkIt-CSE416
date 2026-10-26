"""Reading oracle company job boards: its reader, its page reader and its record."""

from __future__ import annotations

import html
import re
from collections.abc import Callable
from dataclasses import replace

from workit_scraper.providers import fetch
from workit_scraper.providers.fetch import _iso
from workit_scraper.providers.model import Incomplete, Job, Provider, TooLarge
from workit_scraper.providers.registry import _parts, job_url, listing_url
from workit_scraper.providers.text import (
    _described,
    _page,
    _places,
    _work_style,
)

#: Postings per request: Oracle answers a larger `limit` with 200 (2026-10-26).
ORACLE_PAGE = 200


#: The largest Oracle board read, 25 requests, as Workday's `WORKDAY_MAX`.
ORACLE_MAX = 5000


def oracle(
    token: str, company: str, *, pace: Callable[[str], None] = lambda url: None
) -> list[Job]:
    """Every posting on an Oracle Recruiting careers site, read whole or not at all:
    the list its careers page reads, `ORACLE_PAGE` a request, each paced but the
    first.

    A read is whole when its distinct postings reach the count Oracle gave, less
    one in 500 (at least one). A grocer's board (hdhe.fa.em3) counted 404 and listed
    403 on every way of paging it, both sort orders and two page sizes; of six
    boards read that day, four added up exactly and one listed 2,541 of 2,543.
    Strict, the grocer's board would never be read. Fewer is `Incomplete`, a
    failed read, evidence of nothing."""
    url = listing_url("oracle", token)
    rows: dict[str, dict] = {}
    total, offset = None, 0
    while total is None or offset < total:
        if offset:
            pace(url)
        payload = fetch._get_json(f"{url},limit={ORACLE_PAGE},offset={offset}")
        assert isinstance(payload, dict)
        found = (payload.get("items") or [{}])[0]
        if total is None:
            total = int(found.get("TotalJobsCount") or 0)
            if total > ORACLE_MAX:
                raise TooLarge(f"{total:,} postings")
        page = found.get("requisitionList") or []
        for row in page:
            rows.setdefault(str(row["Id"]), row)
        if not page:
            break
        offset += ORACLE_PAGE
    if len(rows) < total - max(1, total // 500):
        raise Incomplete(f"read {len(rows):,} distinct postings of {total:,}")

    parts = _parts("oracle", token)
    site = "https://{host}.oraclecloud.com/hcmUI/CandidateExperience/en/sites/{site}".format(
        **parts
    )
    return [
        Job(
            ats="oracle",
            token=token,
            company=company,
            external_id=job_id,
            title=(row.get("Title") or "").strip(),
            apply_url=f"{site}/job/{job_id}",
            location=_places(
                [
                    row.get("PrimaryLocation"),
                    *(p.get("Name") for p in row.get("secondaryLocations") or []),
                ]
            ),
            posted_at=_iso(row.get("PostedDate")),
            # Only the list states it, where the employer filled it in ("Remote",
            # "On-site"); the record leaves it blank, as Rippling's does.
            work_style=_work_style(row.get("WorkplaceType"), None),
        )
        for job_id, row in rows.items()
    ]


def describe_oracle(job: Job) -> Job:
    """The same Oracle posting with what only its own record says: the
    description in its parts (the job, its responsibilities and qualifications,
    then the company's), the exact time it went up, and the employer's own fields
    ("Base Range: $31.00 - $45.00 per hour"), which hold the pay where it is
    stated."""
    payload = fetch._get_json(job_url("oracle", job.token, job.external_id))
    assert isinstance(payload, dict)
    record = (payload.get("items") or [{}])[0]
    fields = "".join(
        f"<p>{html.escape(str(f.get('Prompt')))}: {html.escape(str(f.get('Value')))}</p>"
        for f in record.get("requisitionFlexFields") or []
        if f.get("Prompt") and f.get("Value")
    )
    parts = [
        record.get(key) or ""
        for key in (
            "ExternalDescriptionStr",
            "ExternalResponsibilitiesStr",
            "ExternalQualificationsStr",
        )
    ]
    full, roles = _described("".join([*parts, fields, record.get("CorporateDescriptionStr") or ""]))
    return replace(
        job,
        posted_at=_iso(record.get("ExternalPostedStartDate")) or job.posted_at,
        page=_page(
            job.title,
            full,
            roles=roles,
            stated_style=job.work_style or _work_style(None, job.location),
        ),
    )


PROVIDER = Provider(
    # What an Oracle Recruiting careers page itself reads, Oracle's documented
    # REST resource for it. `token` is "{host}/{site}". Its tenants' hosts had
    # no robots.txt (404, no rules) on 2026-10-26; JPMC's answers a firewall's
    # 403 to everything, so its board fails each run, as it should.
    listing_url=(
        "https://{host}.oraclecloud.com/hcmRestApi/resources/latest/"
        "recruitingCEJobRequisitions?onlyData=true&expand=requisitionList.secondaryLocations"
        "&finder=findReqs;siteNumber={site},sortBy=POSTING_DATES_DESC"
    ),
    read=oracle,
    # {host}.oraclecloud.com/hcmUI/CandidateExperience/{locale}/sites/{site}/...
    # The site code keeps its case: its list answers `cx` as `CX`, but a job's
    # record leaves out the employer's own fields, pay among them, for any
    # spelling but its own (Texas Instruments' "Base Range", 2026-10-26).
    apply_link=re.compile(
        r"//([a-z0-9.-]+?)\.oraclecloud\.com/hcmUI/CandidateExperience/"
        r"[a-z]{2}(?:-[a-z]{2})?/sites/([a-z0-9_]+)",
        re.I,
    ),
    keeps_case=True,
    job_url=(
        "https://{host}.oraclecloud.com/hcmRestApi/resources/latest/"
        "recruitingCEJobRequisitionDetails?expand=all&onlyData=true"
        '&finder=ById;Id="{job_id}",siteNumber={site}'
    ),
    describe=describe_oracle,
    paged=True,
    page_date=True,
    # One pace for all of Oracle's tenants, as for Workday's.
    subdomains="oraclecloud.com",
    # Its ~190 boards hold some 100,000 postings, 200 a request: read like
    # Workday's, least recently read first, for as long as Workday's lane runs.
    budget_s=12 * 60,
    # No logo yet: the list and record name no image or website.
)
