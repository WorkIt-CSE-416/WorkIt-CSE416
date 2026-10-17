"""
Response shape for GET /jobs: one scraped role, as the seeker feed's card needs
it. Typed values, not display strings — formatting belongs to the frontend's
(seeker)/jobs/format.ts, the same as it does for every other screen.

Also the parser for scraper/feed.json, which the scraper writes in exactly this
shape (scraper/workit_scraper/feed.py). That row and this model are the whole
contract between the two: add a field to both or neither.

GET /jobs builds these from job_postings rows (queries/jobs/listings.py to_listing),
so `id` there is the row's UUID; in feed.json it is the apply URL. The import
(app/scripts/import_jobs.py) parses the file with this model.
"""

from typing import Literal

from pydantic import BaseModel, computed_field

from app.auto_apply.hosts import auto_apply_supported
from app.models import dto
from app.models.dto import work_style
from app.services.matching.scoring import ScoreBreakdown


class JobListing(BaseModel):
    # The role's apply URL — the scraper dedupes on exactly that, so it is unique
    # within one feed. Not a database id; nothing can reference it yet.
    id: str
    title: str
    company: str
    apply_url: str
    # Who the job is for (KAN-233): a student (every internship), a new grad,
    # or someone with experience. Narrower than the shared enum on purpose:
    # its LEGACY members are never written, and to_listing reads them as these.
    experience_level: Literal["student", "new_grad", "experienced"]
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
    # first, then the whole description, and infers only by measured rules
    # (job_type full_time for a silent new-grad role; scraper/CLAUDE.md).
    # An internship is the job type internship (KAN-233), so its hours, when
    # a posting states them, aren't kept. Defaulted so an older feed.json
    # still parses.
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
    # No roles field: a job's roles are job_role_tags, which the import
    # resolves from the title (KAN-155). The scraper's own "roles" keys in
    # feed.json (KAN-172) are ignored, as any key this model doesn't declare
    # is, so a new scraper key never fails the import.

    # Whether auto apply takes this job posting: its apply_url is on a hiring
    # system the extension fills (app/auto_apply/hosts.py). Worked out from
    # apply_url, never stored or parsed, so feed.json has no such key; the
    # Jobs page shows Auto Apply only where it is true.
    @computed_field
    @property
    def auto_apply(self) -> bool:
        return auto_apply_supported(self.apply_url)


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


class JobRoleOption(BaseModel):
    """One job_roles role, as the Role filter and onboarding offer it."""

    # What GET /jobs?role= takes: the role's slug ("software_engineer").
    value: str
    # For people: "Software Engineer".
    label: str
    # Published scraped jobs tagged with it.
    jobs: int


class JobFacets(BaseModel):
    """GET /jobs/facets: every filter option's count, across the whole feed.

    start_term lists the seasons postings start in ("summer-2027", or a bare
    year), in calendar order and only those not yet over; role lists the
    job_roles that tag a job, in their sort_order, with their names (a job
    tagged with two roles counts in both); the rest list the values that have
    a job. A value with no jobs is absent, not zero.
    """

    work_style: list[FacetCount]
    role: list[JobRoleOption]
    experience: list[FacetCount]
    job_type: list[FacetCount]
    posted_within: list[FacetCount]
    visa: list[FacetCount]
    start_term: list[FacetCount]


class Highlight(BaseModel):
    """One reason a job matches (or doesn't), for the match rail."""

    text: str
    met: bool


class ScoredJob(JobListing):
    """A job listing with its match score and highlights."""

    match: int  # 0-100
    score_breakdown: ScoreBreakdown
    highlights: list[Highlight] = []


class JobCount(BaseModel):
    """GET /jobs/count: how many jobs the filters keep, not capped by a limit."""

    jobs: int
