# KAN-55 Scraper Research and Adaptation Plan

Research date: **2026-09-09**. This appendix supports the
[architecture](KAN-55_JOB_SCRAPER.md). It records inspected implementations,
official contracts, limited live observations, and the decisions drawn from
them. Recommendations below have not yet been implemented or benchmarked in
WorkIt.

## Reviewed revisions

Pin these revisions when adapting code or importing seed directories. Branch
names, repository sizes, and job counts can change after this review.

| Project | Reviewed commit | Relevant material |
| --- | --- | --- |
| [zshah101 internship engine](https://github.com/zshah101/Automated-List-Of-Summer-2027-and-Fall-2026-Tech-Internships/tree/fd622ad36b2f85cfbc2c103bf7c05a45dbfb1a89) | `fd622ad36b2f85cfbc2c103bf7c05a45dbfb1a89` | Models, store and regression tests, health, network client, provider connectors, database mirror, workflow. |
| [ats-scrapers](https://github.com/kalil0321/ats-scrapers/tree/6b44a1badc9bfbf5cf176f75265cc5729e520e99) | `6b44a1badc9bfbf5cf176f75265cc5729e520e99` | Base result contract, normalized model, Greenhouse/Ashby/SmartRecruiters mappings, company directories. |
| [job-board-aggregator](https://github.com/Feashliaa/job-board-aggregator/tree/e694d83cc6c706bbda88321c1f43ace648836e6c) | `e694d83cc6c706bbda88321c1f43ace648836e6c` | Anomaly script, merge behavior, provider concurrency, workflow ordering. |
| [Levergreen / job-board-scraper](https://github.com/adgramigna/job-board-scraper/tree/c40daade3b9dc842d4d9e886eeeb7ffc5b4ebe37) | `c40daade3b9dc842d4d9e886eeeb7ffc5b4ebe37` | Item/run provenance, persistence pipeline, dbt active-job model and coverage checks. |

The four repositories carry MIT notices at these revisions. WorkIt's
[third-party notices](../scraper/workit_scraper/THIRD_PARTY.md) retain their
copyright notices and distinguish planned reuse from code or data actually
present. Scrapy and Airbyte below supply design comparisons; neither is a
planned dependency.

## Adaptation map

### Ingestion and lifecycle: zshah101

The [models](https://github.com/zshah101/Automated-List-Of-Summer-2027-and-Fall-2026-Tech-Internships/blob/fd622ad36b2f85cfbc2c103bf7c05a45dbfb1a89/src/intern_engine/models.py)
make fetch completeness explicit and validate provider envelopes, including a
separate array path. Adapt those validators into a provider-aware result
contract. Preserve valid observed IDs before content rejection or product
filters; WorkIt needs presence evidence independently of normalized output.

The [store](https://github.com/zshah101/Automated-List-Of-Summer-2027-and-Fall-2026-Tech-Internships/blob/fd622ad36b2f85cfbc2c103bf7c05a45dbfb1a89/src/intern_engine/store.py)
tracks presence separately from retained listings, preserves first-seen,
resets misses on reappearance, and requires two complete misses for closure.
Adapt these transitions into per-board Postgres transactions. Its frozen
publication-date behavior serves its feed ordering; WorkIt must also allow
authoritative corrections and Ashby republication dates. Do not carry over
internship filtering, committed JSON state, or deletion of old closed rows.

The [store regression tests](https://github.com/zshah101/Automated-List-Of-Summer-2027-and-Fall-2026-Tech-Internships/blob/fd622ad36b2f85cfbc2c103bf7c05a45dbfb1a89/tests/test_store.py)
cover new/seen/closed transitions, partial and unreached sources,
reappearance between misses, reopening, first-seen preservation, and distinct
requisitions. Adapt these cases first, then add database rollback, concurrent
writers, replay, and conditional-request interactions specific to WorkIt.

The [health module](https://github.com/zshah101/Automated-List-Of-Summer-2027-and-Fall-2026-Tech-Internships/blob/fd622ad36b2f85cfbc2c103bf7c05a45dbfb1a89/src/intern_engine/health.py)
provides the three-failure/six-hour breaker and increasing quarantine periods.
The [network client](https://github.com/zshah101/Automated-List-Of-Summer-2027-and-Fall-2026-Tech-Internships/blob/fd622ad36b2f85cfbc2c103bf7c05a45dbfb1a89/src/intern_engine/net.py)
provides shared HTTPX requests, concurrency limits, and bounded retries. Adapt
the structure, but honor a server's full Retry-After deadline rather than
copying its 120-second cap. Long delays should defer work beyond the run.

The [SmartRecruiters connector](https://github.com/zshah101/Automated-List-Of-Summer-2027-and-Fall-2026-Tech-Internships/blob/fd622ad36b2f85cfbc2c103bf7c05a45dbfb1a89/src/intern_engine/connectors/smartrecruiters.py)
uses 100-row pages, a local 300-job limit, and internship-related search
queries. Those are application choices, not a provider ceiling. WorkIt must
enumerate all roles and explicitly reject incomplete traversal as closure
evidence. The [Lever connector](https://github.com/zshah101/Automated-List-Of-Summer-2027-and-Fall-2026-Tech-Internships/blob/fd622ad36b2f85cfbc2c103bf7c05a45dbfb1a89/src/intern_engine/connectors/lever.py)
also supplies useful composite-description and structured-salary mappings.

The [database schema](https://github.com/zshah101/Automated-List-Of-Summer-2027-and-Fall-2026-Tech-Internships/blob/fd622ad36b2f85cfbc2c103bf7c05a45dbfb1a89/db/schema.sql)
replaces a mirror snapshot atomically using a global advisory lock and staging
tables, including deletion of absent rows. Retain the transaction principle;
replace the mirror with source-row locking, version comparison, stable job
IDs, and soft closure. WorkIt migrations are owned by Alembic in the Python
backend, in one revision history shared with the API (KAN-93).

The [workflow](https://github.com/zshah101/Automated-List-Of-Summer-2027-and-Fall-2026-Tech-Internships/blob/fd622ad36b2f85cfbc2c103bf7c05a45dbfb1a89/.github/workflows/update.yml)
runs at minutes 7 and 37 with cancellation disabled. Its comments report an
observed scheduling delay sample; they are not a scheduling SLA. Borrow the
non-overlap intent, not its Git publishing or notification behavior.

### Provider mappings and candidate boards: ats-scrapers

The [pinned source tree](https://github.com/kalil0321/ats-scrapers/tree/6b44a1badc9bfbf5cf176f75265cc5729e520e99)
contains useful provider mappings and seed directories. Adapt the four needed
providers' field mappings and import candidate data with attribution. Do not
install the whole multi-provider application or copy its dependency surface.
Its [base fetch API](https://github.com/kalil0321/ats-scrapers/blob/6b44a1badc9bfbf5cf176f75265cc5729e520e99/src/ats_scrapers/scrapers/base.py)
returns a list of jobs without WorkIt's completeness contract; a returned list
alone is insufficient for removal detection.

Inspection of its [normalized model](https://github.com/kalil0321/ats-scrapers/blob/6b44a1badc9bfbf5cf176f75265cc5729e520e99/src/ats_scrapers/models.py)
found that `raw` is a selected overflow field, approximately 5 kB, with large
content stripped. Description text is
also bounded. This is not lossless replay storage. WorkIt will retain the
latest complete listing/detail material separately, report storage rejection,
and run explicit versioned reprocessing. Missing provider IDs must be rejected
rather than replaced with random UUIDs.

Use the structured [Ashby compensation and location mappings](https://github.com/kalil0321/ats-scrapers/blob/6b44a1badc9bfbf5cf176f75265cc5729e520e99/src/ats_scrapers/scrapers/ashby.py) as a starting
point, retaining multiple tiers and unknown values. Use [SmartRecruiters detail
mapping](https://github.com/kalil0321/ats-scrapers/blob/6b44a1badc9bfbf5cf176f75265cc5729e520e99/src/ats_scrapers/scrapers/smartrecruiters.py) while recording unsuccessful detail fetches as pending work. Do not
treat best-effort detail failure as successful content completion. [Greenhouse
publication fields](https://github.com/kalil0321/ats-scrapers/blob/6b44a1badc9bfbf5cf176f75265cc5729e520e99/src/ats_scrapers/scrapers/greenhouse.py) need provenance: falling back from publication to
`updated_at` would assert a publication date the source did not supply.

### Operational comparisons

The aggregator's [anomaly script](https://github.com/Feashliaa/job-board-aggregator/blob/e694d83cc6c706bbda88321c1f43ace648836e6c/scripts/check_anomalies.py)
compares platform totals with recent daily history: up to seven days, at least
five observations, a three-standard-deviation threshold, and a relative-change
fallback for flat series. Its [workflow](https://github.com/Feashliaa/job-board-aggregator/blob/e694d83cc6c706bbda88321c1f43ace648836e6c/.github/workflows/scrape-jobs.yml)
runs this after merge/publication steps as a non-blocking alert. It is not a
per-board closure gate. WorkIt should add provider-level alerts after a pilot
establishes useful baselines, without copying these thresholds as guarantees.

Its [merge script](https://github.com/Feashliaa/job-board-aggregator/blob/e694d83cc6c706bbda88321c1f43ace648836e6c/scripts/merge_data.py)
retains recent prior jobs and merges by source-specific URL rules. That is
useful for a published feed but does not implement the two-observation
lifecycle required here. The inspected Ashby concurrency of five informs a
conservative initial setting, not a published provider allowance.

Levergreen's [items](https://github.com/adgramigna/job-board-scraper/blob/c40daade3b9dc842d4d9e886eeeb7ffc5b4ebe37/job_board_scraper/job_board_scraper/items.py)
include run provenance. Keep that idea and add per-source outcomes so empty
boards and failures remain observable. Its
[pipeline](https://github.com/adgramigna/job-board-scraper/blob/c40daade3b9dc842d4d9e886eeeb7ffc5b4ebe37/job_board_scraper/job_board_scraper/pipelines.py)
creates tables from Python and commits individual items; neither fits WorkIt's
migration boundary or board-level atomicity.

Its [active-job model](https://github.com/adgramigna/job-board-scraper/blob/c40daade3b9dc842d4d9e886eeeb7ffc5b4ebe37/levergreen_dbt/models/marts/all_job_postings.sql)
uses today's scrape date to determine activity. WorkIt must not hide a job
merely because its poll failed today. Its
[expected-board check](https://github.com/adgramigna/job-board-scraper/blob/c40daade3b9dc842d4d9e886eeeb7ffc5b4ebe37/levergreen_dbt/tests/check_expected_careers_pages_scraped.sql)
motivates expected-versus-attempted source coverage; use attempt records so
healthy zero-job boards do not look unvisited. Scrapy, dbt, S3, and Airtable
are not needed for the initial WorkIt ingestion path.

### Checkpointing and caching comparisons

[Scrapy's HTTP cache implementation](https://docs.scrapy.org/en/latest/_modules/scrapy/downloadermiddlewares/httpcache.html)
reuses a cached representation on successful revalidation and can also return
cached content following an error. WorkIt must distinguish these cases:
stale-on-error content is not a fresh complete observation. A valid 304 can
refresh source health but cannot satisfy a pending negative confirmation.
[HTTP validators](https://www.rfc-editor.org/rfc/rfc9110.html#section-8.8)
describe selected representations, which is why a SmartRecruiters page ETag
cannot be promoted to an entire-board checkpoint.

[Scrapy AutoThrottle](https://docs.scrapy.org/en/latest/topics/autothrottle.html)
explains why fast error responses must not make a crawler accelerate. Use
shared limits, backoff, and provider cooldown in the small HTTPX client before
considering a larger crawling framework.

[Airbyte's state/checkpoint protocol](https://github.com/airbytehq/airbyte/blob/master/docs/platform/understanding-airbyte/airbyte-protocol.md#state--checkpointing)
ties destination acknowledgement to committed data. Apply the same principle
to an ATS validator: commit it with the corresponding job/lifecycle writes,
never immediately after HTTP success. The WorkIt transaction uses
[Postgres row locking](https://www.postgresql.org/docs/current/explicit-locking.html#LOCKING-ROWS)
and [Psycopg transaction contexts](https://www.psycopg.org/psycopg3/docs/basic/transactions.html).
Airbyte itself adds no necessary runtime capability to this scope.

## Provider contracts

| Provider | Evidence and implications |
| --- | --- |
| Greenhouse | [Job Board API](https://docs.greenhouse.io/job-board.html#retrieve-a-job): listings can include content when requested, so “Greenhouse never returns inline descriptions” is incorrect. WorkIt chooses a thin list plus details with `pay_transparency=true`; pay ranges use cents. Preserve missing units instead of assuming annual pay. |
| Lever | [Official Postings API](https://github.com/lever/postings-api#get-a-list-of-job-postings): JSON listing is an array; global and EU hosts exist; descriptions include multiple sections; `salaryRange` and `workplaceType` are structured optional fields. |
| Ashby | [Public Job Posting API](https://developers.ashbyhq.com/docs/public-job-posting-api): `publishedAt` is last publication, `isListed=false` is direct-link-only, and secondary locations/compensation tiers require preservation. Unlisted is separate from absent. |
| SmartRecruiters | [Paging documentation](https://developers.smartrecruiters.com/docs/customer-overview#paging) explains limit/offset traversal. The sampled public Posting API responses below expose `content` and `totalFound`. Customer API authentication/throttling rules must not be presented as public Posting API limits. |

## Live probe observations

On 2026-09-09, read-only GETs sampled the following public listing endpoints.
For each of the first four, an immediate second request to the **same URL**
sent the first response's ETag as `If-None-Match`. Byte counts are bodies
received by the probe client without requesting compression. No response
bodies or real posting fixtures were committed.

| Endpoint | First response | Immediate conditional response |
| --- | --- | --- |
| [Greenhouse / stripe](https://boards-api.greenhouse.io/v1/boards/stripe/jobs) | 200; 617 jobs; `meta.total=617`; 385,263 bytes | 304; 0 body bytes |
| [Lever / ro](https://api.lever.co/v0/postings/ro?mode=json) | 200; 47 jobs in a root array; 700,870 bytes | 304; 0 body bytes |
| [Ashby / ramp](https://api.ashbyhq.com/posting-api/job-board/ramp?includeCompensation=true) | 200; 145 jobs; 2,619,930 bytes | 304; 0 body bytes |
| [SmartRecruiters / sierraclub](https://api.smartrecruiters.com/v1/companies/sierraclub/postings?limit=100&offset=0) | 200; 2 jobs; `totalFound=2`; 2,432 bytes | 304; 0 body bytes |

Two additional reads tested the local-cap claim:
[BoschGroup offset 0](https://api.smartrecruiters.com/v1/companies/BoschGroup/postings?limit=100&offset=0)
and [offset 300](https://api.smartrecruiters.com/v1/companies/BoschGroup/postings?limit=100&offset=300)
each returned 100 postings with `totalFound=4828`. The page ETags differed.
This disproves an assumed 300-job availability ceiling for that sampled board;
it does not prove snapshot consistency across a changing board.

Limits of the evidence:

- Four immediate revalidations demonstrate support on those sampled responses,
  not a production hit rate, all-board support, or validator stability over time.
- The SmartRecruiters test did not mutate a later page and check page zero.
  There is no evidence that its first-page ETag covers the rest of the board.
- The probe did not fetch all 4,828 jobs or test closure correctness. Complete
  traversal and database lifecycle need their own acceptance tests.
- Counts and byte sizes are point-in-time observations. No throughput,
  provider rate-limit entitlement, or operating-cost SLA follows from them.

## Proposed defaults and validation

| Decision | Basis | What must validate it |
| --- | --- | --- |
| Two complete misses; positive presence resets | Adapted store behavior | Offline transitions, rollback, retries, and concurrent workers. |
| Eight concurrent requests per host/provider; five Ashby; 32 global | Reference patterns plus WorkIt initial global budget | Pilot errors, throttling, bytes, and runtime; listing/detail/discovery share limits. |
| Three retries; full Retry-After or defer | Bounded reference retry structure with corrected deadline handling | Numeric/date delay tests and no early retry after deferral. |
| Three failures → 6h, then 12/24/48/72h quarantine | Reference health schedule | Success reset, failure classification, and source freshness alerts. |
| 24h unconditional listing/detail refresh | WorkIt recovery and freshness choice | Pending-detail and silent-detail-change tests; measure traffic. |
| 30-minute schedule; p95 runtime below half interval before expansion | Reference cadence plus WorkIt rollout criterion | Pilot measurements; scheduling remains best effort. |
| Whole-list ETags only in v1 | Sampled revalidation plus representation-specific validators | Atomic checkpoints, pending-miss bypass, recovery, and parser replay tests. |
| Full latest replay payloads; no historical archive yet | Parser corrections need more than selected overflow | Payload-size distributions and replay equivalence; no silent truncation. |

[GitHub documents schedule delays and possible dropped queued jobs](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule).
Off-hour scheduling may help, but cannot establish a guaranteed closure time.
At 14,600 enabled boards and 48 daily polls, even an all-304 run still makes
700,800 listing requests per day before pagination and details. This is a scale
illustration, not a verified count of usable seed boards.

## Other projects screened

[Simplify's contribution workflow](https://github.com/SimplifyJobs/Summer2027-Internships/blob/dev/CONTRIBUTING.md)
describes external ingestion and curated publication; it does not expose the
complete scraper engine needed for adaptation here.
[JobSpy](https://github.com/speedyapply/JobSpy) is an aggregator-facing scraping
library rather than the board registry, checkpoint, and persistent lifecycle
store this task needs. These projects are useful context, but do not displace
the selected core and provider mappings.

## Implementation handoff

Follow the acceptance table and seven milestones in the architecture. Before
copying a module, preserve its notice, adapt only the relevant behavior, and
add the corresponding regression cases. Record copied paths and seed revision
in the notices at that time. The present change revises the specification and
scaffold guidance; it does not deliver a runnable scraper, database migration,
imported registry, scheduler, or production benchmark.
