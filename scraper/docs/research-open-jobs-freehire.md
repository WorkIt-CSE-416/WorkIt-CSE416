# Research: how open-jobs and freehire scrape hiring systems

Written 2026-10-28 for KAN-430 (more early-career jobs). It reads two open
projects' source code and compares them with WorkIt's scraper. Reached from
`../CLAUDE.md`, "`boards.csv` is a seed, not a conclusion".

**Sources.** Both repos were shallow-cloned on 2026-10-28 and read, never run.

- open-jobs: `elliottdehn/open-jobs` at commit `6f47bc0` (2026-10-10). Cited as
  `OJ:<path>:<lines>`, i.e.
  `https://github.com/elliottdehn/open-jobs/blob/6f47bc0/<path>#L<lines>`.
- freehire: `strelov1/freehire` at commit `e0642c1` (2026-10-29 UTC). Cited as
  `FH:<path>:<lines>`, i.e.
  `https://github.com/strelov1/freehire/blob/e0642c1/<path>#L<lines>`.
- WorkIt: this repo's branch `KAN-430-job-scraping-adding-more-jobs-early-career`.
  Cited as `WI:<path>:<lines>`.
- "Checked live 2026-10-28" means a `curl` of a `robots.txt` file on that day.

**Two facts first.**

- **open-jobs no longer runs.** Its crawler stopped on 2026-10-10, for cost.
  The code is complete, and its board list stays published under CC0
  (`OJ:backend/src/shutdown.ts:1-8`, `OJ:README.md:14`, `OJ:LICENSE`).
- **freehire's board list is not in its repo.** The list of boards (its "board
  catalog") is a Postgres table, so the repo holds the discovery tools but not
  their output (`FH:internal/ingest/sources/AGENTS.md:7-8`).

## open-jobs: how it scrapes

TypeScript on Cloudflare Workers. One Durable Object (a small stateful
server-side object) per company job board, 36 registered providers, 114k board
slugs (`OJ:backend/DOCS.md:1-8`, `OJ:backend/DOCS.md:119`).

### Per hiring system (the ones that matter for WorkIt)

All use `GET` with `user-agent: open-jobs/0.1` and no auth unless noted. A
404 means the board is gone (`OJ:backend/src/ats/types.ts:19`).

| Hiring system | Endpoint | Pagination | Field mapping (title / location / description / date / apply URL) | Cite |
|---|---|---|---|---|
| Greenhouse | `https://boards-api.greenhouse.io/v1/boards/{slug}/jobs?content=true` | none, one response | `title` / `location.name` / `content` (entity-decoded HTML) / `first_published` / `absolute_url` | `OJ:backend/src/ats/greenhouse.ts:24-44` |
| Lever | `https://api.lever.co/v0/postings/{slug}?mode=json&limit=100&skip=N` | `skip` += 100 until a page has < 100 | `text` / `categories.allLocations` or `categories.location` / `description` + `lists` + `additional` stitched / `createdAt` (ms) / `hostedUrl` | `OJ:backend/src/ats/lever.ts:26-82` |
| Ashby | `https://api.ashbyhq.com/posting-api/job-board/{slug}` | none | `title` / `location` + `secondaryLocations` / `descriptionHtml` / `publishedAt` / `jobUrl`; drops `isListed: false` | `OJ:backend/src/ats/ashby.ts:21-53` |
| Workable | `https://apply.workable.com/api/v1/widget/accounts/{slug}?details=true` | none | `title` / `locations[]` (not `hidden`) / `description` / `published_on` / `url` | `OJ:backend/src/ats/workable.ts:34-65` |
| SmartRecruiters | list `https://api.smartrecruiters.com/v1/companies/{slug}/postings?limit=100&offset=N`; detail `.../postings/{id}` | `offset` to `totalFound`, 6 pages in parallel | `name` / `location.fullLocation` / detail `jobAd.sections` / `releasedDate` / built `jobs.smartrecruiters.com/{company}/{id}` | `OJ:backend/src/ats/smartrecruiters.ts:5-6,80-142` |
| Workday | `POST https://{host}/wday/cxs/{tenant}/{site}/jobs` body `{limit:20, offset, searchText:""}`; detail `GET .../wday/cxs/{tenant}/{site}{externalPath}` | `offset` += 20 to `total` (only page 1 has a real total), 6 in parallel | `title` / `locationsText` / detail `jobPostingInfo.jobDescription` / `postedOn` ("Posted 3 Days Ago" counted back) / `https://{host}/{site}{externalPath}` | `OJ:backend/src/ats/workday.ts:4-10,54-149` |
| BambooHR | `https://{slug}.bamboohr.com/careers/list`; detail `/careers/{id}/detail` | none | detail holds description and `datePosted`; a 302 to the marketing site = gone | `OJ:backend/src/ats/bamboohr.ts:4-11` |
| SuccessFactors | `https://{host}/sitemap.xml` (an RSS feed with every posting) | none | whole board, descriptions included, in one request | `OJ:backend/src/ats/successfactors.ts:4-11` |

