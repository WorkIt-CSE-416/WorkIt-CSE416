# CLAUDE.md — scraper

The scraper's design and the rules for changing it; repo-wide rules are in
`../CLAUDE.md`, and `README.md` is only how to run it.

```sh
cd scraper
python3 -m workit_scraper              # scrape, then write the page, feed.json and metrics.json
python3 -m workit_scraper --full       # the same, quiet boards included
python3 -m workit_scraper --offline    # no network; rewrite both from jobs.json
python3 build_boards.py                # add the boards the curated lists name now
GROQ_API_KEY=... python3 label_headings.py  # label the headings no rule names
uvx pytest                             # the tests
```

**Run a live scrape in the background, unbuffered:**
`python3 -u -m workit_scraper --full > scrape.log 2>&1`. Without `-u`, Python
buffers output sent to a file, and the log stays empty until the run ends. A
full run takes about 10 minutes. `--offline` re-renders in seconds from
`jobs.json` with no network, but finds no new facts (see Card facts).

## How it fits together

```
boards.csv ─▶ __main__ ─▶ polite.Robots ─▶ providers.PROVIDERS ─▶ store.update ─▶ jobs.json
                                                                                   │
                           report.write_html ◀─ shortlist.pick ◀─ Store.is_listed ◀┘
                           feed.write ◀────────────┘  (feed.json ─▶ backend import ─▶ Supabase)
```

