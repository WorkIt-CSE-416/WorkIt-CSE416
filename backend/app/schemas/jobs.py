"""
Response shape for GET /jobs: one scraped role, as the seeker feed's card needs
it. Typed values, not display strings — formatting belongs to the frontend's
(seeker)/jobs/format.ts, the same as it does for every other screen.

Also the parser for scraper/feed.json, which the scraper writes in exactly this
shape (scraper/workit_scraper/feed.py). That row and this model are the whole
contract between the two: add a field to both or neither.

Not read from `job_postings` yet. That table can hold scraped rows since
b40588efa7b7 (`company_id` NULL, models/CLAUDE.md), but nothing imports the
feed into it, so GET /jobs still serves the file.
"""

from typing import Literal

from pydantic import BaseModel

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
    # None rather than a guess: most Greenhouse boards never say.
    work_style: work_style | None
    # One place, or "N locations" for a role posted to several offices.
    location: str | None
    posted_at: str | None
    # The logo the company uploaded to its job board; None when it has none.
    logo_url: str | None
    # Plain text, capped by the scraper. Scout reads it; GET /jobs leaves it out
    # (the cards never show it). Defaulted so a feed.json written before the
    # scraper captured descriptions still parses.
    description: str | None = None
