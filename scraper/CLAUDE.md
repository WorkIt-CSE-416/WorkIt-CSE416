# CLAUDE.md — scraper

Repo-wide conventions live in [`../CLAUDE.md`](../CLAUDE.md). This file is the
scraper's design and the rules for changing it; `README.md` is only how to run it.

```sh
cd scraper
python3 -m workit_scraper                          # scrape, then write the page and feed.json
python3 -m workit_scraper --full                   # the same, quiet boards included
python3 -m workit_scraper --offline                # no network; rewrite both from jobs.json
python3 build_boards.py                            # regenerate boards.csv
uvx pytest                                         # the tests
```

## How it fits together

```
boards.csv ─▶ __main__ ─▶ polite.Robots ─▶ providers.FETCHERS ─▶ store.update ─▶ jobs.json
                                                                                   │
                           report.write_html ◀─ shortlist.pick ◀─ Store.is_listed ◀┘
                           feed.write ◀────────────┘  (feed.json ─▶ backend import ─▶ Supabase)
```

| file | owns |
|---|---|
| `boards.csv` | the boards to read: `ats,token,company` |
| `build_boards.py` | regenerating `boards.csv` from public curated internship lists |
| `web.py` | the one HTTP GET: our User-Agent, no cross-origin redirects |
| `polite.py` | robots.txt and per-origin pacing |
| `providers.py` | `Board`, `Job`, and one function per ATS mapping its JSON onto `Job` |
| `details.py` | pay, job type and years of experience read out of a description |
| `store.py` | `jobs.json`, `first_seen_at`, and what "listed" and "new today" mean |
| `shortlist.py` | which postings belong on the page, and collapsing duplicates |
| `report.py` | rendering the page |
| `feed.py` | `feed.json`, the backend's copy of the same roles |
| `logos.py` | each company's logo, read once off its job board's page |
| `__main__.py` | the thread pool and the two commands |

All three providers return a whole board in one request, so there is no pagination.

## A Greenhouse posting's own page is read once, and only for kept postings

What a posting's own text says is one value, `providers.Page`: the description
(plain text, cut to `DESCRIPTION_CHARS` for Scout), the card's `details.Facts`,
and on Greenhouse the posting's offices. Lever and Ashby send it with the board's
list, so their `Job.page` is rebuilt on every read. Greenhouse does not: its
`content=true` would send every posting's full HTML, hundreds of megabytes a run
to describe the ~1% we keep. So a Greenhouse listing has `page=None`, and
`__main__.with_page` reads each *kept* posting's own page once (with
`pay_transparency=true`), through the same robots and pacing. A posting whose page
fails or is disallowed simply has none.

**The store carries a `Page` forward whole: `job.page or old.page`.** That one rule is
the point of the model. It used to be nine flat fields carried one by one, and two
bugs came of it: a Greenhouse listing's title-only "2027" overwrote the page's
"Summer 2027", and Strada's internship stayed "full-time" after Ashby changed it.
Ashby and Lever always bring a fresh page, so theirs always wins.

`Page.version` is the `providers.PAGE_VERSION` it was read under, and `with_page`
reads again any whose version is older. **Bump `PAGE_VERSION` whenever a `Page`
starts holding something new**, or postings already stored never get it; the bump
costs one read per kept Greenhouse posting, once. `with_page` only ever sees postings
a board just listed, so one that has left its board is never asked for.

That carrying forward means **changing `DESCRIPTION_CHARS` does not re-cut
Greenhouse descriptions already stored.** After changing it, clear them so the
next run fetches them again:

```sh
python3 -c "import json; p='jobs.json'; d=json.load(open(p)); [j.__setitem__('description', None) for j in d['jobs'] if j['ats'] == 'greenhouse']; json.dump(d, open(p, 'w'), indent=1, sort_keys=True)"
```

## This package imports only the standard library

