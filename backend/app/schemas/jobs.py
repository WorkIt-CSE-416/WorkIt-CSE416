"""
Response shape for GET /jobs: one scraped role, as the seeker feed's card needs
it. Typed values, not display strings — formatting belongs to the frontend's
(seeker)/jobs/format.ts, the same as it does for every other screen.

Also the parser for scraper/feed.json, which the scraper writes in exactly this
shape (scraper/workit_scraper/feed.py). That row and this model are the whole
contract between the two: add a field to both or neither.

GET /jobs builds these from job_postings rows (routers/jobs.py to_listing),
so `id` there is the row's UUID; in feed.json it is the apply URL. The import
(app/scripts/import_jobs.py) parses the file with this model.
"""

from typing import Literal

from pydantic import BaseModel

from app.models import dto
from app.models.dto import work_style


class JobListing(BaseModel):
    # The role's apply URL — the scraper dedupes on exactly that, so it is unique
    # within one feed. Not a database id; nothing can reference it yet.
    id: str
    title: str
    company: str
    apply_url: str
    # Narrower than the shared `experience_level` enum on purpose: the scraper
    # keeps intern and new-grad roles only, and the type says so.
    experience_level: Literal["internship", "new_grad"]
    # Stated by the posting, else inferred by the scraper from the company's other
    # postings or, for a posting that names a place and no alternative, On site
    # (scraper/CLAUDE.md). None when neither applies.
    work_style: work_style | None
    # One place, or "N locations" for a role posted to several offices.
    location: str | None
    # The card's version of it, "San Francisco, CA", from the import
    # (job_postings.location_label). Never in the scraper's feed, so it
    # defaults to None there.
    location_label: str | None = None
    posted_at: str | None
    # The logo the company uploaded to its job board; None when it has none.
    logo_url: str | None
    # Plain text, capped by the scraper. Scout reads it; GET /jobs leaves it out
    # (the cards never show it). Defaulted so a feed.json written before the
    # scraper captured descriptions still parses.
    description: str | None = None
    # The rest of the card, named after job_postings' columns. Each is None when
    # the posting never states it: the scraper reads the job board's own fields
    # first, then the whole description, and guesses nothing. Defaulted so an
    # older feed.json still parses.
    job_type: dto.job_type | None = None
    # One amount, or a min and max when the posting gives a range.
    salary: float | None = None
    salary_min: float | None = None
    salary_max: float | None = None
    salary_currency: str | None = None
    # week and month too: many internships pay that way, and a 12-week stipend
    # turned into a yearly figure would overstate it.
    salary_period: dto.salary_period | None = None
    min_years_experience: int | None = None
    # When an internship starts, as the posting names it: "Summer 2027", "2027".
    start_term: str | None = None
    # What the posting says about visas, read from its whole text by the scraper:
    # it sponsors, it doesn't, or US citizens only. None when it says nothing,
    # which is most postings. Defaulted so an older feed.json still parses.
    sponsorship: dto.visa_sponsorship | None = None
    # Which of the five disciplines the role is in (software, data_ai, product,
    # quant, hardware), read from its title by the scraper. None only in a
    # feed.json written before the scraper kept more than software, which is
    # why it is defaulted.
    role_category: dto.role_category | None = None


class JobLocationOption(BaseModel):
    """One place the seeker feed can be narrowed to, from GET /jobs/locations."""

    # What GET /jobs?location= takes: a country ("US") or one of its states
    # ("US-CA"), as job_locations stores them.
    code: str
    # For people: "United States", "California", "Other". A state's label is
    # its name alone; the job board shows it under its country.
    label: str
    # Published scraped jobs offered there.
    jobs: int


class FacetCount(BaseModel):
    """One filter option and how many published scraped jobs it holds."""

    # The value GET /jobs takes for it: "remote", "full_time", "7", "summer-2027".
    value: str
    jobs: int


class JobFacets(BaseModel):
    """GET /jobs/facets: every filter option's count, across the whole feed.

    start_term lists the seasons postings start in ("summer-2027", or a bare
    year), in calendar order and only those not yet over; the rest list the
    values that have a job. A value with no jobs is absent, not zero.
    """

    work_style: list[FacetCount]
    role: list[FacetCount]
    experience: list[FacetCount]
    job_type: list[FacetCount]
    posted_within: list[FacetCount]
    visa: list[FacetCount]
    start_term: list[FacetCount]


class JobCount(BaseModel):
    """GET /jobs/count: how many jobs the filters keep, not capped by a limit."""

    jobs: int
