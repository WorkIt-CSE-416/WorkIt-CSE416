"""Talk to one job board and return its postings.

One function per applicant tracking system, registered in `PROVIDERS` with
everything else the scraper knows about that system. Each one makes a single GET
and maps the response onto `Job`. Explicit functions rather
than a shared field-map table: a teammate reading `lever()` should see Lever's
actual field names, not a DSL that encodes them.

Every API but Workday's returns a whole board in one response -- verified at
Stripe (701 postings), OpenAI (829), Palantir (321), Genetec's Workable board (188)
and Hard Rock Digital's Recruitee board (58). Workday sends 20 postings a request,
so `workday` pages, and paces every page (scraper/CLAUDE.md, "Workday").

A slug that does not exist is a 404 everywhere but BambooHR, which redirects it
to its own homepage (`bamboohr` turns that into the same answer). That is what
makes `BoardNotFound` meaningful: a 200 carrying an empty list is a real board
that simply has nothing open right now, and must never be confused with a typo.

Greenhouse, Workable, BambooHR and Workday list a board without its
descriptions, so a kept posting's own page is read once more (`describe`); Ashby,
Lever and Recruitee send the descriptions with the list.

TikTok, iCIMS's Jibe sites (`jibe`) and SuccessFactors were added in KAN-369:
TikTok and Jibe page their lists, descriptions included; SuccessFactors pages a
list of titles and reads each kept posting's page (docs/providers.md).
"""

from __future__ import annotations

from workit_scraper.providers import systems
from workit_scraper.providers.fetch import TIMEOUT_S
from workit_scraper.providers.model import (
    PAGE_VERSION,
    Board,
    BoardNotFound,
    Incomplete,
    Job,
    Page,
    Provider,
    TooLarge,
)
from workit_scraper.providers.registry import (
    PROVIDERS,
    describe,
    job_url,
    listing_url,
    name_url,
    robots_urls,
)
from workit_scraper.providers.systems.ashby import ashby
from workit_scraper.providers.systems.bamboohr import bamboohr, describe_bamboohr
from workit_scraper.providers.systems.greenhouse import describe_greenhouse, greenhouse
from workit_scraper.providers.systems.icims import describe_icims, icims
from workit_scraper.providers.systems.jibe import jibe
from workit_scraper.providers.systems.lever import lever
from workit_scraper.providers.systems.oracle import describe_oracle, oracle
from workit_scraper.providers.systems.recruitee import recruitee
from workit_scraper.providers.systems.rippling import describe_rippling, rippling
from workit_scraper.providers.systems.successfactors import describe_successfactors, successfactors
from workit_scraper.providers.systems.tiktok import tiktok
from workit_scraper.providers.systems.workable import describe_workable, workable
from workit_scraper.providers.systems.workday import describe_workday, workday
from workit_scraper.providers.text import DESCRIPTION_CHARS, cap, plain_lines, plain_text

# The registry, in the order the records were written in one module: lanes,
# apply-link matching and metrics follow it. `systems.greenhouse` is the module;
# `greenhouse`, imported above, its reader.
PROVIDERS.update(
    {
        "greenhouse": systems.greenhouse.PROVIDER,
        "ashby": systems.ashby.PROVIDER,
        "lever": systems.lever.PROVIDER,
        "workable": systems.workable.PROVIDER,
        "recruitee": systems.recruitee.PROVIDER,
        "bamboohr": systems.bamboohr.PROVIDER,
        "rippling": systems.rippling.PROVIDER,
        "icims": systems.icims.PROVIDER,
        "oracle": systems.oracle.PROVIDER,
        "workday": systems.workday.PROVIDER,
        # KAN-369's, after the rest.
        "tiktok": systems.tiktok.PROVIDER,
        "jibe": systems.jibe.PROVIDER,
        "successfactors": systems.successfactors.PROVIDER,
    }
)

__all__ = [
    "Board",
    "BoardNotFound",
    "DESCRIPTION_CHARS",
    "Incomplete",
    "Job",
    "PAGE_VERSION",
    "PROVIDERS",
    "Page",
    "Provider",
    "TIMEOUT_S",
    "TooLarge",
    "ashby",
    "bamboohr",
    "cap",
    "describe",
    "describe_bamboohr",
    "describe_greenhouse",
    "describe_icims",
    "describe_oracle",
    "describe_rippling",
    "describe_successfactors",
    "describe_workable",
    "describe_workday",
    "greenhouse",
    "icims",
    "jibe",
    "job_url",
    "lever",
    "listing_url",
    "name_url",
    "oracle",
    "plain_lines",
    "plain_text",
    "recruitee",
    "rippling",
    "robots_urls",
    "successfactors",
    "tiktok",
    "workable",
    "workday",
]