`dependencies = []` in `pyproject.toml` is load-bearing, not an accident.
`python3 -m workit_scraper` has to work on a fresh clone with no install step, no
virtualenv and no `uv` — a demo that needs a dependency resolver first is a demo that
can fail in the room. HTTP, JSON, CSV, robots.txt, threads and HTML escaping are all in
the stdlib. Keep reaching for it.

The tests and the linter are the one exception, and they stay out of the package:
pytest and ruff sit in the `dev` dependency group and run as one-off tools (`uvx pytest`,
`uvx ruff`), so nothing in `workit_scraper/` may import either, and running the scraper
still needs no install. `[tool.pytest.ini_options]` sets `pythonpath = ["."]` because
`uvx` runs pytest in its own environment, where the package is not installed.

## Adding a provider

1. A function in `providers.py` taking `(token, company)` and returning `list[Job]`.
2. Its URL template in `LISTING_URL`, which both the fetcher and the robots check read
   from, so a board can never be checked at one address and fetched at another.
3. Its name in `FETCHERS`.
4. Its apply-URL pattern in `build_boards.PATTERNS`, or no board of it ever reaches
   `boards.csv`.

Read the provider's `robots.txt` before writing anything. SmartRecruiters is absent
because it disallows us, and that is the whole reason.

**A 404 means the board does not exist. A 200 carrying an empty list means a real board
with nothing open right now.** Raise `BoardNotFound` for the first and return `[]` for
the second. Collapsing them turns a typo in `boards.csv` into "this company stopped
hiring", which nobody notices.

**Providers disagree about types.** Lever sends `createdAt` as an `int` in some records
and a numeric string in others; trusting one shape silently dropped every Lever board on
the first live run. `_iso()` takes `object` and narrows on purpose — normalise through
it rather than reading a provider field directly.

**They also disagree about what they publish at all.** Ashby and Lever state a work
model; Greenhouse has no field for one, so a Greenhouse posting states one only when
its location *is* a work model -- Cloudflare names every location "In-Office" -- or a
sentence says so. What the card shows when nothing states it is decided in
`shortlist`; see the card's facts below.

A location that is only a work model is not a place. Cloudflare's Lisbon and London
internships both read "Software Engineer Intern (2027) · In-Office" until `Job.places`
took the city from the posting page's `offices`. Two cards that look identical are
usually this, not a dedupe bug -- `pick` keys on the apply URL on purpose (below).

## The card's facts: the provider's field, then the description, never a default

The app's card shows six facts: location, job type, salary, work style, level and
years of experience -- or, on an internship, when it starts ("Start in Summer 2027"),
since nobody asks an intern for years. Each is filled from the provider's own field
where it has one (Ashby `employmentType` and `compensation`, Lever `commitment` and
`salaryRange`, Greenhouse `pay_input_ranges` and board metadata), and otherwise from
the description by `details.py`. What neither states stays null, and the card says
"not listed" -- except work style, below.

**Facts are read from the whole description, when it is fetched** (`details.read`, from
`providers._page`),
and only then is it cut to `DESCRIPTION_CHARS` for storage. Pay is often the last thing
a posting says, under a long benefits section: reading the stored, cut copy missed it
on a sixteenth of the feed. So `--offline` re-renders the facts a fetch found but finds
no new ones; changing a pattern in `details.py` takes a live run (and, for Greenhouse,
a `PAGE_VERSION` bump) to reach stored postings.

`details.py` is regex over prose, so it is fussy in the same way `shortlist.py` is, and
every case in `tests/test_details.py` was seen in a real posting:

- **Statements about this role only.** "Not considering remote or part-time",
  "full-time or part-time internship", "post-internship opportunities (full-time)" and
  "employees (including part-time)" are all in live descriptions. A posting offering
  both types has none.
- **A ceiling is not a minimum.** Lyft and DoorDash interns need "less than 2 years".
  Of several minimums ("5+ years, or 3+ with a Master's") the lowest is the bar.
