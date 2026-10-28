# Providers — notes per hiring system

How each of Workable, Recruitee, BambooHR, Rippling, iCIMS, Oracle, TikTok, Jibe and SuccessFactors is read, and the quirks found adding them. Reached from `../CLAUDE.md`, "Adding a provider"; Greenhouse, Lever and Ashby are documented in their own modules under `workit_scraper/providers/systems/`, and Workday in `workday.md`.

## Workable, Recruitee and BambooHR (KAN-171)

Added 2026-10-10. All three allow us: `apply.workable.com` disallows nothing, each
`{company}.recruitee.com` only `/v/` and each `{company}.bamboohr.com` only its embed
scripts. Each reader's test (`tests/test_providers.py`) is built from that day's real
responses.

What they added that day, on a run with no store yet (so every board read): the
curated lists named 178 Workable boards, 42 BambooHR and 2 Recruitee (1X has since
left Recruitee), and all the rest answered. They held 4,858, 1,487 and 58 postings,
and 34, 18 and 0 roles reached the feed (of 1,217). Recruitee is that small because
nine of the lists' ~37,000 apply links point at it, at two companies; it stays
because a board costs one request a run. The run took 3.4 minutes
the second time, still Lever's pace; the 45 extra robots.txt reads add 7.5 seconds up
front, read one after another.

- **Workable** lists through the careers widget Workable documents for embedding
  (`/api/v1/widget/accounts/{slug}`) and reads a kept posting's page from
  `/api/v2/accounts/{slug}/jobs/{shortcode}`, what its own careers page reads. Only
  the page says hybrid (`workplace`) and pay (`salary_from`, `salary_to`,
  `salary_frequency`); the widget has just a `telecommuting` flag. The widget lists
  a job once per location under one shortcode (Trexquant's C++ engineer: a Stamford
  row and a New York row), so rows are merged on it. A location marked `hidden`
  stays hidden, though the row's top-level city still names it (Hugging Face's
  "EMEA Remote" roles hide Paris). `published_on` is the date, not `created_at`:
  Flexcompute's CFD developer was created in 2024 and posted in 2026.
- **Recruitee** sends everything in one list (`/api/offers/`). The location is the
  place names the employer typed (`locations[].name`); the split city and state
  beside each are a form's defaults (Hard Rock Digital's "United States" has the
  city "United States" in Florida), and `location` is just "Remote job" on any
  remote posting. Three work-style flags can be set together; remote wins, since a
  job that may be done remotely is what a remote filter is for. Salary amounts are
  strings. A company that left Recruitee (1X) still answers `/api/offers/` with a
  404, but its robots.txt redirects to recruitee.com, which `polite` reads as
  disallow, so such a board shows as "skipped, robots.txt disallows us", not "no
  such board". Harmless (it has nothing to list) and left that way.
- **BambooHR** lists `/careers/list` and reads a kept posting's
  `/careers/{id}/detail` for its description, `datePosted`, `locationType` (`0` on
  site, `1` remote, `2` hybrid: read off postings that say which) and
  `compensation`, which is free text ("$90,000 to $115,000", "$25-$30/hour"): it is
  given a "Compensation:" label and read by `details.pay`. A slug that is not a
  board redirects to www.bamboohr.com instead of a 404, which `bamboohr()` turns
  into `BoardNotFound`.

Workable's and BambooHR's logos are read (`logos.md`); BambooHR's careers page
carries its logo as JSON, served as `application/octet-stream`, which next/image
accepts because it sniffs the bytes. Recruitee's sits inside a 1 MB board page for
the one board we read, so its cards show initials.

## Rippling (KAN-301)

Added 2026-10-26. About 165 companies in the curated lists use it (268 apply links
on `ats.rippling.com`). Its robots.txt disallows only `/internal/`.

