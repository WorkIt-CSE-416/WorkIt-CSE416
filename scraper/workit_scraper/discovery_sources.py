"""Curated board-discovery sources and the explicit schema each publishes."""

from dataclasses import dataclass

SOURCES = (
    "https://raw.githubusercontent.com/SimplifyJobs/Summer2027-Internships/dev/.github/scripts/listings.json",
    "https://raw.githubusercontent.com/SimplifyJobs/New-Grad-Positions/dev/.github/scripts/listings.json",
    "https://raw.githubusercontent.com/vanshb03/Summer2027-Internships/dev/.github/scripts/listings.json",
)
EXTRA_CURATED_SOURCES = tuple(
    f"https://raw.githubusercontent.com/crypto-jobs-fyi/crawler/HEAD/{field}_companies.json"
    for field in ("ai", "crypto", "fin", "tech")
)


@dataclass(frozen=True)
class Source:
    url: str
    url_field: str = "url"
    company_fields: tuple[str, ...] = ("company_name", "company")


CURATED_SOURCES = (
    *(Source(url) for url in SOURCES),
    *(Source(url, "jobs_url", ("company_name",)) for url in EXTRA_CURATED_SOURCES),
)