- **Pay keeps its period.** Many internships pay by the month or week, and $8,000 a
  month for twelve weeks is not $96,000 a year, so the feed carries `week` and `month`
  as well as `job_postings`' `hour` and `year`. An amount its label contradicts loses
  the label (Samsara's "Annual Base Salary: $38—$58"); `$120M` raised is not pay.
  `feed.salary` always writes a range (`salary_min`/`salary_max`, equal for one
  amount); the card prints an equal range once.
- **"Intern" is not a job type.** Ashby and Lever say Intern where they could say
  Full-time; it says nothing about hours, so the description decides.
- **A role's facts come whole from one posting**, its first copy with a page --
  never field by field across copies of one URL, which would pair one copy's pay
  with another's job type. `Role.facts.work_style` is the card's answer.
- **Work style is the one fact the card infers** (`shortlist._work_style`), in this
  order: what the posting states (its board's field, or a sentence like Sigma's "an
  in-office work environment"); then what the company's other postings state, most
  often; then "On site" for a posting that names a place and nowhere mentions remote,
  hybrid or working from home. Most postings that say nothing (Figure: "San Jose, CA",
  no more) work on site, and a filled card was judged worth the misses. Measured on
  250 postings whose board states a style but whose text does not: the order above is
  right 87% of the time, "On site" alone 70% -- the misses are hybrid jobs. Only
  specific hybrid wording counts as stated ("3 days a week in the office", "hybrid
  schedule"): a bare "hybrid" was wrong 38 times in 89 ("hybrid cloud").
- **A start term comes from the title first.** "Software Engineer Intern (2027)" is the
  employer's label for its cohort. The description can name the season ("our Summer
  2027 program") or a start month, but only of the title's year; a year alone in a
  description is as likely a founding date. Years are any 20xx judged against
  today (`details._near`: last year to three ahead), so no pattern needs editing
  as the calendar moves.

**The company name comes from `boards.csv`, not the provider.** Greenhouse's
`company_name` carries internal labels ("LinkedIn Job Wrapping", "DRW - University
Jobs") that split one company's roles into several.

## `first_seen_at` is written once

`store.update()` carries it forward from the previous `jobs.json`; only `last_seen_at`
moves. `posted_at` is the employer's claim about a posting and can be re-stamped; our
own observation cannot, which is what makes it worth more.

## "New today" is a claim about time, so it lives in `store.py`

`Store.is_new`: **first seen in the 24 hours up to the scrape, on a board we had already
read before.** A posting found on a board's very first read was already there when we
started looking, so it is never new. That one rule covers the first run, a board newly
added to `boards.csv`, and two runs on the same day — do not replace it with "new since
the last run", which drops the first run's arrivals on a same-day re-run and sums days
of them when runs are far apart. Until some board has an earlier read, `counts_new` is
False and the page prints "—" rather than a number it has not earned. The page also
prints when it was scraped, so an `--offline` render days later cannot pass off an old
count as today's.

Known limit: widening a regex in `shortlist.py` makes postings that newly match on a
board we already watch count as new, because only matching postings are stored.
Fixing that means storing every scanned posting (see Deliberate limits).

## Nothing closes; the page shows what the last complete read saw

A posting that disappears keeps its last `last_seen_at` and stays in `jobs.json`. The
scraper cannot wrongly retire a live job because it never retires one.

What the page lists is narrower: `Store.is_listed` keeps a posting only if it was on
its board the last time we read that board **in full**. `jobs.json` records, per
board, when it was first and last read successfully. A board that timed out this run
keeps its postings on the page, because **only a complete listing may count as evidence
that a posting is gone.** A timeout, a partial read, or the same board seen twice in one
run supply no evidence.

Actually closing a posting (removing it, or telling an applicant it closed) is a real
design and belongs in the ticket that needs it: two accepted complete absences before
closing, at most one miss per board per run.

## Politeness is ours to enforce

Every request goes through `web.get` and, before it, `polite.Robots` — including
`build_boards.py`'s three fetches from GitHub.

- `Robots` reads every origin's robots.txt once, up front. Per RFC 9309, a 4xx means
  no rules; a 5xx **or an unreachable robots.txt** means complete disallow for the
  run. An outage is not permission.
- `Robots.pace()` paces **every** origin: it honours a published `Crawl-delay` (Lever
  asks for one second) and holds `DEFAULT_DELAY_S` against origins that publish none.
  Greenhouse publishes none, and across ~1,800 boards at eight in flight we would
  otherwise run at roughly 60 requests a second. Keep it in the path of every fetch.
- `web.get` refuses a redirect to another origin, since robots.txt was checked for
  the one we asked for.

## Speed comes from lanes and quiet boards, never from less pacing

A run took 9.5 minutes, and Lever's one-second Crawl-delay over 333 boards is 5.5 of
them on its own. Two things cut it; neither touches `Robots.pace`.

- **One lane per provider** (`__main__.scrape`). All boards used to share eight
  workers, and a worker waiting out Lever's delay was a worker not reading Greenhouse.
  Each lane has its own workers and the same per-origin pacing, so no server sees more
  than it did. The Greenhouse lane reads its new postings' own pages as soon as its
  boards are done, while Lever is still going.
- **Quiet boards rest** (`Store.to_read`). A board read before that has never had a
  posting we keep -- most of `boards.csv`: 282 of 333 on Lever -- is read on one run in
  `QUIET_EVERY`, staggered by its key so each run takes its own share, and always once
  that many days have passed. The cost is accepted: a first posting on a quiet board can
  appear two days late. `--full` reads every board. A board with any kept posting, ever,
  is read every run; nothing closes, so it never turns quiet again.

The page's "postings scanned" counts what this run read, so it is lower on a run that
rested quiet boards.

## `boards.csv` is a seed, not a conclusion

`build_boards.py` regenerates it from public curated internship lists — regenerate
rather than hand-editing rows. Those lists are kept by people who add a company when it
starts hiring interns, so about a quarter of their boards yield an early-career
software role, against roughly a twentieth of a random ATS registry. We take one fact
from them — which ATS slug a company uses — and nothing else: every board still has to
answer the employer's own API, and postings are always scraped from the employer.

## Filter changes need a real title

`shortlist.py` is where a bug is most silent: a loose pattern fills the page with
senior roles, a tight one empties it, and both look like a working scraper. Every string
in `tests/test_shortlist.py` was observed on a live board — add cases the same way, from
a title you actually saw, including the ones that must be rejected. Tag names are the
`Tag` enum; the page's filter chips read from it too.

**`engineer` on its own is not a software signal**, and reinstating it is the tempting
mistake. Wade Trim posts "Engineer Summer Intern", Olsson posts "Entry-Level Roadway
Engineer", Rocket Lab posts "Thermal Engineering Intern" -- all real early-career
engineering, none of it software. `SWE` names the specialisms explicitly instead. The
cost is accepted: a bare "Engineering Intern" at a software company is dropped too,
because nothing in that title tells it apart from Wade Trim's.

Three more live examples of why the wording is fussy. `\bintern\b` must not fire on
"Internal Applications". `NOT_SOFTWARE` excludes the phrase `hardware engineer` rather
than the word `hardware`, so IMC's "Graduate Hardware Engineer" goes and its "Hardware
Machine Learning PhD Research Internship" stays. `SENIOR` beats the stage, so Together
AI's "Junior/Senior or Staff Software Engineer" -- one opening at any level -- is not a
new-grad role. Firmware and embedded are software.

## The page

One self-contained HTML file laid out as a data table — numbered rows, one fact per
column, `# · Position Title · Date · Apply · Work Model · Location · Company` — because
that is what makes a thousand roles scannable. Three counts up top, filter chips, and
200 rows before a "show all" control. No webfonts, no CDN, no external anything: it
renders identically with the network off, which is the point of `--offline`.

## Tests

pytest, in plain-`assert` style: `Test*` classes group cases without subclassing
`unittest.TestCase`, files get the `tmp_path` fixture rather than `tempfile`. Tested where a bug would be silent: the shortlist (above), and the "new today" and
"open roles" path through `store.py` and `report.py` — a lost `first_seen_at` or a
wrong row flag still renders a plausible page. One shipped marking every row "just
added"; `tests/test_report_and_store.py` has a case for each way that count has been,
or could be, wrong.

## Deliberate limits

Marked in the code with `ponytail:` comments where they apply.

- **Nothing is ever closed** (above).
- **The whole file is loaded and rewritten each run.** Fine at this size.
- **Only matching postings are stored.** Keeping all ~91,000 scanned postings would
  make `jobs.json` tens of megabytes of roles we never display. The page's counts still
  report everything scanned.

## `feed.json` is the backend's only view of us

Every run — `--offline` included — writes `feed.json` from the same roles as the page.
The backend's `app/scripts/import_jobs.py` loads it into Supabase's `job_postings`, and
`GET /jobs` and Scout read the database, never the file. The backend imports none of
this package: `backend/CLAUDE.md` keeps anything outside `backend/` out of its build.
So `feed.row()` is the whole contract, and its fields must match
`backend/app/schemas/jobs.py` — add a field in both or neither, and a new column needs
its migration. Card facts land in `job_postings`' own columns (`job_type`, `salary*`,
`min_years_experience`, `start_term`); descriptions ride along in the rows, and the
list query simply never selects them.

Rows carry the schema's enum values (`onsite`, `new_grad`), not the page's labels
("On site"). `feed.WORK_STYLE` is indexed, not `.get`: a new label from
`providers._work_style` should fail a run, not quietly become `null` in the app.

The scraper still never touches the database.

## Logos are read once per board

A live run reads the board page -- the listing API carries no logo -- of every board
with a job on the page that `Store.logos` has not seen (plus, for a Greenhouse board
with no logo, its job descriptions), and keeps the answer: a URL, or
`null` for a page with no logo. Logos almost never change, so nothing re-reads them;
delete `logos` from `jobs.json` to read them all again. A page that failed to load
records nothing, so the next run retries it. `internships.html` shows no logos -- it
must render with the network off.

No uploaded logo -- or an Ashby one under 64px, which blurs in the 80px tile (Bedrock
uploaded 50px) -- and the logo is the company website's favicon via Google's favicon
service, which answers 404 (so the card's initials) for a site without one. The website
must come from the board: Ashby's `publicWebsite`, a Greenhouse board's job descriptions
(Scale AI, Vercel), or where the board redirects (Stripe). Descriptions and redirects
only count when the domain's name is in the board token or company name
(`logos.stated_site`) -- descriptions also link eeoc.gov and TikTok, and Accenture's
board redirects to a Salesforce host. Never a website guessed from the company name:
"Workshop" is not workshop.com. A board that gives us nothing usable (Moment Energy: a
banner and no links; Waymo: a 32px careers-site icon) can be listed in
`logos.CHECKED_WEBSITES`, which wins over everything -- but only with a site a person
opened and confirmed is the same company.

**`logos.PATTERN` only accepts each ATS's own image host, `favicon` only Google's, and
those hosts must match `frontend/next.config.ts`'s `images.remotePatterns` exactly.** `next/image` throws on
any other host, which fails the whole Jobs page, not one card. Greenhouse is read from
`job-boards.greenhouse.io` because `boards.` redirects there cross-origin; Lever's
`og:image` is a 1200x630 banner, so its header `<img>` is used instead.

## Committed data

Only `boards.csv` is committed, marked `linguist-generated` so it stays collapsed in
review.

`jobs.json` is the store, the `first_seen_at` history, the per-board read ledger and the
offline fallback in one file -- and it is gitignored, at a reviewer's request: it is
megabytes per run, and few people on the team run the scraper. So each machine keeps
its own history. A fresh clone has none: its first live run counts nothing as new
(see "New today" above), and `--offline` refuses to run until a live run has written
the file. `internships.html` and `feed.json` are gitignored output of either command.