- **The API is what its careers page reads, not a documented one** (an accepted
  risk, like Workday's): `GET /api/v2/board/{slug}/jobs?page=0&pageSize=1000` lists
  a board, and `GET /api/v2/board/{slug}/jobs/{id}` is one job's record. The page's
  own client caps `pageSize` at 1,000, so one request reads a board; one that
  reports a second page is skipped as too large rather than read in part. The
  largest of the 7 boards read on 2026-10-26 had 102 postings. A missing board is a
  404.
- **The list has a job once per office, under one id** (Kraken Robotics'
  internships: Mount Pearl and Dartmouth), so rows are merged on it, as Workable's
  are, and their places joined with "; ".
- **Only the list states the work model** (`workplaceType`: `ON_SITE`, `REMOTE`,
  `HYBRID`, per office), and only the record has the description, the date
  (`createdOn`), the employment type and the pay. So the reader carries the list's
  work model on `Job.work_style` to the record's read. The location is no
  substitute: a remote office is often named only "NY" or "Chicago". Remote wins
  over hybrid over on site across offices, as on Recruitee.
- **The description comes in two parts**, `company` and `role`, each HTML. The
  company's part goes first, as the page shows them, and often holds the title and
  location lines too. `employmentType.id` is the readable one ("Salaried,
  full-time"); `payRangeDetails` has a range per office with `currency` and
  `frequency` ("YEAR"), and the card takes the widest when all share both.
- **No logo**: the board's logo is a signed URL on `secured-assets.ripplingcdn.com`
  with an `Expires` parameter, so a stored one would stop loading. Its cards show
  initials.
- A company's own board can redirect off Rippling (`rippling` itself goes to
  rippling.com); `web.get` refuses the cross-origin redirect, so it reads as a
  failed board.

## iCIMS (KAN-301)

Added 2026-10-26. About 320 companies in the curated lists use it (1,471 apply
links), many in defense and government work. Each company is its own host,
`{prefix}-{company}.icims.com`, and the prefix varies (`careers-`, `career-`,
`external-`), so the token is the whole host label. Every host's robots.txt read
that day names its sitemap and disallows only referral, login, candidate and
connect pages; Charles Schwab's disallows everything, so it is skipped.

- **A board is its sitemap**, `/sitemap.xml`: every open job's URL, in one request,
  where its own search pages take one request per 20 jobs. It was complete: General
  Dynamics Mission Systems' listed 723 jobs, exactly the 36 full search pages and 3
  on the last, with every searched job in it. Peraton's listed 1,403. A missing
  company is a 404. Anything that is not a `<urlset>` (an index of sitemaps) is a
  failed read, never an empty board.
- **The list names a job only by its URL**, `/jobs/{id}/{slug}/job`. The slug read
  as words ("reliability engineering intern") classifies the same as the real
  title, so only kept jobs' pages are read, and the page's title replaces the slug
  for good (`Provider.page_title`, `store.carry`). One word needed its hyphen:
  "co-op" read as "co op", which the filter does not know, so every co-op was
  dropped (7 at Peraton, 5 at General Dynamics); `_icims_title` writes it
  "coop". Check a new stage word against a slug before trusting the slug.
- **A job's page carries a schema.org `JobPosting`** (`<script
  type="application/ld+json">`), which search engines read too: the title,
  `datePosted`, `employmentType` (`FULL_TIME`, or `OTHER` for many internships),
  the places (`jobLocation[].address`) and the description as HTML. iCIMS writes
  "UNAVAILABLE" in a field the employer left empty; such parts are left out. The
  page is read at `/jobs/{id}/job?in_iframe=1`, the page inside the careers site's
  frame. Pay is read from the description: General Dynamics states it there
  ("$22.50 per hour").
- **No logo yet**: the page names only the company's website
  (`hiringOrganization.sameAs`), often "UNAVAILABLE". Its cards show initials.
- **robots.txt is read as each host is reached**, not before the run, as for
  Workday: one paced read per host, in parallel across the lane. On the first live
  check one host's robots.txt failed to load and the board was skipped for that
  run, as an unreachable robots.txt must be.
- The first run reads every kept job's page once (102 at General Dynamics, 32 at
  Peraton), so it is longer than the runs after it.

## Oracle Cloud (KAN-301)

Added 2026-10-26. About 190 companies in the curated lists use Oracle Recruiting
(2,777 apply links): Texas Instruments, Honeywell, JPMorgan Chase, insurers and
retailers. Each company is a tenant with its own host, `{id}.fa.{dc}.oraclecloud.com`,
and one or more careers sites (`CX`, `CX_1001`, `Honeywell`), so the token is
`{host}/{site}`: `edbz.fa.us2/CX`. No tenant read that day had a robots.txt (a 404,
no rules). JPMC's answers a firewall's 403 to some requests and lists 7,245 jobs,
past `ORACLE_MAX`, so it is skipped.

- **The list is `recruitingCEJobRequisitions`**, what the careers page reads, with
  `finder=findReqs;siteNumber={site},...,limit=200,offset=n`. It answers at most
  200 a request whatever `limit` asks, and its first page carries the count
  (`TotalJobsCount`). A board is read whole like a Workday board, and like
  Workday's lane, Oracle's has a 12-minute budget, least recently read first.
- **The count can run one ahead of the list.** A grocer's board (`hdhe.fa.em3`)
  counted 404 and listed 403 on every way of paging it: both sort orders and page
  sizes of 100 and 200. Of the six boards read that day, four added up exactly and
  one listed 2,541 of 2,543. So a read is whole when it reaches the count less one
  in 500 (at least one); fewer is `Incomplete`.
- **A careers site's code keeps its case.** The list answers `cx` as `CX`, and an
  unknown code falls back to the tenant's default site, but a job's record leaves
  out the employer's own fields for any spelling but the site's own. Texas
  Instruments' pay is only there ("Base Range: $31.00 - $45.00 per hour"), so
  `build_boards.py` keeps the code as the apply link writes it
  (`Provider.keeps_case`). Two sites of one tenant list different jobs (Jackson's
  `CX_3` and `CX_5`), so each is its own board.
- **The list's date is a bare day, the record's an exact time**, and the record's
  wins over every later bare listing (`Provider.page_date`, as for Workday): before
  it, every Oracle role went back to midnight on its second run.
- **The list has the title, date, places and, where the employer fills it in, the
  work model** (`WorkplaceType`: "Remote", "On-site", "Hybrid"); the record does
  not repeat it, so it rides on `Job.work_style` as Rippling's does. The record
  (`recruitingCEJobRequisitionDetails`, `finder=ById;Id="{id}",siteNumber={site}`)
  has the description in parts (`ExternalDescriptionStr`, responsibilities,
  qualifications, `CorporateDescriptionStr`), an exact posting time, and
  `requisitionFlexFields`, each read as a "Prompt: Value" line so the pay reader
  finds a stated range.
- **No logo yet**: neither the list nor the record names an image or a website.
- A tenant that does not exist has no host at all, so its robots.txt cannot be
  reached and the board is skipped for the run, never read.

## TikTok, Jibe and SuccessFactors (KAN-369)

Added 2026-10-26 on the batch apply branch, so the internships on the systems
batch apply is learning to fill reach the catalog at all. Ranked by their share of
the SimplifyJobs Summer 2027 list's active postings: Oracle 9.4%, TikTok/ByteDance
8.8%, iCIMS 4.3%, SmartRecruiters 2.2%, SuccessFactors 1.8%. Each reader pages
(`Provider.paged`), and each read is whole or nothing (`Incomplete`), as Workday's
is. Modules: `systems/tiktok.py`, `systems/jibe.py`, `systems/successfactors.py`.
Tests: `tests/test_more_providers.py`, on that day's responses in
`tests/fixtures/providers/`.

**What the merge with KAN-301 kept and dropped (2026-10-27).** The branch wrote
Oracle, TikTok, iCIMS and SuccessFactors readers into the old single
`providers.py` while KAN-301 (PRs 237 and 238) split it into this package and
added its own iCIMS and Oracle readers. KAN-301's are the canonical ones:

- **Oracle**: the branch's reader was dropped, with its tests and its
  `oracle-list.json` and `oracle-detail.json` fixtures; `systems/oracle.py` reads
  every Oracle board. The branch's 185 Oracle rows in `boards.csv` stay: their
  token is the same `{host}/{site}`, case kept. Two things the branch's reader did
  that `oracle` does not, left for its owner to weigh: it filled
  `Job.department` from the list's `JobFamily` and the job type from the record's
  `JobSchedule`; and it stopped at an offset of 10,000, past which the search
  served nothing (egud.fa.us2/CX_1 counted 10,757), where `ORACLE_MAX` stops at
  5,000. Its whole-read rule differed too (a short last page with no overlap was
  whole); `oracle`'s one-in-500 rule stands.
- **iCIMS**: `systems/icims.py` reads a tenant's own `{prefix}-{company}.icims.com`
  sitemap. The branch read something else: the company's Jibe careers site
  (`careers.amd.com/jobs/{id}?icims=1`), whose host is no icims.com subdomain, so
  `icims` never matches those links. That reader is kept under its own `ats`,
  `jibe`, and the branch's 93 `icims` rows in `boards.csv` (every one a Jibe host,
  none an icims.com label) became `jibe` rows. A Jibe row's postings carry the
  tenant's icims.com form as their own `apply_url`, so a company with both a `jibe`
  and an `icims` row would list each job twice; none has both today.
- **TikTok** and **SuccessFactors**: nothing in KAN-301 reads them; ported as is.
  The one shared change is `fetch._post_json`'s `headers`, for TikTok's.

- **TikTok** is one board, `tiktok/lifeattiktok`: the POST lifeattiktok.com's own
  search makes, which answers "invalid request" without a `website-path: tiktok`
  header. About 4,300 postings, 200 a request, with descriptions; no date.
  ByteDance's own site, jobs.bytedance.com, is a separate list and timed out from
  here (as it did headless in SYSTEMS-gap), so it has no reader.
- **Jibe** (iCIMS postings) is read where the curated lists link it: a company's
  Jibe careers site (`careers.amd.com/jobs/{id}?icims=1`), whose `/api/jobs` lists
  every posting with its description, 100 a request. The board is the site's host.
  Only rows Jibe marks `ats_code: icims` are kept. Jibe sites publish
  `Crawl-delay: 5`. A site can list one posting twice (MasTec: 1,258 rows served,
  1,211 postings), so the rows served must add up to the count, and a twice-listed
  posting is kept once.
- **SuccessFactors** is read from a career site's own search page
  (`jobs.grainger.com/search/?q=&startrow=N`), HTML, as many rows a page as the site
  set (Grainger 35), and a kept posting's page for its description and exact date.
  The board is the host the lists mark `?ats=successfactors`. The search is sorted
  by title: in its default order Hershey's repeated 8 postings across pages and
  left 8 out, and by title all 328 were read once. Its count can run over what it
  serves, as Oracle's does, so a read that reached an empty page with no overlap
  is whole. On both, a read that saw every counted posting is whole even if pages
  overlapped: postings tied on the sort can swap between pages (Sonepar: 938 of
  938, some read twice; Oracle's ecvz.fa.us2: 1,418 of 1,418). Its robots.txt
  disallows the RSS feed (`/services/`), so the search page is the only list.
  A posting's id is its path, as on Workday: a bare id redirects to an error page.

Not read: **SmartRecruiters** (robots.txt disallows us, above); **Waymo** needs
nothing new, since its postings are on the Greenhouse board `waymo` (build_boards'
`EXTRA`), linked to its own careers site.

First full read, 2026-10-26, these 361 boards only, no store yet: 180,746 postings
scanned, and kept (internship or new-grad roles) TikTok 1,490 (1,049 internships),
Oracle 3,621 (1,621; read then by the dropped reader), iCIMS on Jibe 1,132 (867), SuccessFactors 546 (477). 17
SuccessFactors sites disallow us in robots.txt and 2 Oracle boards are past the
10,000 limit; 8 boards changed under the read (Incomplete), all large ones. The
feed validated against the backend's `JobListing`.
