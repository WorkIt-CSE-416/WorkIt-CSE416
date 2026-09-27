# scraper

Finds internship and new-grad software roles on company job boards and renders them
as one HTML page.

```sh
cd scraper
python3 -m workit_scraper              # scrape live, then render
python3 -m workit_scraper --offline    # no network; render from jobs.json
open internships.html
```

**No install step.** No dependencies, no virtualenv, no `uv`. Python 3.12+ and the
standard library. A demo that needs `uv sync` first is a demo that can fail.

## How it works

```
__main__.py  ─▶ providers.fetch ─▶ merge first_seen ─▶ jobs.json
                                                          │
                     report.write_html ◀─ shortlist.pick ◀─┘
```

| file | what it owes you |
|---|---|
| `boards.csv` | the boards to read: `ats,token,company` |
| `providers.py` | one function per ATS. Makes the request, maps fields onto `Job` |
| `shortlist.py` | decides what belongs on the page, and collapses duplicates |
| `report.py` | renders the page |
| `__main__.py` | robots.txt, threads, merging, and the two commands |
| `jobs.json` | the store, the `first_seen_at` history, and the offline fallback |

Three providers: **Greenhouse**, **Lever**, **Ashby**. All three return a whole board
in one request, so there is no pagination. All three 404 on a slug that does not
exist, which is what lets "no such board" stay distinct from "real board, nothing
open right now".

## Two rules worth knowing

**We obey robots.txt.** Checked once per origin per run with stdlib
`urllib.robotparser`; `Crawl-delay` is honoured by serialising the origins that ask
for one. Lever asks for 1s. SmartRecruiters disallows us entirely, which is why it is
not a provider here.

**`first_seen_at` is written once and never updated.** `posted_at` is the employer's
claim about when a posting went up, and an employer can re-stamp it. `first_seen_at`
is our own observation, and they cannot. It reads as the current run on a first
scrape and becomes the more trustworthy signal from the second run onward.

## Deliberate limits

Marked in the code with `ponytail:` comments.

- **Nothing is ever closed.** A posting that disappears keeps its last `last_seen_at`
  and stays in `jobs.json`. This is the safe direction: it cannot wrongly retire a
  live job. Closing correctly needs a two-miss rule — only a *complete* listing may
  count as evidence of absence, or one timeout closes a whole company's board — and
  that lands with the ticket that needs it.
- **The whole file is loaded and rewritten each run.** Fine at this size.
- **Only matching postings are stored.** Keeping all ~7,800 scanned postings made
  `jobs.json` 4 MB of sales and marketing roles we never display. The page's funnel
  still counts everything scanned.

## Tests

```sh
cd scraper && python3 -m unittest discover -s tests -t . -v
```

`shortlist.py` is the only place a bug would be silent — a bad regex quietly fills
the page with senior roles, or quietly drops every internship — so it is the only
thing with a test. Every title in the test file was observed on a live board,
including the ones that must be rejected.