Other providers it reads, with the hosts it calls: Breezy
(`{slug}.breezy.hr/json`), Recruitee (`{host}/api/offers/`), Personio
(`{host}/xml`), Pinpoint (`{slug}.pinpointhq.com/postings.json`), Teamtailor,
Softgarden, Join (HTML plus JSON-LD), Dayforce, Paycom, Paylocity, UKG, iCIMS,
Jobvite, Taleo, Oracle Cloud, Eightfold, Phenom, Jibe, Cornerstone, JazzHR,
Crelate, GoHire, JobScore, Recruiterbox, Comeet, USAJOBS (API key) and
GovernmentJobs (`OJ:backend/src/ats/index.ts:47-85`,
`OJ:backend/DOCS.md:79-117`). Each adapter's header comment documents its
endpoint (`OJ:backend/DOCS.md:72-77`).

Shared HTTP: `fetchRetry` retries 429/502/503/504 up to 4 times, honours
`Retry-After` (capped at 60 s), else backs off 3 s × 2ⁿ; 30 s timeout per
request (`OJ:backend/src/ats/http.ts:1-15`).

### Company discovery

1. **Common Crawl URL index (the main source).** The first `slugs.json`
   (2026-08-27) names its source as
   `"crawl": "https://index.commoncrawl.org/CC-MAIN-2026-21-index"` with
   `"max_pages": 1000`, and holds 64,383 slugs across 25 providers (git
   `1ba1b27:slugs.json`, lines 1-30). The adapters say the same per provider:
   BambooHR slugs "mined directly from the Common Crawl index (*.bamboohr.com)"
   (`OJ:backend/src/ats/bamboohr.ts:4-7`), UKG boards "mined from the Common
   Crawl index" (`OJ:backend/src/ats/ukg.ts:4-8`), JazzHR the same
   (`OJ:backend/DOCS.md:113`). **The mining script itself is not in the repo,
   at HEAD or in history** (searched all 436 commits' file lists). How it
   sliced URLs to slugs is unverified.
2. **Web Data Commons for custom career sites ("dark pool").** Web Data
   Commons extracts schema.org `JobPosting` JSON-LD from Common Crawl. Its
   2024-12 release: 4.29M postings on 63,320 domains, with each posting's
   source URL. open-jobs drops domains that are hiring-system hosts or job
   aggregators, then probes each domain statically; 26% yielded JSON-LD
   (`OJ:backend/CRAWLER.md:19-41,78-91`). This gave the `dark` provider:
   11,986 live and 26,776 gone boards (`OJ:slugs.json:30-33`).
3. **The fleet rebuilds its own list.** Since 2026-09-09 `slugs.json` is
   regenerated from the crawler's last status per board, split into `ats`
   (live) and `gone` (`OJ:backend/scripts/build-slugs.py:1-12`). Totals: 75,660
   live and 38,646 gone (`OJ:slugs.json:150`).
4. **LLM web search for big companies.** `discover-careers.py` asks OpenAI
   (web search tool) for each company's careers URL, then fingerprints the
   host: Jibe (`/api/jobs`), Phenom (`POST /widgets`), and Workday / Oracle /
   Eightfold hosts in the page source (`OJ:backend/scripts/discover-careers.py:1-73`).
5. **Common Crawl index plus DuckDuckGo for one lookup.** Comeet needs a uid
   per company; `build-comeet.mjs` queries the CDX index for
   `comeet.com/jobs/{slug}/*`, then falls back to
   `html.duckduckgo.com` (`OJ:backend/scripts/build-comeet.mjs:1-60`).
6. **Community additions.** Earlier, a `contributed-slugs.txt` took one
   `ats,slug` line per pull request (git `e8f734d:CONTRIBUTING.md`).

### Orchestration

- **Schedule.** A daily cron `0 0 * * *` makes one Registry object per
  provider walk its slug list, 250 slugs a tick, 25 at a time
  (`OJ:backend/DOCS.md:20-23,66-70`). Each board then fetches once a day at a
  fixed slot, `fnv1a(name) % 24h`, which spreads load evenly
  (`OJ:backend/DOCS.md:32`).
- **Dead boards.** A `gone` result or error is recorded, never thrown. After 5
  failures in a row the board runs weekly (`OJ:backend/src/board.ts:16-17,603-604`).
  SmartRecruiters answers 200 with zero jobs for an unknown company, so a zero
  result probes `careers.smartrecruiters.com/{slug}`; a redirect to the root
  means gone (`OJ:backend/src/ats/smartrecruiters.ts:43-55,113`). Workday
  answers 422, 404 or 500 to an unknown tenant's `robots.txt`
  (`OJ:backend/src/ats/workday.ts:29-34`). 15–40% of crawled slugs were dead
  (`OJ:backend/DOCS.md:606`).
- **Diffs and storage.** Each board keeps a SQLite table of jobs keyed by
  provider id with a content hash; a missing job gets `removed_at`, never
  deleted. Open jobs go to R2 as Parquet; a nightly job merges them
  (`OJ:backend/DOCS.md:1-8,48-60`).
- **Detail fetches.** Providers whose list lacks the description fetch each
  new posting once (`OJ:backend/src/ats/types.ts:58`).
- **Dedupe across boards.** Key = normalized employer + title + location;
  first-party boards win over aggregators (`OJ:backend/src/dedupe.ts:3-24`).
  A `dark` board naming more than 2 hiring organizations is treated as a job
  board, not an employer (`OJ:backend/scripts/build-parquet.py:185-192`).
- **Blocked hosts.** JobScore and GovernmentJobs block Cloudflare's IPs, so a
  laptop fetches them (`OJ:backend/src/ats/index.ts:87-92`).

### Filtering

None at scrape time: it stores every posting. Seniority is a title regex
applied later, with levels `intern` and `junior` (junior matches `entry level`,
`graduate`, `new grad`, `trainee`, `apprentice`, `associate`, `assistant`, `I`)
(`OJ:tools/seniority.py:11-43`).

### Clever parts

- **Workday career sites from `robots.txt`.** A tenant's `robots.txt` lists
  each site as `Allow: /<site>/` or `Sitemap: .../<site>/siteMap.xml`, so one
  host yields every site the tenant runs (`OJ:backend/src/ats/workday.ts:29-51`).
- **SuccessFactors' Google-Jobs RSS** at `/sitemap.xml` gives the whole board
  with descriptions in one request (`OJ:backend/src/ats/successfactors.ts:4-11`).
- **Generic JSON-LD sitemap crawler** (`dark`): read `robots.txt` and common
  sitemap paths, keep URLs that look like job pages, then read each page's
  `JobPosting` JSON-LD (`OJ:backend/src/ats/dark.ts:4-60`).
- **A render farm was tested and rejected.** Rendering 200 single-page-app
  sites recovered about zero extra JSON-LD (`OJ:backend/CRAWLER.md:93-108`).

## freehire: how it scrapes

Go 1.26 (`FH:go.mod:3`), Postgres, one adapter file per provider. 320
registered sources; 3,371,563 open postings from 477,323 companies on
2026-10-20 (`FH:README.md:65-68`, `FH:docs/sources.md:1-10`). The number of
company job boards is not published in the repo: **unverified**.

### Per hiring system

| Hiring system | Endpoint | Pagination | Field mapping (title / location / description / date / apply URL) | Cite |
|---|---|---|---|---|
| Greenhouse | `https://boards-api.greenhouse.io/v1/boards/{board}/jobs?content=true`; company "about" from `/v1/boards/{board}` | none | `title` / `location.name` / `content` (unescaped, sanitized) / **`updated_at`** / `absolute_url` | `FH:internal/ingest/sources/greenhouse.go:17,35-66,122-129` |
| Lever | `https://api.lever.co/v0/postings/{board}?mode=json`, or `api.eu.lever.co` for EU boards | none (one array) | `text` / `categories.location` / assembled body / `createdAt` (ms) / `hostedUrl` | `FH:internal/ingest/sources/lever.go:9-14,39,88-96` |
| Ashby | `https://api.ashbyhq.com/posting-api/job-board/{board}?includeCompensation=true` | none | without the flag the API drops pay | `FH:internal/ingest/sources/ashby.go:9,27-29` |
| Ashby (GraphQL) | `POST https://jobs.ashbyhq.com/api/non-user-graphql`, list then one detail query per posting | none | only for boards whose posting API is disabled | `FH:internal/ingest/sources/ashbygraphql.go:8-21` |
| Workable | `https://apply.workable.com/api/v1/widget/accounts/{board}?details=true` | none | `title` / city, state, country / `description` / `published_on` / `url` | `FH:internal/ingest/sources/workable.go:9,27,51-58` |
| SmartRecruiters | `https://api.smartrecruiters.com/v1/companies/{board}/postings`, then a detail per posting | `offset` to `totalFound` | maps `experienceLevel` to seniority; fetches detail only for postings not stored | `FH:internal/ingest/sources/smartrecruiters.go:10-46,86-89` |
| Workday | `POST https://{host}/wday/cxs/{tenant}/{site}/jobs`; detail `GET /wday/cxs/{tenant}/{site}{path}` | 20 a page; a board reporting exactly 2,000 is split by facets, up to 3 dimensions deep | board id = `host/site`; detail only for new postings | `FH:internal/ingest/sources/workday.go:13-33,40-66,117-137` |
| BambooHR | `https://{board}.bamboohr.com/careers/list`; detail `/careers/{id}/detail` | none | a redirect off `/careers` = board gone | `FH:internal/ingest/sources/bamboohr.go:60,96,120`, `FH:internal/ingest/sources/AGENTS.md:30-32` |
| iCIMS | `https://{host}/sitemap.xml`, then `/careers-home/jobs/{id}?in_iframe=1` | none | | `FH:internal/ingest/sources/icims.go:72,108` |

The long tail is 372 adapter files: ATSs, national job boards, aggregators and
single-company sites (`FH:internal/ingest/sources/`). Largest by open postings:
Workday 596,262, Oracle 287,895, SmartRecruiters 154,777, SuccessFactors
119,466, Greenhouse 119,207, UKG 117,364 (`FH:docs/sources.md:27-40`).

### Company discovery

freehire has one validator and many candidate sources. Every source writes a
seed file; `cmd/harvest-boards` probes each new slug against the platform's
own API and keeps it only if it returns jobs. Kept boards enter as `pending`
until a real crawl succeeds (`FH:cmd/harvest-boards/main.go:1-29`).

1. **Common Crawl CDX index (automatic, per provider).** It reads
   `https://index.commoncrawl.org/collinfo.json`, takes the 3 newest
   snapshots, asks each for the page count (`showNumPages=true&pageSize=1`),
   then reads up to 40 pages of
   `{cdx-api}?url={pattern}&output=json&page=N&pageSize=1` and slices each URL
   to a slug (`FH:cmd/harvest-boards/commoncrawl.go:16-35,95-193`). Patterns:
   `boards.greenhouse.io/*` and `jobs.ashbyhq.com/*`, slug = first path
   segment (`FH:cmd/harvest-boards/prober.go:122-134,232-241`);
   `*.myworkdayjobs.com` with no path glob (with one, the index answered 502),
   sliced to `host/site` after dropping locale and non-site segments
   (`FH:cmd/harvest-boards/workday_discover.go:9-60`); and about 15 EU
   systems such as `*.bizneo.cloud` and `*.homerun.co`.
2. **Probe and name.** Greenhouse's probe reads `/jobs` and, if non-empty, the
   board's `name`; Lever and Ashby read the storefront page title
   (`FH:cmd/harvest-boards/prober.go:70-230,440`). A seed may claim a company
   name or a posting id (`expect_id`); an id the board must carry is proof, a
   name is only a resemblance (`FH:cmd/harvest-boards/expectid.go:11-51`).
   Slugs are case-folded before dedupe (`FH:cmd/harvest-boards/prober.go:136-140`).
3. **Following company websites (`harvest-ats`).** Company lists with
   websites go to each careers page, where `atsdetect` finds a hiring-system
   link by URL shape (`FH:cmd/harvest-ats/main.go:1-13`,
   `FH:internal/ingest/atsdetect/atsdetect.go`). Lists used: Y Combinator
   (`yc-oss.github.io/api/companies/all.json`), a unicorn list, Fortune 500
   2023, Techstars, and a university-domains list
   (`FH:internal/job/collections/collections.go:406-414`,
   `FH:cmd/harvest-ats/extract.go:37`).
4. **Following aggregator apply links (`harvest-role`).** Walk role.com's
   sitemaps, follow each posting's apply link, and resolve it to a board
   (`FH:cmd/harvest-role/main.go:1-13`).
5. **Guessing slugs from names (`harvest-orphans`).** For companies seen only
   through aggregators, propose five spellings of the name (slug, hyphenated,
   joined, each with a legal suffix cut); the probe's name gate rejects
   mismatches (`FH:cmd/harvest-orphans/main.go:1-14`,
   `FH:cmd/harvest-orphans/candidates.go:28-80`).
6. **LinkedIn job search (`harvest-linkedin`).** Pages LinkedIn's public job
   search to find hiring employers, their websites and their ATS posting ids
   (`FH:cmd/harvest-linkedin/main.go:1-17`). LinkedIn's `robots.txt` forbids
   automated access without permission (checked live 2026-10-28).
7. **One by one.** A curator or a site form adds a row with
   `cmd/add-board` (`FH:README.md`, "Adding a source").

### Orchestration

- **Schedule.** One run-once process per provider, launched by a scheduler
  that claims a due provider in Postgres; default cadence 2 hours
  (`FH:internal/ingest/ingestsched/settings.go:22-42`,
  `FH:internal/ingest/ingestsched/AGENTS.md:1-40`).
- **Rate limits.** A 429 holds the whole host: `Retry-After`, else 1 s
  doubling to 60 s, reset by a 2xx (`FH:internal/ingest/sources/AGENTS.md:11`).
  Discovery probes take `-pace` and `-workers` (default 16)
  (`FH:cmd/harvest-boards/main.go:47-60`).
- **Proxies.** Some providers go through `SOURCES_PROXY_URL` because their
  edge blocks the server's IP (`FH:internal/ingest/sources/AGENTS.md:56`).
- **Dead boards.** After 3 failures in a row a board cools down 6 h, doubling
  to 24 h, never for good (`FH:internal/ingest/pipeline/cooldown.go:6-14`).
  `close-chronic-boards` closes postings of a board unreachable for 60 days,
  or answering empty for 30 days (`FH:cmd/close-chronic-boards/main.go:37,47`).
- **Closing postings.** A posting unseen for 48 h closes; it reopens if seen
  again (`FH:internal/ingest/sources/AGENTS.md:61`). Only an adapter that
  proves it read the whole board may close per board (`fullBoardListing`).
- **Dedupe.** `UNIQUE (source, external_id)` with an upsert
  (`FH:internal/ingest/sources/AGENTS.md:27`).

### Filtering

It keeps every posting a title dictionary can file under a category, IT or
not, and drops non-technical titles no category reaches
(`FH:internal/ingest/pipeline/catalogue_fit.go:12-16`). Seniority comes from
structured fields where they exist (SmartRecruiters' `experienceLevel`), else
from a title dictionary (`FH:internal/ingest/sources/smartrecruiters.go:34-46`).
No early-career filter at scrape time.

### Clever parts

- **Workday's 2,000 cap.** Some tenants report `total = 2000` and loop back to
  page 1 past offset 2,000. freehire splits such a board by facets, recursing
  up to 3 dimensions (`FH:internal/ingest/sources/workday.go:13-33`).
- **Detail only for new postings** (Workday, SmartRecruiters): a seen posting
  is refreshed from the list alone (`FH:internal/ingest/sources/workday.go:123-133`).
- **Evidence-based board matching** with `expect_id` (above).
- **Generic sitemap plus JSON-LD adapter** (`FH:internal/ingest/sources/sitemapldjson.go:16-21`).

## Side by side

| | open-jobs | freehire | WorkIt today |
|---|---|---|---|
| Language, host | TypeScript, Cloudflare Workers (stopped 2026-10-10) | Go, Postgres, systemd | Python stdlib, GitHub Actions |
| Hiring systems | 36, incl. Greenhouse, Lever, Ashby, Workable, SmartRecruiters, Workday, BambooHR, Paylocity, Paycom, Dayforce, UKG, Oracle, iCIMS, SuccessFactors (`OJ:backend/src/ats/index.ts:47-85`) | 372 adapter files, 124 ATS platforms (`FH:README.md:65-67`) | 13: Greenhouse, Lever, Ashby, Workable, Recruitee, BambooHR, Rippling, iCIMS, Oracle, TikTok, Jibe, SuccessFactors, Workday (`WI:scraper/workit_scraper/providers/systems/`) |
| Discovery | Common Crawl CDX index (one-off, script not published), Web Data Commons JSON-LD, LLM web search, rebuilt from its own fleet | CDX index per provider, website following, aggregator apply links, name guessing, LinkedIn; one validator with a name or id gate | Curated GitHub lists (SimplifyJobs, vanshb03, crypto-jobs-fyi), HN "Who is hiring", optional GitHub/Google/DDG search; daily review PR (`WI:scraper/docs/discovery.md:8-15,82-99`) |
| Board count | 75,660 live + 38,646 gone (`OJ:slugs.json:150`) | not in repo (unverified) | 4,296 rows: Workday 1,723, Greenhouse 893, Ashby 716, Lever 360, Workable 195, Oracle 185, Jibe 93, SuccessFactors 82, BambooHR 46, Recruitee 2, TikTok 1 (`WI:scraper/boards.csv`, counted 2026-10-28) |
| Schedule | each board daily at a hashed slot | each provider every 2 h | scrape every 3 h (`17 */3 * * *`), discovery daily (`43 5 * * *`) (`WI:.github/workflows/scrape.yml:9`, `WI:.github/workflows/discover-boards.yml:5`) |
| Dead boards | weekly after 5 failures | cool-down 6–24 h; close after 60 days unreachable / 30 days empty | rest 6–24 h after 3 misses; "no such board" twice closes (`WI:scraper/CLAUDE.md:373-389,441-450`) |
| robots.txt | not checked by the adapters read (unverified for all) | not checked by the adapters read (unverified for all) | checked on every origin; 5xx or unreachable = disallow (`WI:scraper/CLAUDE.md:390-421`) |
| Filtering | none at scrape; title seniority regex later | catalogue-fit by title dictionary | early-career stage words, every field (`WI:scraper/CLAUDE.md:300-309`) |

Overlap with WorkIt's boards, by lower-cased token (computed 2026-10-28):

| Hiring system | open-jobs live | WorkIt | open-jobs boards WorkIt lacks |
|---|---:|---:|---:|
| Workable | 6,818 | 195 | 6,670 |
| Greenhouse | 5,470 | 893 | 4,697 |
| BambooHR | 2,961 | 46 | 2,941 |
| Recruitee | 2,603 | 2 | 2,601 |
| Ashby | 2,908 | 716 | 2,399 |
| Workday tenants | 3,400 | 1,494 | 2,044 |
| Lever | 2,203 | 360 | 1,874 |

## What WorkIt could adopt

Ranked by gain per unit of effort. Every idea keeps the scraper
standard-library-only and away from the database. "Postings" gains are
guesses: WorkIt keeps only early-career roles, about 2% of what it scans
(`WI:scraper/CLAUDE.md:161-162`), so real gains need a live run to measure.

### 1. Seed discovery from open-jobs' `slugs.json`

- **What.** Add `slugs.json` as a discovery source in
  `discovery_sources.py`, for the systems WorkIt already reads. Each slug goes
  through the existing validator and review PR.
- **From.** `OJ:slugs.json` (CC0, `OJ:LICENSE`); open-jobs mined it from
  Common Crawl (`git 1ba1b27:slugs.json:2`).
- **Effort.** Small for the source (one file read from
  `raw.githubusercontent.com`, which has no `robots.txt`: 404, checked live).
  Medium for the review flow: `slugs.json` has no company names, and WorkIt
  refuses to make a name from a slug (`WI:scraper/CLAUDE.md:507-509`). The team
  must decide whether the platform's own name counts as evidence:
  Greenhouse's `/v1/boards/{slug}` `name`, Workable's account name, or the
  storefront title, as freehire does (`FH:cmd/harvest-boards/prober.go:97-120,168-230`).
  The daily validation limit of 20 (`WI:scraper/docs/discovery.md:13-15`) would
  take years for ~21,000 boards; a one-off laptop run is needed.
- **Gain.** Up to ~21,000 new boards (table above), about 6× today. The data
  is from 2026-09-08 and 15–40% of crawled slugs were already dead then
  (`OJ:backend/DOCS.md:606`). Most of the new boards will hold no early-career
  role; WorkIt's quiet-board rest already makes those cheap
  (`WI:scraper/CLAUDE.md:422-433`).
- **Risks.** Review load: thousands of rows cannot be read one by one, so the
  review rule needs a decision (sampling, or trusting a platform-reported name).
  Run time: each board costs at least one request per read, so ~21,000 more
  boards add ~21,000 paced requests to a full run, before rest. Recruitee and BambooHR give
  one host per company, so robots.txt reads grow by thousands.

### 2. Find every Workday career site of a known tenant from its robots.txt

- **What.** WorkIt already reads each Workday tenant's `robots.txt`
  (`WI:scraper/docs/workday.md:64-72`). Parse its `Allow: /<site>/` and
  `Sitemap: .../<site>/siteMap.xml` lines and propose each site not in
  `boards.csv`. Many tenants run a separate site for students or early careers.
- **From.** `OJ:backend/src/ats/workday.ts:29-51`; freehire notes a tenant
  runs several sites, each its own pool (`FH:cmd/harvest-boards/workday_discover.go:15-20`).
- **Effort.** Small: no new requests, a parser and a discovery channel.
- **Gain.** Unverified count; up to 1,494 tenants to check. High fit for
  early-career roles if student sites are common. The company name is already
  known from the tenant's existing row.
- **Risks.** Low. Some sites are internal or for one region; review still
  applies.

### 3. A robots-compliant way to Common Crawl: Web Data Commons

- **What.** WorkIt rules out Common Crawl because `index.commoncrawl.org`
  and `data.commoncrawl.org` disallow every bot (`WI:scraper/CLAUDE.md:681-685`).
  Re-checked 2026-10-28: the index allows only `/collinfo.json` and a few
  pages; the data host says `Disallow: /`. So freehire's and open-jobs' CDX
  method is not open to WorkIt. Web Data Commons publishes the `JobPosting`
  extraction of Common Crawl as files, and its download host allows all
  (`data.dws.informatik.uni-mannheim.de/robots.txt`: `Allow: /`, checked live).
  Stream the gzip N-Quads, keep source URLs on supported hiring-system hosts,
  slice them to tokens, and send them to the validator.
- **From.** `OJ:backend/CRAWLER.md:19-41`.
- **Effort.** Medium. The 2024-12 JobPosting subset is 4.86 GB in 14 files,
  3.6M URLs on 63,320 hosts (webdatacommons.org stats page, checked live).
  `gzip` and line parsing are stdlib. Run it on a laptop, not in Actions.
- **Gain.** Unverified. It finds only hiring-system pages that serve JSON-LD
  statically (Greenhouse and Lever job pages; Ashby's are rendered by script,
  unverified). The newest release may be older than 2026 (unverified), so
  expect many dead slugs.
- **Risks.** Stale data; large download; same company-name problem as idea 1.

### 4. Seed from company lists through their websites

- **What.** Take lists with websites (Y Combinator's `yc-oss` API, Fortune 500),
  fetch each careers page, and detect the hiring-system link by URL shape.
  WorkIt's `build_boards.py --resolve` already proves boards from careers pages
  for Greenhouse and iCIMS (`WI:scraper/CLAUDE.md:483-490`).
- **From.** `FH:cmd/harvest-ats/main.go:1-13`,
  `FH:internal/job/collections/collections.go:406-414`.
- **Effort.** Medium. One more discovery channel; reuses `board_keys`.
- **Gain.** Unverified. Y Combinator companies lean to Ashby, Greenhouse and
  Lever, which WorkIt reads; they hire interns. Names come with the list, so
  review is simpler than idea 1.
- **Risks.** Thousands of company hosts, each with its own `robots.txt`;
  static fetch misses script-only careers pages.

### 5. Read the Workday boards past the cap with a deeper facet split

- **What.** WorkIt splits a capped Workday board by one facet; 22 of 39 split
  that way, and boards over `WORKDAY_MAX` (5,000) are skipped
  (`WI:scraper/docs/workday.md:25-48`). freehire recurses up to 3 facets and
  fetches details only for new postings.
- **From.** `FH:internal/ingest/sources/workday.go:13-33,123-133`.
- **Effort.** Medium.
- **Gain.** The biggest employers (Accenture, NVIDIA-sized boards), which hire
  many new graduates. Count unverified.
- **Risks.** Many requests to one tenant; WorkIt's 12-minute Workday budget.

### 6. Name guessing against the probe, for companies WorkIt already knows

- **What.** For a company with a board on one system, try its name as a slug
  on Greenhouse, Lever, Ashby and Workable; keep a hit only when the platform's
  name matches, or when a known posting id is on the board.
- **From.** `FH:cmd/harvest-orphans/candidates.go:28-80`,
  `FH:cmd/harvest-boards/expectid.go:11-51`.
- **Effort.** Small to medium.
- **Gain.** Low to medium; companies seldom run two hiring systems at once.
- **Risks.** A wrong match puts one company's name on another's postings; the
  id check is the safe form.

### Measured: a 500-board sample of idea 1 (2026-10-29)

500 boards drawn at random (seed 446) from the ~21,300 `slugs.json` boards
WorkIt lacks on Workable, Greenhouse, BambooHR, Recruitee, Ashby and Lever,
in proportion to each system's count. Each was read once through
`board_read.read_board`, and its titles run through `shortlist.pick`. Titles
only, so the share is a floor: the description fallback did not run.

| Hiring system | Sampled | Read | No such board | Unread | With a kept posting | Share of read |
|---|---|---|---|---|---|---|
| Workable | 157 | 148 | 9 | 0 | 14 | 9% |
| Greenhouse | 110 | 106 | 4 | 0 | 14 | 13% |
| BambooHR | 69 | 67 | 1 | 1 | 7 | 10% |
| Recruitee | 61 | 39 | 0 | 22 | 1 | 3% |
| Ashby | 59 | 55 | 4 | 0 | 3 | 5% |
| Lever | 44 | 42 | 2 | 0 | 2 | 5% |
| **All** | 500 | 457 | 20 | 23 | 41 | **9%** (about 6–12%) |

- 123 kept roles in 41 boards, from 8,937 postings scanned.
- 20 of 61 Recruitee boards are closed to us by the company's own robots.txt.
- 131 of 457 read boards list nothing at all (81 of them on Workable).
- About a third of the boards with a kept role are outside the US by their
  titles (Werkstudent, "m/w/d", Amsterdam, a Czech speaker).
- Scaled to the pool: about 1,800 boards and 5,000 roles today, against
  18,000 roles in the feed of 2026-10-28.
- Seen in passing: "Snr Process Engineer - Early Career" was kept, because
  `shortlist.SENIOR` names neither "Snr" nor "Sr".

### New hiring systems, by open-jobs' board counts

Not ranked above because the early-career yield is unverified and these
serve mostly small and hourly employers. robots.txt checked live 2026-10-28:

- **Paylocity** (9,879 live boards, `OJ:slugs.json:90-93`): `recruiting.paylocity.com/robots.txt` is a 404, so no rules.
- **Paycom** (6,602): `www.paycomonline.net` disallows `/` but allows `/v4/ats/web.php/portal/` and `/api/ats/job-postings/`.
- **Breezy** (3,287): tenant `robots.txt` blocks only asset folders.
- **Dayforce** (1,740): `jobs.dayforcehcm.com/robots.txt` has no rules.
- **UKG** (2,598): **blocked for WorkIt**. `recruiting.ultipro.com` disallows
  `*/JobBoardView`, the path open-jobs posts to
  (`OJ:backend/src/ats/ukg.ts:8`).
- **SmartRecruiters** stays out: `api.smartrecruiters.com` allows only
  LinkedInBot (checked live, as `WI:scraper/CLAUDE.md:53-55` records).

### Do not adopt

- **LinkedIn harvesting** (freehire): its `robots.txt` forbids automated access.
- **DuckDuckGo HTML scraping** (open-jobs' Comeet lookup): search results as
  a data source are against WorkIt's review rule, and its terms are unverified.
- **Proxies to get past IP blocks** (freehire): a block is the site's answer;
  WorkIt reports it in `metrics.json` instead (`WI:scraper/CLAUDE.md:671-677`).
- **Scrape-time filtering removal**: both projects store everything because
  they serve every job seeker. WorkIt keeps only what it shows.
