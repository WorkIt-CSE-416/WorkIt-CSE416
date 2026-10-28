"""Reading icims company job boards: its reader, its page reader and its record."""

from __future__ import annotations

import html
import json
import re
import urllib.error
import urllib.parse
from dataclasses import replace

from workit_scraper import details
from workit_scraper.providers import fetch
from workit_scraper.providers.fetch import _iso
from workit_scraper.providers.model import Incomplete, Job, Provider
from workit_scraper.providers.registry import job_url, listing_url
from workit_scraper.providers.text import (
    _described,
    _page,
    _place,
    _places,
    _work_style,
)

#: A job's address in an iCIMS sitemap: its number, then its title as a slug.
_ICIMS_JOB = re.compile(r"<loc>\s*(https://[^<]+?/jobs/(\d+)/([^/<]+)/job)\s*</loc>")


#: The page's schema.org JobPosting, which search engines read too.
_LD_JSON = re.compile(r'<script[^>]*type="application/ld\+json"[^>]*>(.*?)</script>', re.S)


#: What iCIMS writes in a field the employer left empty.
_UNSET = "UNAVAILABLE"


def icims(token: str, company: str) -> list[Job]:
    """An iCIMS board, in one request: its sitemap, which names every open job by
    its URL. General Dynamics Mission Systems' listed 723 on 2026-10-26, exactly
    the count its own search pages total (36 of 20, then 3), against 37 requests
    to read those. A job's title is only its URL's slug, which classifies the same;
    its own page has the real one (`describe_icims`).

    Anything that is not a list of URLs (an index of sitemaps) raises
    `Incomplete`: read as an empty board, it would close every job it has."""
    text = fetch._get_text(listing_url("icims", token))
    if "<urlset" not in text:
        raise Incomplete("not a sitemap of job URLs")
    jobs = {}
    for match in _ICIMS_JOB.finditer(text):
        url, job_id, slug = match.groups()
        jobs.setdefault(
            job_id,
            Job(
                ats="icims",
                token=token,
                company=company,
                external_id=job_id,
                title=_icims_title(slug),
                apply_url=html.unescape(url),
            ),
        )
    return list(jobs.values())


def _icims_title(slug: str) -> str:
    """ "summer-2027-mechanical-engineering-intern--topeka%2c-ks" as words: the
    title lower-cased, its punctuation mostly gone. "co-op" becomes "coop", which
    the filter reads as it reads "co-op"; as "co op" every iCIMS co-op was dropped
    before its page was read."""
    text = re.sub(r"\bco-op\b", "coop", urllib.parse.unquote(slug), flags=re.I)
    return " ".join(text.replace("-", " ").split())


def describe_icims(job: Job) -> Job:
    """The same iCIMS posting with what its own page says, from the schema.org
    JobPosting it carries: the real title, the date it went up, its places, its
    employment type and the description."""
    posting = _icims_posting(fetch._get_text(job_url("icims", job.token, job.external_id)))
    title = html.unescape(str(posting.get("title") or "")).strip() or job.title
    full, roles = _described(posting.get("description"))
    places = _places(_icims_place(place) for place in posting.get("jobLocation") or [])
    return replace(
        job,
        title=title,
        posted_at=_iso(posting.get("datePosted")) or job.posted_at,
        page=_page(
            title,
            full,
            roles=roles,
            stated_type=details.job_type_label(posting.get("employmentType")),
            stated_style=_work_style(None, places),
            offices=(places,) if places else (),
        ),
    )


def _icims_posting(page: str) -> dict:
    """The page's JobPosting, or {} when it has none."""
    for match in _LD_JSON.finditer(page):
        try:
            found = json.loads(match.group(1))
        except json.JSONDecodeError:
            continue
        for item in found if isinstance(found, list) else [found]:
            if isinstance(item, dict) and item.get("@type") == "JobPosting":
                return item
    return {}


def _icims_place(place: object) -> str | None:
    """ "Topeka, KS, US" from a JobPosting place, leaving out what iCIMS marks unset."""
    address = (place.get("address") if isinstance(place, dict) else None) or {}
    parts = (address.get(k) for k in ("addressLocality", "addressRegion", "addressCountry"))
    return _place(*(part for part in parts if part != _UNSET)) or None


PROVIDER = Provider(
    # Each company is its own host ({prefix}-{company}.icims.com), whose
    # robots.txt names this sitemap and allows its job pages.
    listing_url="https://{token}.icims.com/sitemap.xml",
    read=icims,
    # careers-gdms.icims.com/jobs/{id}/{slug}/job: the token is the whole host
    # label, since the prefix varies (careers-, career-, external-). `www` is
    # the vendor's own site.
    apply_link=re.compile(r"//(?!www\.)([a-z0-9-]+)\.icims\.com", re.I),
    # The page inside the careers site's frame, which carries the JobPosting;
    # the job's number alone finds it.
    job_url="https://{token}.icims.com/jobs/{job_id}/job?in_iframe=1",
    describe=describe_icims,
    page_title=True,
    subdomains="icims.com",
    # No logo yet: the page names only the company's website
    # (`hiringOrganization.sameAs`), often "UNAVAILABLE". Its cards show
    # initials.
)
