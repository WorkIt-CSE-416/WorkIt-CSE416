# CLAUDE.md — scraper

Repo-wide conventions live in [`../CLAUDE.md`](../CLAUDE.md). This file is the
scraper's design and the rules for changing it; `README.md` is only how to run it.

```sh
cd scraper
python3 -m workit_scraper                          # scrape, then render the page
python3 -m workit_scraper --offline                # no network; render from jobs.json
python3 build_boards.py                            # regenerate boards.csv
python3 -m unittest discover -s tests -t . -v      # the tests
```

## How it fits together

```
boards.csv ─▶ __main__ ─▶ polite.Robots ─▶ providers.FETCHERS ─▶ store.update ─▶ jobs.json
                                                                                   │
                           report.write_html ◀─ shortlist.pick ◀─ Store.is_listed ◀┘
```

| file | owns |
|---|---|
| `boards.csv` | the boards to read: `ats,token,company` |
| `build_boards.py` | regenerating `boards.csv` from public curated internship lists |
| `web.py` | the one HTTP GET: our User-Agent, no cross-origin redirects |
| `polite.py` | robots.txt and per-origin pacing |
| `providers.py` | `Board`, `Job`, and one function per ATS mapping its JSON onto `Job` |
| `store.py` | `jobs.json`, `first_seen_at`, and what "listed" and "new today" mean |
| `shortlist.py` | which postings belong on the page, and collapsing duplicates |
| `report.py` | rendering the page |
| `__main__.py` | the thread pool and the two commands |

All three providers return a whole board in one request, so there is no pagination.

## This package imports only the standard library

`dependencies = []` in `pyproject.toml` is load-bearing, not an accident.
`python3 -m workit_scraper` has to work on a fresh clone with no install step, no
virtualenv and no `uv` — a demo that needs a dependency resolver first is a demo that
can fail in the room. HTTP, JSON, CSV, robots.txt, threads, HTML escaping and the test
runner are all in the stdlib. Keep reaching for it.

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
model; Greenhouse never does, so on a Greenhouse board `Job.work_style` is None unless
the location itself says remote, and the table's cell renders empty. Leave it empty.
Defaulting a missing field to its most common value puts a fact on the page that no
employer stated, and a reader cannot tell the two apart.

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

Tested where a bug would be silent: the shortlist (above), and the "new today" and
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

## Committed data

Only `boards.csv` is committed, marked `linguist-generated` so it stays collapsed in
review.

`jobs.json` is the store, the `first_seen_at` history, the per-board read ledger and the
offline fallback in one file -- and it is gitignored, at a reviewer's request: it is
megabytes per run, and few people on the team run the scraper. So each machine keeps
its own history. A fresh clone has none: its first live run counts nothing as new
(see "New today" above), and `--offline` refuses to run until a live run has written
the file. `internships.html` is gitignored output of either command.