Each module owns one stage (its docstring says which); every network read goes
through `web.get` (or Workday's one `web.post`) behind `polite.Robots`. Every
provider but Workday returns a whole board in one request. Workday sends 20
postings a request, which changes how its boards are read: `docs/workday.md`.

## This package imports only the standard library

`dependencies = []` in `pyproject.toml` is load-bearing. `python3 -m
workit_scraper` has to work on a fresh clone with no install step, no
virtualenv and no `uv`: a demo that needs a dependency resolver first can fail
in the room. HTTP, JSON, CSV, robots.txt, threads and HTML escaping are all in
the stdlib.

pytest and ruff run as one-off tools (`uvx pytest`, `uvx ruff`), so nothing in
`workit_scraper/` may import either. `pythonpath = ["."]` is set because `uvx`
runs pytest where the package is not installed.

## Adding a provider

Read the provider's `robots.txt` before writing anything. SmartRecruiters is
absent because it disallows us, and that is the whole reason.

**Everything the scraper knows about a hiring system is one `Provider` in
`providers.PROVIDERS`**, keyed by its `ats`. It used to be eight tables in four
files (`LISTING_URL`, `JOB_URL`, `FETCHERS`, `PAGED`, `build_boards.PATTERNS`,
`logos.PAGE`, `logos.PATTERN`, `polite.SHARED_PACE`), and a provider missing from
one failed silently: the `.eu.` that `PATTERNS` missed dropped 26 companies.
`polite.SHARED_PACE` and `FOLD_CASE` are now read off the records. Field pairs a
reader needs together are tested (`TestProviderRecords`).

1. A reader in `providers.py` taking `(token, company)` and returning `list[Job]`.
   One that makes more than one request per board sets `paged`, takes `pace` and
   calls it before each request after the first (Workday's `workday`).
2. Its `Provider`: `listing_url` (which the reader and the robots check both
   read, so a board is never checked at one address and fetched at another),
   `read`, and `apply_link`, or none of its boards ever reaches `boards.csv`.
   Then what applies:
   - its list leaves out the description or a fact the posting's own page has:
     `job_url` and a `describe_<ats>` as `describe`;
   - robots.txt must allow another URL first: `careers_site` (Workday's);
   - each company is its own subdomain: `subdomains`, so they share one pace,
     and `case_blind` if its paths are;
   - its boards cannot all be read in one run: `budget_s`;
   - its list names a job only by its URL: `page_title` (iCIMS);
   - its token's case matters: `keeps_case` (Oracle's site codes);
   - its board page has a square logo: `logo_page` and `logo_pattern`, and the
     image host in `frontend/next.config.ts` (see Logos). If it names only the
     company's website: `logo_page` and a rule in `logos.extract` (Workday).
3. Its name and domain in `hiringSystems` in
   `frontend/src/app/(landing)/data.ts`: the landing page lists the hiring
   systems WorkIt reads, and that list must match `PROVIDERS`.

Tests that fake a provider's function swap its field with the `swap_provider`
fixture (`tests/conftest.py`): a `Provider` holds the function itself, so
patching the module's `describe_greenhouse` no longer reaches it.

Each reader's test is built from that day's real responses. Workable,
Recruitee, BambooHR, Rippling, iCIMS and Oracle quirks: `docs/providers.md`.
Workday's, and how its boards are read over several runs: `docs/workday.md`.

**Still open:** Rippling, iCIMS and Oracle (KAN-301) are read but not on the
landing page's `hiringSystems` yet: each needs its logo file in
`frontend/public/hiring-systems/` and a stream of real postings in `data.ts`.

- **A 404 means the board does not exist; a 200 with an empty list means a
  real board with nothing open.** Raise `BoardNotFound` for the first, return
  `[]` for the second. Collapsing them turns a typo in `boards.csv` into "this
  company stopped hiring", which nobody notices.
- **Providers disagree about types.** Lever sends `createdAt` as an `int` in
  some records and a numeric string in others; trusting one shape silently
  dropped every Lever board on the first live run. Normalise dates through
  `_iso()`. A time with no zone is UTC, never the machine's own.
- **A location that is only a work model is not a place.** Greenhouse has no
  work-model field, and Cloudflare names every location "In-Office";
  `Job.places` takes the city from the posting page's `offices`. Two cards
  that look identical are usually this, not a dedupe bug: `pick` keys on the
  apply URL on purpose.
- **The one exception: a Workday job on two careers sites is one role.**
  `shortlist.pick` merges Workday postings with the same company, tenant and
  requisition number (`_requisition`, the record's `jobReqId`), and the role
  links the copy on the site made for students (`_lead`). Only Workday, and
  only the same number at the same company: `docs/workday.md`.
- **The company name comes from `boards.csv`**, not the provider. Greenhouse's
  `company_name` carries internal labels ("DRW - University Jobs") that split
  one company's roles into several.

## A posting's own page is read once, and only for kept postings

A posting's own text is one value, `providers.Page`: the description (its kept
sections, cut to `DESCRIPTION_CHARS`), the card's `details.Facts`, and on Greenhouse
its offices (on Workday, its places and requisition number). Lever, Ashby and
Recruitee send it with the board's list. Greenhouse, Workable, BambooHR,
Rippling, iCIMS, Oracle and Workday do not (`Provider.job_url`): Greenhouse's `content=true`
would send hundreds of megabytes a run to describe the ~2% we keep, and
Workday's list has no description, exact date or places. So
`__main__.with_page` reads each *kept* posting's page once, through the same
robots and pacing.

- **A fact only the list states rides on the `Job` to the page read.**
  Rippling's list has each office's work model and its job's own record has
  none, so `rippling` sets `Job.work_style` and `describe_rippling` reads the
  page's facts with it. Read off the location instead, a remote job named
  "NY" would have been filed on site.
- **A title only a URL gave is replaced by the page's, and kept.** iCIMS's
  list is its sitemap, which names a job by its URL's slug
  ("reliability-engineering-intern"); that classifies the same, so only kept
  jobs' pages are read, and `describe_icims` sets the page's title.
  `Provider.page_title` makes `store.carry` keep it over the next listing's
  slug, or every card would read in lower case from the second run.

- **The store carries a `Page` forward whole: `job.page or old.page`.** It
  used to be nine fields carried one by one, and a Greenhouse title's "2027"
  overwrote the page's "Summer 2027". `posted_at` is carried the same way, for
  BambooHR, whose date is only on the page. Workday's is the reverse
  (`store.carry`): its list has a date counted back from "Posted 3 Days Ago",
  but the page's exact one wins, so a bare Workday listing keeps the stored
  date and never drifts by a day or vanishes at "30+ Days Ago".
- **Bump `providers.PAGE_VERSION` whenever a `Page` starts holding something
  new, or a fact's pattern changes**, or stored postings never get it.
  `with_page` re-reads any page under an older version, once per kept
  Greenhouse, Workable, BambooHR, Rippling, iCIMS, Oracle and Workday posting.
- **Changing `DESCRIPTION_CHARS` does not re-cut stored Greenhouse
  descriptions.** Clear them so the next run fetches them again:

```sh
python3 -c "import json; p='jobs.json'; d=json.load(open(p)); [j.__setitem__('description', None) for j in d['jobs'] if j['ats'] == 'greenhouse']; json.dump(d, open(p, 'w'), indent=1, sort_keys=True)"
```

## Card facts

The card's facts are read from the provider's own field where it has one, else
from the description by `details.py`; what neither states stays null and the
card says "not listed". Read `docs/card-facts.md` before changing `details.py`,
a fact rule in `shortlist.py`, or visa sponsorship: it has every rule with its
real posting and the measurements behind them.

- **Facts are read from the whole description at fetch time**, before it is
  cut. Pay is often the last thing a posting says. So `--offline` finds no new
  facts: a pattern change needs a live run and a `PAGE_VERSION` bump.
- **Only two facts are inferred, each by a measured rule:** work style
  (`shortlist._work_style`) and job type (`shortlist._job_type`: a silent
  new-grad role is full-time; an internship's type is never inferred). The feed
  row then writes every internship as the job type `internship` for the level
  `student` (KAN-233, `feed.py`), so its stated hours stay in its facts.
- **Every case in `tests/test_details.py` was seen in a real posting**, except
  `TestConstructedGuards`, which keeps review-built sentences no live posting
  said.
- **Measure a pattern change on the whole feed before trusting it:** compare
  every fact before and after, and read every *changed* value, not only newly
  filled ones. That caught three regressions.
- **`sponsorship`'s four values are part of the feed's contract** with
  `backend/app/schemas/jobs.py`: a new value is a change on both sides.

## Description sections

A stored description is its kept sections under fixed headings (KAN-229):
`providers._page` stores `cap(sections.kept(full))`. `sections.split` reads a
description into role, responsibilities, requirements, preferred, pay, benefits,
legal and the rest by its headings, and `kept` keeps the intro, Overview,
Responsibilities, Requirements, Preferred Qualifications, Pay and Details, then
the extras (`EXTRA`: Benefits, How to Apply, About the Company), in that order.
Only legal notices are left out. The extras are for the job posting's page,
shown last and folded; the backend's matching, keywords and Tailor stop at their
headings (`job_part`), so add a heading to `KEPT` and to the backend's
`_OTHER_HEADINGS` in the same change, or its text reaches matching. Read `docs/sections.md` before changing a pattern, a rule or `KEPT`:
it has the measurements, the heading audit that found the misses, and why each
section is kept or left out.

- **`KEPT`'s headings are part of the feed's contract.** The backend's
  `job_text` finds what matching reads by those exact lines; rename one on
  both sides in the same change.
- **A short line that names a section is not always a heading.** List items do
  it ("Commuter benefits", "Competitive salary"), so a heading of the open
  section, or one straight after a heading, is content. Without that, one
  posting's whole benefits list vanished.
- **The HTML's structure guides the sections.** `providers.plain_lines` gives
  each line its role in the HTML (heading tag, bold, list item, paragraph) beside
  `plain_text`'s unchanged text, and `kept(text, roles)` uses it: a list item never
  opens a section, a marked heading is read by its words alone, and a list item is
  stored as "• item". A provider that sends HTML passes the roles to `_page`; one
  that does not (Ashby's plain field) is read by shape as before.
- **Facts still come from the whole text.** `details.read` runs before
  anything is left out, so a pay line under Benefits still reaches the card.
- **Headings decide most lines, what a line says decides the rest**
  (`_sorted_lines`, `_said`): an inline "Overview: …" label moves its own line,
  a pay sentence goes to Pay from any section, an equal-opportunity line is
  dropped, a nice-to-have goes to Preferred Qualifications, a qualification in a
  duties list and a work-eligibility line go to Requirements, and a named perk
  and a how-to-apply line leave the job's sections for Benefits and How to
  Apply, and a work-eligibility line in an extra goes to Requirements (ASDA's
  right to work sat under "What you'll gain"). Each rule is kept only if it fixes more
  gold lines than it breaks, in both groups (`docs/sections.md`, fix 4).
  Re-run the heading audit and `kept(kept(text)) == kept(text)` on the whole feed
  after any change (`docs/sections.md`, "Fixes after the first review").
- **Hiding job text is worse than misfiling it.** A left-out section runs on
  until a heading a pattern names, so one unnamed heading after "About Us" hid
  SharkNinja's whole job, from the page and from search, matching, Scout and
  Tailor. Two rules stop that: a marked heading no pattern names ends the
  company's section and opens Overview, and a description that keeps under a
  tenth of its text is kept whole (`docs/sections.md`, "Hiding less job text").
- **A heading no pattern names is looked up in `learned_headings.json`**, the
  labels a model gave once (`label_headings.py`, Groq's `openai/gpt-oss-20b`
  with a key of its own, never Scout's, so a first run never spends Scout's
  quota). Patterns always win, and "none" keeps a line as content. **A learned
  label never sends job text where it should not go:** one naming legal cannot
  end a job section, and one naming an extra cannot end a section matching
  reads (out of Pay or Details it may). It is a committed file, never a call during the scrape: Groq
  takes about 30 requests a minute, a run reads thousands of pages, and each
  page is stored once. After a run, review the diff (a list item labeled as a
  heading splits its list), score the gold set with the per-label effect, set a
  label that loses gold lines to "none", and bump `PAGE_VERSION`, or stored
  postings never get the new labels (`docs/sections.md`, "Learned headings").
- **Correctness is scored against a gold test set** (`tests/test_sections_gold.py`,
  80 labeled postings in two groups: 50 from Greenhouse, Ashby and Lever, and 30
  from Workday, which is most of the feed): run its report after any change. It
  scores where each line shows and how much job text the stored text hides. Its
  floors only go up and its ceilings only come down; a change that worsens one is
  a regression even if it fixes the posting it was written for. The one
  exception is a trade recorded in the test and in `docs/sections.md`, as on
  2026-10-17.

## Filter changes need a real title

`shortlist.py` is where a bug is most silent: a loose pattern fills the page
with senior roles, a tight one empties it, and both look like a working
scraper. Every string in `tests/test_shortlist.py` was observed on a live board;
add cases the same way, from a title you saw, including ones that must be
rejected. Tag names are the `Tag` enum, which the page's filter chips read.

- **`engineer` alone is not a signal**, and reinstating it is the tempting
  mistake: Wade Trim's "Engineer Summer Intern" is civil, Decagon's
  "Engineering Intern" software, and nothing in either title tells them apart.
- `\bintern\b` must not fire on "Internal Applications". `SENIOR` beats the
  stage: "Junior/Senior or Staff Software Engineer" is not a new-grad role.
- **Twelve categories, up to two a role, plus specialties (KAN-172).** The
  first discipline a title names is its category (`CATEGORIES`, first match
  wins), and that order is the decision. Read `docs/categories.md` before
  changing a category, specialty, the stage or their order: it has the order's
  reasoning, what is held off, and the measurements.
- **A new role key is a change to `Tag` alone.** Since KAN-155 the backend
  ignores the feed's `roles`: it tags each job from its title with its own
  `job_roles` list (`backend/app/services/role_resolver.py`). The categories
  still decide what this scraper keeps.

## `first_seen_at` is written once

`store.update()` carries it forward; only `last_seen_at` moves. `posted_at` is
the employer's claim and can be re-stamped; our own observation cannot, which
is what makes it worth more.

## "New today" lives in `store.py`

`Store.is_new`: **first seen in the 24 hours up to the scrape, on a board we
had already read before.** A posting found on a board's first read was already
there, so it is never new. That one rule covers the first run, a board newly
added, and two runs on one day. Keep it over "new since the last run", which
drops the first run's arrivals on a same-day re-run and sums days when runs are
far apart. Until some board has an earlier read, `counts_new` is False and the
page prints "—". The page prints when it was scraped, so an `--offline` render
days later cannot pass off an old count.

Known limit: widening a `shortlist.py` pattern makes newly matching postings on
a watched board count as new once, because only matching postings are stored.

## Nothing closes; the page shows what the last complete read saw

A posting that disappears keeps its last `last_seen_at` and stays in
`jobs.json`. The scraper never retires a job, so it never wrongly retires one.

`Store.is_listed` keeps a posting only if it was on its board the last time we
read that board **in full**. **Only a complete listing is evidence that a
posting is gone**: a timeout, a partial read, or one board seen twice in one
run is not. Actually closing a posting is a real design for the ticket that
needs it: two accepted complete absences, at most one miss per board per run.

**A board we hold postings from that now answers "no such board" was read in
full, with nothing open** (`__main__.scrape`): a 404, Workday's 422 or
BambooHR's redirect home, when the company has left that hiring system. Counted
as no read until 2026-10-26, its postings stayed on the page for good. A board
never read that answers so is still unread (a typo has nothing to close, and
`Store.is_new` reads a board's first read). A spurious 404 closes the board's
jobs for one run; the next read lists them again and the import reopens them.

## Politeness is ours to enforce

Every request goes through `web.get` and, before it, `polite.Robots`,
including `build_boards.py`'s fetches from GitHub.

- `Robots` reads every origin's robots.txt once: up front for the origins it
  is given, and on first use, paced, for any other: the hosts of every provider
  with a host per company (`Provider.subdomains`: Workday's ~1,500, iCIMS's
  ~320, BambooHR's and Recruitee's), read in parallel as the lane reaches each.
  Per RFC 9309, a 4xx means no rules; a 5xx
  **or an unreachable robots.txt** means complete disallow for the run. An
  outage is not permission.
- A host whose paths are case-blind has its robots.txt read case-blind too
  (`polite.FOLD_CASE`, Workday): otherwise `Disallow: /CaterpillarCareers/`
  would not stop a request for `/caterpillarcareers/`.
- `Robots.pace()` paces **every** origin: a published `Crawl-delay` (Lever:
  one second), else `DEFAULT_DELAY_S`. Greenhouse publishes none, and ~1,800
  boards at eight in flight would otherwise run at ~60 requests a second.
- **A provider is paced as one host even when each company is its own
  origin** (`polite.SHARED_PACE`, for Recruitee, BambooHR and Workday hosts).
- `web.get` (and `web.post`, for Workday) refuses a cross-origin redirect:
  robots.txt was checked for the origin we asked for.

**Speed comes from lanes and quiet boards, never from less pacing.** One lane
per provider (`__main__.scrape`), so a worker waiting out Lever's delay never
blocks Greenhouse. Quiet boards rest (`Store.to_read`): a board that has never
had a kept posting is read on one run in `QUIET_EVERY`, staggered by key over
the run's three-hour slot (`RUN_EVERY`), and always after `QUIET_LONGEST` (a
day), so a first posting there can appear about nine hours late; `--full` reads
every board. A board with any kept posting ever is read every run. **Stagger by
run slot, never by day:** until 2026-10-26 it was by day, so a day's eight runs
read one third eight times, the next two days none of it, and a first posting
waited up to two days for the same number of requests. `RUN_EVERY` must match the
cron in `.github/workflows/scrape.yml`; if they drift, quiet boards are still read
on a third of runs, only less evenly spaced.

**A lane can have a time budget** (`Provider.budget_s`; Workday's and
Oracle's, 12 minutes each, run side by side). It starts boards from the front of `Store.to_read`'s order, least
recently read first, and once its time is up leaves the rest for a later run.
`--full` keeps the budget: it un-rests quiet boards, it does not make a Workday
sweep fit in one run. The page's "postings scanned" counts what this run read,
so it is lower on a run that rested quiet boards or ran out of Workday time.

## `boards.csv` is a seed, not a conclusion

`build_boards.py` grows it from public curated internship lists; run it rather
than hand-editing rows. We take one fact from them (which ATS slug a company
uses); postings are always scraped from the employer.

- **The scheduled scrape grows it before every run** (KAN-167). It only ever
  adds: a board in the file is kept, a list that fails to download raises
  before anything is written, and the step is `continue-on-error`. Those
  additions live only in that run, so re-run `build_boards.py` and commit
  `boards.csv` now and then.
- **A board on a provider's second host is still its board.** Greenhouse's EU
  boards (`job-boards.eu.greenhouse.io`) answer on the same
  `boards-api.greenhouse.io`, but its apply-link pattern missed the `.eu.` and dropped 26
  companies' links until 2026-10-26. A pattern that misses says nothing, so
  check the links no pattern takes, grouped by host, when a list changes.
- **The internship lists are renamed each season** (`Summer2026-Internships` →
  `Summer2027-Internships`). GitHub serves the old address too, but update
  `SOURCES` each season: a list that starts a new repo instead would go unread.

## `feed.json` is the backend's only view of us

Every run, `--offline` included, writes `feed.json` from the same roles as the
page. The backend's `app/scripts/import_jobs.py` loads it into `job_postings`;
the backend imports none of this package. So **`feed.row()` is the whole
contract**: its fields match `backend/app/schemas/jobs.py`, a field is added in
both or neither, and a new column needs its migration.

`description` has a format too: the kept sections under `sections.KEPT`'s
headings, which the backend's matching reads by name (Description sections).

Rows carry the schema's enum values (`onsite`, `new_grad`), not the page's
labels. `feed.WORK_STYLE` is indexed, not `.get`: a new label should fail the
run, not quietly become `null` in the app. The scraper never touches the
database.

## Logos

Read once per board from its board page and kept in `jobs.json`.
**`Provider.logo_pattern` accepts only each ATS's own image host, and those hosts must
match `frontend/next.config.ts`'s `images.remotePatterns` exactly**: `next/image`
throws on any other host, which fails the whole Jobs page. Workday has no
pattern: its logo is a wide banner, so its cards show the favicon of the website
its careers site links. **Raise `logos.VERSION` with any new place to find a logo
or website**, or boards already stored as having none never get it. Read
`docs/logos.md` before changing how a logo or website is found.

## The page

One self-contained HTML table (`# · Position Title · Date · Apply · Work Model
· Location · Company`), because that makes a thousand roles scannable. No
webfonts, CDN or logos: it renders identically with the network off, which is
the point of `--offline`.

## Tests

pytest in plain-`assert` style: `Test*` classes without `unittest.TestCase`,
and `tmp_path` rather than `tempfile`. Tested where a bug would be silent: the
shortlist, and the "new today" and "open roles" path through `store.py` and
`report.py`. One bug shipped marking every row "just added";
`tests/test_report_and_store.py` has a case for each way that count has been
wrong. Each provider's reader is tested on its real responses, trimmed:
`tests/test_providers.py` for Workable, Recruitee and BambooHR,
`tests/test_workday.py` for Workday. Where a board must be small enough to page
by hand, the page size or cap is shrunk, never the data.

## Committed data and deliberate limits

Only `boards.csv` is committed (`linguist-generated`). `jobs.json` is the
store, the `first_seen_at` history, the per-board read ledger and the offline
fallback, and it is gitignored: megabytes per run. Each machine keeps its own
history; the scheduled run keeps its own in the Actions cache. A fresh clone's
first live run counts nothing as new, and `--offline` refuses to run until a
live run has written the file. `internships.html`, `feed.json` and
`metrics.json` are gitignored output.

## Measure a change by provider

Every live run writes `metrics.json` and prints the same as a table: the run's
totals, and for each provider its boards by outcome, postings scanned, postings
kept this run, roles on the page, pages read and the lane's seconds
(`RunStats.by_provider`, `__main__.write_metrics`). The scheduled run keeps it a
week beside `feed.json`, so a change to one provider is judged run against run,
not by the one summary line. `--offline` writes none: it reads nothing.

`build_boards.py` prints the hosts of the apply links no provider's pattern takes,
most first (`unread_hosts`). That list is where a new reader pays off: iCIMS and
Oracle topped it before KAN-301. Common Crawl is no way round the curated lists:
its index API and its data host both disallow every bot in robots.txt
(2026-10-26), and no hiring system read serves a sitemap of its boards.

Limits marked in the code with `ponytail:` comments: nothing is ever closed;
the whole store is loaded and rewritten each run; only matching postings are
stored (all ~91,000 scanned would be tens of megabytes we never display); a
Workday board is read about every fourth run, not every run, and the biggest
are not read at all (`docs/workday.md`).
