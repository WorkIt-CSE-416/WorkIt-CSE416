# CLAUDE.md — scraper

The scraper's design and the rules for changing it; repo-wide rules are in
`../CLAUDE.md`, and `README.md` is only how to run it.

```sh
cd scraper
python3 -m workit_scraper              # scrape, then write the page, feed.json and metrics.json
python3 -m workit_scraper --full       # the same, quiet boards included
python3 -m workit_scraper --offline    # no network; rewrite both from jobs.json
python3 build_boards.py                # legacy local import; review changes before merging
python3 build_boards.py --resolve      # and the boards behind short links and careers pages
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
through `web.get` (or Workday's and TikTok's `web.post`) behind `polite.Robots`.
Greenhouse, Lever, Ashby, Workable, Recruitee and BambooHR return a whole board in
one request. Workday sends 20 postings a request, which changes how its boards are
read: `docs/workday.md`. Oracle, TikTok, Jibe and SuccessFactors page as well
(`Provider.paged`): `docs/providers.md`.

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
absent because it disallows us, and that is the whole reason (its API's
robots.txt still said `Disallow: /` to every agent but LinkedIn's on 2026-10-26).
Rippling, iCIMS, Oracle, TikTok, Jibe and SuccessFactors, and the systems still
not read, are in `docs/providers.md`.

**Everything the scraper knows about a hiring system is one `Provider` in
`providers.PROVIDERS`**, keyed by its `ats`. It used to be eight tables in four
files (`LISTING_URL`, `JOB_URL`, `FETCHERS`, `PAGED`, `build_boards.PATTERNS`,
`logos.PAGE`, `logos.PATTERN`, `polite.SHARED_PACE`), and a provider missing from
one failed silently: the `.eu.` that `PATTERNS` missed dropped 26 companies.
`polite.SHARED_PACE` and `FOLD_CASE` are now read off the records. Field pairs a
reader needs together are tested (`TestProviderRecords`).

**`workit_scraper/providers/` is a package, one module per hiring system** under
`systems/`: its reader, its page reader if it has one, and its `PROVIDER` record.
`providers/__init__.py` registers each in `PROVIDERS` and re-exports the public
names, so `from workit_scraper.providers import Job` still works; a private
helper stays in its module (`providers.systems.lever._lever_pay`). The shared
parts are `model` (Board, Page, Job, Provider, the errors), `fetch` (requests,
`_iso`), `text` (HTML to text, `_page`, work style, places) and `registry`
(`PROVIDERS`, the URL builders, `describe`). It was one 1,640-line file until
2026-10-26.

- **Readers call the request helpers through the module, `fetch._get_json(...)`,**
  never a name imported from it. A test swaps `providers.fetch._get_json` once
  for every reader; a reader that imported the name would keep the real one and
  a test would reach the network.
- **`PROVIDERS` is one dict, made empty in `registry` and filled by
  `__init__`**, because each reader builds its URLs from the registry and the
  registry names every reader: filled any earlier, the imports would loop. A
  test that swaps an entry (`swap_provider`) swaps it for every caller.

1. A module in `providers/systems/` with a reader taking `(token, company)` and
   returning `list[Job]`, named in `providers/__init__.py`'s imports and
   `PROVIDERS`.
   One that makes more than one request per board sets `paged`, takes `pace` and
   calls it before each request after the first (Workday's `workday`).
2. Its `Provider`: `listing_url` (which the reader and the robots check both
   read, so a board is never checked at one address and fetched at another),
   `read`, and `apply_link`, or none of its boards ever reaches `boards.csv`.
   `providers/urls.py`'s `board_keys` matches `apply_link` against the
   link's host and path only, ending at a path boundary; a pattern that reads
   the query (Jibe's `icims=1`, SuccessFactors' `ats=successfactors`) or ends
   mid-path (TikTok's) joins its `WHOLE_LINK`, matched from the whole link's
   start. Those three were dropped when `board_keys` replaced `build_boards`'
   `tokens()`, and main's scraper tests failed until KAN-424 put them back.
   Then what applies:
   - its list leaves out the description or a fact the posting's own page has:
     `job_url` and a `describe_<ats>` as `describe`;
   - robots.txt must allow another URL first: `careers_site` (Workday's);
   - each company is its own subdomain: `subdomains`, so they share one pace,
     and `case_blind` if its paths are;
   - its boards cannot all be read in one run: `budget_s`;
   - its list names a job only by its URL: `page_title` (iCIMS);
   - its list dates a job only roughly: `page_date` (Workday, Oracle);
   - its token's case matters: `keeps_case` (Oracle's site codes);
   - its board page has a square logo: `logo_page` and `logo_pattern`, and the
     image host in `frontend/next.config.ts` (see Logos). If it names only the
     company's website: `logo_page` and a rule in `logos.extract` (Workday).
   - it names a board's company on a page robots.txt allows: `name_url` and
     `read_name`, and its board page in `discovery_channels.POOL_PAGES`, so
     open-jobs' pool boards on it can be proposed (ADR 0007).
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
  company stopped hiring", which nobody notices. **Only a board's first request
  can say it does not exist**: a paged reader turns a 404 on a later page into
  `Incomplete` (Oracle's and Workday's). As "no such board", one bad page of a
  large Oracle board closed every posting on it.
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
  BambooHR, whose date is only on the page. Workday's and Oracle's are the
  reverse (`Provider.page_date`, `store.carry`): Workday's list has a date
  counted back from "Posted 3 Days Ago" and Oracle's a bare day, but the page's
  exact one wins, so a bare listing keeps the stored date and never drifts by a
  day, vanishes at "30+ Days Ago", or falls back to midnight. Oracle did fall
  back on its second run until 2026-10-26: a list that dates a posting at all,
  only roughly, needs `page_date`.
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
`providers.text._page` stores `cap(sections.kept(full))`. `sections.split` reads a
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

- **The stage decides what is kept; the field only files it (KAN-430).** An
  early-career title in any field is kept, because the page is for college
  students of every major. Law, consulting, support, the arts, policy and
  teaching, held off until then, are categories of their own; a title naming
  no field, or a trade, operator, medical or hotel job (`OUTSIDE_FIELDS`, the
  old never list), is `other`. The stage words are the main filter: a
  word joins them only when every live title it matched was early career
  ("trainee", "rotational program"). A title with no stage word is also kept
  when its description states 0 or 1 years of experience
  (`classify_with_description`, using `details.min_years` as the authority
  when it finds years and `EARLY_EXPERIENCE` when it does not). "Level I",
  "Associate" and "Analyst" wait for that rule to reach more providers
  (`docs/categories.md`, "Every field, early career only").
- **`engineer` alone is not a signal**, and reinstating it is the tempting
  mistake: Wade Trim's "Engineer Summer Intern" is civil, Decagon's
  "Engineering Intern" software, and nothing in either title tells them apart.
  Both are `other`, never `engineering`.
- `\bintern\b` must not fire on "Internal Applications". `SENIOR` beats the
  stage: "Junior/Senior or Staff Software Engineer" is not a new-grad role.
- **Nineteen categories, up to two a role, plus specialties (KAN-172,
  KAN-430).** The first discipline a title names is its category
  (`CATEGORIES`, first match wins), and that order is the decision. Read
  `docs/categories.md` before changing a category, specialty, the stage or
  their order: it has the order's reasoning and the measurements.
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

## Nothing closes; the page shows what the last two complete reads saw

A posting that disappears keeps its last `last_seen_at` and stays in
`jobs.json`. The scraper never retires a job, so it never wrongly retires one.

`Store.is_listed` keeps a posting only if it was on its board at one of the last
two times we read that board **in full** (`BoardReads.last_read_at` and
`prior_read_at`), so it leaves the feed, and the import closes it, after **two
complete reads in a row** without it. **Only a complete listing is evidence that
a posting is gone**: a timeout, a partial read, or one board seen twice in one
run is not, and each run moves a board's reads once at most. One complete read
was enough until 2026-10-27, and one bad answer closed a board: a hiring system
mid-outage can answer with an empty list, which reads as a real board with
nothing open, and the import's half-the-feed guard lets one company's postings
through. The cost is one more read before a real closing. **Nor does most of a
lane answering with an empty list at once** (`__main__.scrape`, as Freehire
guards): when `SURGE` (3) or more known boards in one lane list nothing, and
more of them than list something, those reads count as none. Two reads stop one
empty answer, not a hiring system that answers every board empty for a few
hours. A few empty boards are still read, so a company that closed its last
posting closes it.

**A board holding a posting missed once is read first** in its lane's next run
(`Store.missed_once`, `Store.to_read`): in a lane with a budget, the second read
would otherwise wait a whole sweep, about a day on Workday. `metrics.json`
counts them (`boards_missed_once`).

**A board we hold postings from that answers "no such board" twice in a row
was read in full, with nothing open** (`store.update`, `missing`): a 404,
Workday's 422 or BambooHR's redirect home, when the company has left that
hiring system. Counted as no read until 2026-10-26, its postings stayed on the
page for good. The first answer only sets `BoardReads.missing_at`; a complete
read clears it. One answer closed postings at first, and a Workday or Oracle
board then waited about 12 hours at the back of its lane's queue to reopen them.
A board never read that answers so is still unread (a typo has nothing to
close, and `Store.is_new` reads a board's first read). **A lane where `SURGE`
(3) or more known boards answer so in one run, and more of them than read
whole, closes none** (`__main__.scrape`): that is the hiring system changing,
and one lane is under the import's half-the-feed guard. The two answers are the
two misses, so the first one's time becomes `prior_read_at`. `store.load` drops
fields it does not know (`_known`), so a revert to this code or later loads a
newer store; a revert to code before `prior_read_at` must delete the
`scraper-store-*` Actions cache, or the old code fails to load `jobs.json`.

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
- **A 429 holds the whole host** (`fetch._hold`, as Freehire does): every
  request to it waits, on every worker, for its `Retry-After`, else
  `HOLD_FIRST` (1 second), doubling on each 429 after a hold is up, to
  `HOLD_LONGEST` (a minute), which also caps `Retry-After`. The host is
  `polite._pace_key`'s, so one Workday tenant's 429 holds all of
  myworkdayjobs.com. A 429 during a hold is the same burst and counts once; a
  success after the hold starts the next one at a second again. The request
  that got it is retried once, after the hold. A 5xx holds no one: it is one
  server failing, not a host asking us to slow down.
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

**A lane can have a time budget** (`Provider.budget_s`; Workday's, Oracle's and
Jibe's, 12 minutes each, run side by side). It starts boards from the front of
`Store.to_read`'s order (a board with a posting missed once, then one never
read, then the least recently read), and once its time is up leaves the rest for
a later run. **A budget does not cut a board short**: a board started in time is
read whole, so a lane whose boards can be huge needs a size cap as well
(`WORKDAY_MAX`, Oracle's, `JIBE_MAX`), raising `TooLarge` after the first page.
Jibe had neither until 2026-10-30: H&R Block's 18,576 postings took 15 minutes
at Jibe's 5-second Crawl-delay, the lane ran 31, and two of three scheduled runs
that day hit the 60-minute workflow timeout and imported nothing. Before a lane
grows, check its slowest board in `metrics.json` against the timeout.

**Page reads have a deadline too** (`PAGES_UNTIL_S`, 20 minutes from the lanes'
start, for every lane): after it, no posting's own page is asked for, the lane
prints how many it left ("… N postings' pages left for the next run"), and the
next run reads them first, since `needs_page` still says so. A lane's budget
covers only its board reads. Without the deadline, the batch-apply merge
(2026-10-28) added SuccessFactors, whose every kept posting needs its page, one
host at a time; every scheduled run then spent its last 16 minutes on pages with
nothing in the log, hit the job's 30-minute limit, and was cancelled. **A
cancelled run saves no store**, so the next one repeated the same pages, and
nothing was imported for 32 hours. Keep the deadline plus the import (about 10
minutes) well under `timeout-minutes` in `.github/workflows/scrape.yml` (90 since 2026-10-30).

**So do board reads, in every lane** (`BOARDS_UNTIL_S`, 30 minutes from the
lanes' start): after it no lane starts a board, budget or not, and the rest are
`DEFERRED`, first in line next run (`Store.to_read`). A lane budget alone was not
enough: a lane without one ran as long as its boards took, and Jibe's held two of
three scheduled runs on 2026-10-30 past 60 minutes, each cancelled, each saving
nothing, so the next one faced the same boards. This is what guarantees a run
ends and saves; a new lane, or a lane that grows, cannot bring the loop back.

**A board that keeps going unread rests** (`Store.health`, `store.rest_for`),
as Freehire's do. After `REST_AFTER` (3) runs in a row that left it unread for
any reason in `RunStats.unread` (a failure, "no such board", robots.txt), no run
asks it for `REST_FIRST` (6 hours), then twice that after each further miss, up
to `REST_LONGEST` (a day). One complete read ends it. **Never rest a board for
good**: a site that blocked us or a board that came back must be found again
by itself. A board left for a later run has no reason and keeps its count.
Even `--full` skips a resting board. Before this, the 191 boards that said "no
such board" and the 12 that failed were asked on every run. The rest does not
delay a close: "no such board" closes on its second answer, before the third.

`--full` keeps the budget: it un-rests quiet boards, it does not make a Workday
sweep fit in one run. The page's "postings scanned" counts what this run read,
so it is lower on a run that rested quiet boards or ran out of Workday time.

## `boards.csv` is a seed, not a conclusion

Discovery collects ATS board candidates from public curated lists and other
sources. A complete provider read shows that a board is live; it does not prove
the source named the right company. Developers review proposed catalog changes
before merging them. Postings are always scraped from the employer.

- **Daily discovery commits new boards directly to main**, separately from
  the three-hour scrape, so the next scrape reads them with no human bottleneck.
  The rejection ledger (`discovery-review.json`) and `validate_catalog` gate
  prevent rejected rows from returning. To reject a board, add
  `"decision": "rejected"` to its ledger entry and remove its CSV row. The
  rules are below; operation is documented in `docs/discovery.md`.
  `build_boards.py` remains a manual legacy importer.
- **A board on a provider's second host is still its board.** Greenhouse's EU
  boards (`job-boards.eu.greenhouse.io`) answer on the same
  `boards-api.greenhouse.io`, but its apply-link pattern missed the `.eu.` and dropped 26
  companies' links until 2026-10-26. Lever's EU boards (`jobs.eu.lever.co`) did
  the same until 2026-10-27; their API is `api.eu.lever.co`, so a Lever token
  is `eu/{slug}` there (`registry._parts`). A pattern that misses says nothing,
  so check the links no pattern takes when a list changes.
- **Each source prints its yield, and the unread links print by cause**
  (`harvest`, `UNREAD_CAUSES`). A source whose links name no board gets a `!`
  line: the vanshb03 list wraps every link in a `go.vansh.nyc` short link, and
  its 1,942 rows named no board without a word until 2026-10-27. The causes say
  where the next reader pays off: an employer's own site, a short link, a hiring
  system behind a company's domain, SmartRecruiters, the other systems.
- **`--resolve` finds the boards behind three of those causes, each proved**:
  a short link by where it leads, a careers page with `?gh_jid=` by the
  Greenhouse board that holds that posting's number, one with `icims` by the
  tenant whose sitemap lists it. Never a guess: a board under the wrong name
  puts another company's name on real cards. The resolve functions live in
  `board_resolve.py`, shared by `build_boards.py` (manual) and
  `discover_boards.py --resolve` (daily). `discovery_pr.py` passes `--resolve`
  so the daily workflow resolves unmatched evidence before extracting
  candidates; `build_boards.py --resolve` still works for manual runs. Its
  tests are built cases (`TestResolve` in `test_build_boards.py`, resolve
  tests in `test_discover_boards.py`).
- **The internship lists are renamed each season** (`Summer2026-Internships` →
  `Summer2027-Internships`). GitHub serves the old address too, but update
  `SOURCES` each season: a list that starts a new repo instead would go unread.

## Discovery review contract

Indirect-link resolution is bounded separately from board validation:
`board_resolve.resolve_links` owns grouping, three-attempt retries and deadline
checks for both commands. Discovery defaults to 100 groups / 120 seconds and
resumes from `discovery-resolution.json` on main; never restore per-posting
resolution loops before those bounds. Commit the next offset together with new
boards, including cursor-only progress when nothing new was found.
Short links stay separate by URL because one company's links can name different
boards. Budget exhaustion keeps completed discoveries and still writes the report
and publishes successes. Operation and counters: `docs/discovery.md`.

`discover_boards.py` collects candidate boards on demand and through the daily
`discovery_pr.py` workflow, separately from the three-hour scrape. It uses the
existing provider registry, robots checks, pacing, and HTTP client. Keep the
scraper standard-library-only.

- Preview is the default. Local `--apply` adds only new boards whose existing
  provider reader completed and whose evidence supplies one unambiguous name.
  An empty successful response is a live board; a failed or partial read is not.
  A live read does not prove company ownership. Scheduled discovery commits
  new boards directly to main so the next scrape reads them.
- Search URLs without company attribution remain `needs_company` in the report.
  Do not turn their slugs or search snippets into company names: every downstream
  card trusts boards.csv. Supply a verified URL and company through the CLI.
- **The one exception is the open-jobs pool** (`--channel openjobs`, ADR 0007,
  proposed, not yet agreed by the team): open-jobs' frozen list of boards, which
  names none. A pool board is proposed only when it lists a posting
  `shortlist.pick` keeps, under the name its own hiring system gives it
  (`Provider.read_name`); one its system does not name stays `needs_company`.
  **So does one named like a careers page or a program**
  (`board_read.NOT_A_COMPANY`): Greenhouse gave 25 of 242 sampled boards such
  a name ("Careers at KKR", "Referrals Only"), and a pool board takes its name
  straight onto every card. **Each pool board has a fixed day of the pass**
  (`--pool-days`, `--pool-day`, `discover_boards.on_day`: a stable hash of
  its key). Never pick the day's boards by an offset modulo the pool's size:
  the size changes as boards join `boards.csv`, and that read about 77% of the
  pool in a 16-day pass. `--pool-limit` is only a guard on a run's time, kept
  above the largest day. These are the pool's own, apart from `--limit`'s
  20 a day, and the review marks a tenth of each run's pool boards, at least
  five, for a person to check (`discovery_review.sampled`). Never name a pool
  board from anything else: a slug, a page's other text, a search result.
- Candidate URLs must match an actual provider host, not an embedded URL in a
  query/path or a lookalike hostname. Preserve Oracle token case and Lever region.
  `board_keys` matches from the host over the path and the query, since Jibe
  and SuccessFactors name themselves only in the query (`?icims=1`,
  `?ats=successfactors`); read without it, those links and TikTok's named no
  board and main's tests failed after KAN-422 merged (2026-10-28).
- Keep source URLs and statuses in the report. Deduplicate known boards before
  applying the validation limit; truncating curated links first starves discoveries
  behind already-known boards. Automation preserves existing main-catalog names
  and rows, and preserves reviewers' corrections to proposed company names.
- API credentials belong only in request headers, not logs or reports. The HTTP
  client retains its identifying User-Agent and rejects cross-origin redirects.
- Common Crawl is excluded under the robots restriction recorded in CLAUDE.md.
  Unsupported ATS URLs are reported; adding readers is a separate provider change.

Usage and credentials: `docs/discovery.md`. How open-jobs and freehire find
their boards, what WorkIt took from them and the 500-board pool sample:
`docs/research-open-jobs-freehire.md`.

Shared boundaries: `providers/urls.py` owns board URL recognition for both
commands; `board_read.py` owns the robots/pacing/read result; `catalog.py` owns
CSV serialization and atomic writes. The collector and legacy builder share these
modules, never each other or the scrape entry point. The discovery orchestrator
calls the collector entry point. Keep provider failures distinguishable from
empty success.

`discovery_sources.py` declares each curated source's application URL field.
Do not scan arbitrary metadata recursively: company homepages are not ATS leads.
`discovery_channels.CHANNELS` owns channel dispatch and query requirements.
Collection returns evidence and per-source failures; a failed independent source
must not discard successful evidence. Reports retain company attribution per
evidence entry, and report/catalog paths must never alias, even during preview.

`discovery_pr.py` commits new boards directly to main. It fetches `origin/main`,
runs discovery in a worktree, reconciles against the catalog and rejection ledger,
and pushes to main. Keep its default a local preview; publishing needs explicit
`--publish`. If someone pushes to main between our fetch and our push, git
rejects the non-fast-forward and the next daily run retries.

`discovery-review.json` stores observations and durable review decisions. To
reject a board, add `"decision": "rejected"` to its ledger entry and remove its
CSV row; discovery will not re-add it. Preserve company-name corrections and
merge rejected ledger entries even when no boards are added. CI checks the actual
catalog against the ledger, and the scraper and publisher must call
`discovery_review.validate_catalog` before consuming/publishing it. This prevents
a ledger-only rejection merged between daily runs from becoming an active board.
Reconsideration requires a deliberate ledger-entry removal.

**To retire a board on main, delete its row and add
`"ats/token": {"decision": "rejected"}` to `discovery-review.json`** in the
same commit (create the file if it is absent). Deleting the row alone is not
enough: the ledger rejects only boards discovery proposed, so a deleted main
row is proposed again on the next run that finds it. Nothing else in the entry
is required. Dead boards need no retiring: they rest by themselves (above).
`discovery-review.md` is generated from that ledger and must not be hand-edited.
Evidence includes source/company, ATS/token, posting count, and validation time;
it is not proof of ownership. There is no company allowlist or trust manifest.

The three-hour scrape uses the human-reviewed catalog committed on main and
must not run `build_boards.py`: its legacy curated-list additions bypass review.
Empty live boards need the same human review as nonempty boards. Existing
catalog entries are not retroactively verified by the new process.

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

**`closings.json` says why each stored posting is not in the feed**
(`feed.closings`), keyed by apply URL, and the import writes it as
`job_postings.closed_reason` on each job it closes: `board_gone` (not listed,
its board said "no such board"), `gone_from_board` (not listed: two complete
reads lacked it), `filtered_out` (listed, but `pick` no longer keeps its
title) or `replaced` (listed and kept, but another copy of its requisition
leads the card). It is worked out from the store as it is, **never from the
last run's feed**, so an import that failed or was skipped still finds every
reason on the next run. Copies at one URL that disagree take the first reason
in `feed.REASONS`. A reason added here needs the import's list and the CHECK
from the backend's `bd730e8ab454` widened by a migration first, or the import
files it as `unknown`, with a warning.
`metrics.json`'s `closings` counts the file by reason: totals, not this run's
closes, which are in the import's report.

## Logos

Read once per board from its board page and kept in `jobs.json`.
**`Provider.logo_pattern` accepts only each ATS's own image host, and those hosts must
match `frontend/next.config.ts`'s `images.remotePatterns` exactly**: `next/image`
throws on any other host, which fails the whole Jobs page. Workday has no
pattern: its logo is a wide banner, so its cards show the favicon of the website
its careers site links. **Raise `logos.VERSION` with any new place to find a logo
or website**, or boards already stored as having none never get it. Read
`docs/logos.md` before changing how a logo or website is found.

**The feed's `company_domain` is what the Jobs page draws the logo from**
(Brandfetch, KAN-442): `logos.company_domain`, worked out as the feed is
written, from `checked_websites.csv` first, else the favicon's website, cut to
the company's registered domain and never a hiring vendor's. A row goes into
`checked_websites.csv` only after its checks (`docs/logos.md`, Checked
websites): a script for the site and its name, a person for every failure.

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
`tests/test_workday.py` for Workday, `tests/test_more_providers.py` for TikTok,
Jibe and SuccessFactors (recorded responses in `tests/fixtures/providers/`). Where a board must be small enough to page
by hand, the page size or cap is shrunk, never the data.

## Committed data and deliberate limits

`boards.csv` is committed (`linguist-generated`), alongside the discovery review
ledger and generated evidence document when proposals are merged. `jobs.json` is the
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

Three more measures serve decisions not yet taken (`docs/coverage.md`, which has
the design they serve and its next steps):

- **`widening`**: every posting scanned, under the first step of a wider
  shortlist that would keep it (`shortlist.widening_step`: `kept`,
  `no_stage`, `senior`), so the size of each step is known before anyone
  takes it. `widening_step` uses `classify_with_description`, so a posting
  kept by its description's years counts as `kept`, not `no_stage`.
  `held_field` and `no_field` were taken by KAN-430, and `outside`
  went with them: every field is kept, so only the level is left to widen. A run scans only what it reads, so
  compare steps with each other. Each distinct title is read once: the rules
  cost about 50 microseconds a title.
- **`newest_first`, `not_newest_first`, `order_unclear`** for each provider that
  pages (Workday, Oracle): whether the lists it read whole name their newest
  postings first, by the list's own dates, read before `carry` puts back the
  page's. An arrival scan that reads only a list's first pages needs it; a board
  read in slices is in no one order and is left out.
- **`boards_missed_once`** (above, "Nothing closes").
- **`unread`**: why each board a run did not read stayed unread, by provider and
  reason, with up to five board keys each (`RunStats.unread`, `board_read.failure_reason`,
  `unread_by_provider`): the HTTP status a site answered ("403", "429"),
  "timeout", "connection", "redirect", "incomplete", "unreadable answer",
  "robots.txt", "too large" or "no such board". It says whether any site blocks
  GitHub's runners before anyone weighs a move or a proxy: until it, a refusal
  was only a line in the log.
- **`resting`**: the boards the next runs will not ask (`Store.resting`), in the
  same shape as `unread`, by why each last went unread.

`build_boards.py` prints the unread apply links by cause, with their top hosts
(`unread_cause`, `unread_hosts`). That table is where a new reader pays off:
iCIMS and Oracle topped it before KAN-301. Common Crawl is no way round the
curated lists: its index API and its data host both disallow every bot in
robots.txt (2026-10-26), and no hiring system read serves a sitemap of its boards.

Limits marked in the code with `ponytail:` comments: nothing is ever closed;
the whole store is loaded and rewritten each run; only matching postings are
stored (all ~91,000 scanned would be tens of megabytes we never display); a
Workday board is read about every fourth run, not every run, and the biggest
are not read at all (`docs/workday.md`).
