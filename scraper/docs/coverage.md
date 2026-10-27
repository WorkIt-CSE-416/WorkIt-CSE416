# Coverage and freshness: more boards, read by value (KAN-412)

The scraper's next design: find more company job boards, read them by what they
are worth, and measure what we miss on every run. Reached from `../CLAUDE.md`.
Every number here was measured on 2026-10-27 unless it says otherwise.

**Built:** the board report by source and by cause, `build_boards.py --resolve`,
Lever's EU boards, the two-read closing rule, a second read first for a board
with a miss, and four new measures in `metrics.json` (what a wider shortlist
would keep, whether paged lists are newest first, boards missed once, why boards
went unread). **Next:** the steps below, each decided by the measure it names,
and the changes proposed from Freehire's design.

## Where we stood

| Measure | Number |
|---|---|
| A scrape run | 322,995 postings scanned on 2,577 boards, 17,748 roles on the page |
| Workday's share of the roles | 55% (9,744) |
| Workday boards read whole in one run | 265 of 1,525 (17%); 1,031 left for a later run |
| Open postings in the curated lists | 9,326 |
| ...on links no reader takes | 4,092 (44%) |
| ...on hiring systems we read, behind a company's own address | 689, at 296 companies with no board in `boards.csv` |
| New boards from three more public lists (speedyapply, Northwestern's quant list) | About 70 (1.5%) |
| Companies in Jobright's software new-grad list we have a board for | 44% of 371; our lists name 65% |

The last row matches company names loosely, so read it as a rough figure.
Jobright's public lists link to jobright.ai, never to the employer, so they can
never seed `boards.csv`; that keeps them an independent check on our coverage.

The links no reader takes, by cause, as `build_boards.py` now prints them (open
postings in the lists):

| Cause | Open | What reads it |
|---|---|---|
| An employer's own site (TikTok, ByteDance, Tesla, Amazon, Apple, Meta) | 1,241 | A reader per employer, where robots.txt allows |
| The `go.vansh.nyc` link shortener | 1,537 | `--resolve` |
| iCIMS behind the company's site (`?icims=1`) | 347 | `--resolve` |
| Greenhouse behind the company's site (`?gh_jid=`) | 324 | `--resolve` |
| SuccessFactors career sites | 206 | A new reader |
| SmartRecruiters | 193 | None: its robots.txt disallows us |
| JazzHR, Eightfold, Avature, Jobvite, Taleo, Paylocity, Pinpoint | 264 | New readers, by size |

**The vanshb03 list wraps every apply link in a short link**, so its 1,942
rows named no board, and the old report printed only its row count. 706 of its
open postings are not in Simplify's lists. A source whose links name no board
now says so with a `!` line.

**More curated lists add little.** The lists overlap: three more added about 70
boards to the 4,638 a scheduled run already harvests. Past seasons are read
already: `listings.json` keeps closed rows back to 2015.

## The design: three loops

```
 1. FIND (on request)            2. READ (every run)                  3. MEASURE (every run)
 curated lists ──┐               one-request systems: whole board     metrics.json and the board
 --resolve ──────┼─▶ boards.csv ─▶ paged systems: as now, then        report: causes, sources,
 careers pages ──┤                 an arrival scan once proved        widening steps, list order,
 proved guesses ─┘               new readers, largest cause first     boards missed once
                                        │
                                        ▼
                            feed.json ─▶ import (closes what the feed drops)
```

The rules that keep it safe:

- **A board is proved before it is kept, never guessed.** A board under the
  wrong name would put another company's name on real cards. `--resolve` asks
  the board for the posting's own number (Greenhouse) or finds it in the
  tenant's sitemap (iCIMS); a short link counts only by where it leads.
- **Only complete reads remove a posting, and two in a row** (below).
- **No model during the scrape**, as with `label_headings.py`: rules are free,
  tested and never stop on a quota.
- **Each step names its measure before it starts**, and the next run reports it.

## The steps, in order

| Step | What | Status | Decided by |
|---|---|---|---|
| Measure | The board report, the widening steps, list order, boards missed once, why boards went unread | Built | Itself |
| Fix the doors | Lever EU; `--resolve` for short links, Greenhouse and iCIMS behind company sites | Built; the first `--resolve` run is still to do | The `boards.csv` diff it makes |
| Close on two reads | Below | Built | `boards_missed_once` in metrics.json |
| Workday arrival scan | Read every board's newest pages each run; read whole the boards with the most shown roles | Not built | `newest_first` in metrics.json |
| New readers | SuccessFactors, then Eightfold and JazzHR; then TikTok and ByteDance (one system), Amazon and Apple | Not built | The cause table; each one's robots.txt first |
| Boards beyond the lists | Careers pages of companies the lists name; proved slug guesses; staffing firms left out | Not built | Coverage against Jobright's lists |
| Facts | Entry-level H-1B filing history as its own fact; "Software Engineer I" by the years its description asks | Not built | `widening` in metrics.json |

**Run `--resolve` from a laptop, then commit `boards.csv`.** It asks a few
hundred hosts, so the scheduled run never does it. Its cases are built ones
(`tests/test_build_boards.py`, `TestResolve`): the session that wrote it could
not reach the hosts, so read the first run's diff of `boards.csv` before you
commit it.

**The Workday arrival scan waits for its measure.** It is safe only if a
Workday list names its newest postings first. Each run now counts, for every
paged list read whole, whether it does (`newest_first`, `not_newest_first`,
`order_unclear` under `workday` and `oracle` in metrics.json). Oracle sorts by
date on request already (`sortBy=POSTING_DATES_DESC`). If Workday's lists do
too, the scan reads page one of all 1,525 boards in about 3 minutes, against
today's 265 boards in 12. It then needs three rules:

1. A posting first seen after its board's last complete read is listed, since
   only a complete read can show one gone.
2. Complete reads go first to the boards with the most roles on the page,
   which is what they verify.
3. A self-check: a complete read that finds a new posting older than the last
   arrival scan proves the scan missed it, and that board goes back to
   complete reads only.

## Closing on two complete reads

A posting leaves the feed, and the import closes it, only when two complete
reads of its board in a row lack it (`Store.is_listed`, `BoardReads.prior_read_at`).
One was enough until 2026-10-27, and one bad answer could close a board: a
hiring system mid-outage can answer with an empty list, which reads as a real
board with nothing open. The import's guard stops only a close of more than half
the feed, so one company's postings got past it. A failed or partial read still
counts as no read.

The cost is one more read before a real closing: 3 hours on most boards. A board
holding a posting missed once goes first in its lane's next run
(`Store.missed_once`, `Store.to_read`), so a Workday board waits one run, not a
whole sweep of about a day.

## Refresh: a hot tier, not minutes

Reading every board every few minutes was weighed and turned down:

- A run takes about 15 minutes, and Lever's lane alone 573 seconds at its
  one-second Crawl-delay.
- It would be 36 times today's requests, all from GitHub's shared runners; a
  block on Workday would lose 55% of the page.
- An active company adds an early-career posting about once a week (5,502 at
  1,337 companies in 30 days), so a 5-minute read finds nothing about 2,100
  times for each time it finds one.
- Simplify adds 71% of its postings in two daily batches (00:00 and 22:00 UTC,
  60 days), and 96% arrive on weekdays. Three hours already beats it.

**Instead, a hot tier, not built yet.** Read the boards of companies with three
or more new early-career postings in the last two weeks every 30 minutes on
weekdays, 13:00 to 02:00 UTC. Tested on the lists: the 219 companies that rule
picked made 47% of the next two weeks' postings; with two or more, 382 made 55%.
It needs a delta import first: the import takes 80 to 133 seconds today because
it re-checks every job's places and roles. Change 4 under "Proposed next" would
replace this tier with a rule that finds each board's pace by itself.

## More roles: measured before taken

Each run scans about 323,000 postings and keeps 3%, so more roles cost no more
list requests; the cost is everything after the list. `widening` in
metrics.json files every scanned posting under the first step that would keep it
(`shortlist.widening_step`):

| Step | Adds | What it costs |
|---|---|---|
| `held_field` | Early career in the fields we hold off on: law, consulting, teaching, the arts, policy, support | Shortlist rules and tests, the backend's role aliases |
| `no_field` | Early career, naming no field ("Engineering Intern") | A rule that reads the description |
| `no_stage` | Our fields, no stage word ("Software Engineer I") | Kept only when the description asks for 0 to 2 years: a page read each on 7 of 10 systems |
| `senior` | Experienced roles in our fields | The limits below |

Experienced roles would be about 10 to 25 times today's roles, by estimate, and
hit four limits: Supabase's free plan allows 500 MB of database, against 1 to 4
GB for them; Workday's 432,000 postings take about 15 hours of page reads; the
import no longer fits the 30-minute job; and the keyword pass extracts at most
100 a run. Search and recommendations would also have to default to a student's
own levels. The feed and the app already accept the `experienced` level.

## Later: the schedule from Cloudflare

GitHub ran 50 of the 94 scheduled slots between 2026-10-16 and 10-27 (53%), a
median 102 minutes late (at most 170). The real gap between runs was a median
5.5 hours, at most 8.7: a 3-hour schedule that delivers about 6.

1. **A Cloudflare Cron Trigger starts `scrape.yml`** through GitHub's API at
   exact times. It is free and small, and it ends the late runs and the 60-day
   pause. The runs stay on GitHub: the cache, logs and failure emails. It needs a
   GitHub token owned by the team, not one person. Keep one daily GitHub schedule
   as a fallback, in case the token lapses.
2. **The scrape in a Cloudflare Container**, only when something needs it: a
   provider limiting GitHub's runners, or a store too large for the Actions
   cache. A Cron Trigger's own run stops at 15 minutes, so the Worker starts the
   container and returns. The disk starts empty, so the store moves to R2. It
   costs about $5 to $7 a month.

## Proposed next, from Freehire's design

[Freehire](https://github.com/strelov1/freehire) is an open-source job search
engine in Go with about 3.4 million open postings (2026-10-20). Its ingest code
(`internal/ingest`) has solved several problems we have. Changes 1 and 2 are
built (`Store.health`, `fetch._hold`); the rest are proposed.

| # | Change | Freehire's version | Why we need it | Cost |
|---|---|---|---|---|
| 1 | Rest a board that keeps failing or is gone | After 3 failures in a row, wait 6 hours, doubling to 24; never for good | The last run asked 191 boards that said "no such board" and 12 that failed, and since boards are never removed, every run asks them again | Small: `BoardReads`, `Store.to_read` |
| 2 | Pause a whole host after a 429 | A 429 holds every request to that host: its `Retry-After`, else 1 second doubling to 60, reset by a success | We retry one request once. Freehire found Workday throttles hard, and an arrival scan adds 1,525 Workday requests a run | Small: `polite.Robots` |
| 3 | Never close on an empty list | A board that returns no postings never licenses a close | Two reads stop one empty answer, but a hiring system that answers every board empty for a day would still close them all; `SURGE` covers only "no such board" | Small: the lane guard in `__main__.scrape` |
| 4 | Rest a board whose kept postings did not change | A hash of the board's posting ids; unchanged, wait 4 hours, doubling to 72; any change resets | An active company adds an early-career posting about once a week, so the hash of its kept postings rarely changes. It makes a 30-minute schedule cheap and replaces the hot tier. Cap the wait at 12 to 24 hours, so arrivals and closings stay fast | Medium: `BoardReads`, `Store.to_read`; `QUIET_EVERY` goes |
| 5 | Import only what changed | An unchanged posting only refreshes its "last seen"; search and AI work only on changes | The import takes 80 to 133 seconds, because it re-checks every job's places and roles on every run | Medium: a `content_hash` column and its migration |
| 6 | Store why a posting closed | `closed_reason` on every close | A wrong close can be found and undone as a set | Small: a column and its migration |
| 7 | Find boards on companies' own careers pages | Read the page and take the first link to a known hiring system, its API addresses included (`api.ashbyhq.com/posting-api/job-board/<org>`) | 1,241 open list postings are on employers' own sites; how many of those pages name a board is not measured | Small to medium: `--resolve` |
| 8 | Readers for Amazon, Apple and Google | Career-site adapters, with no proxy | 85, 77 and 24 open list postings | One reader each, robots.txt first |
| 9 | One hiring system per job, on its own schedule | A scheduler, with large providers in parts (Workday in 6) | Workday gets 12 minutes a run and reads 17% of its boards | Large: a store file per provider, then a job each |
| 10 | One card for a role posted in several cities | A hash of company and title without the place; the copies are marked, never deleted | A product choice: `pick` keys on the apply URL on purpose | Medium, with the Jobs page |

**Residential proxies are under discussion.** Freehire sends some providers
through them because those sites block data-centre addresses, and for others it
uses browser-like User-Agents and solves captchas. The `unread` counts in
metrics.json now say what proxies would unlock; from the lists, only Eightfold's
boards (about 62 open postings) need nothing more than another address. The
risks: in *Craigslist v. 3Taps* (2013) a court held that an IP block and a
cease-and-desist letter revoke permission under the CFAA; Google and the FBI took
down residential proxy networks built on devices whose owners never agreed
(NetNut, IPIDEA); and it reverses our rule that a site's "no" is final. A
decision either way goes in an ADR.

## How it compares

| | WorkIt | Jobright | Simplify's lists | Hiring Cafe |
|---|---|---|---|---|
| Postings from | Each employer's hiring system, read whole | Job boards, career sites and public listings, combined | Volunteers, reviewed by maintainers | Company career pages, crawled |
| Apply link | The employer's page | Its public lists link to jobright.ai | The employer's page | The employer's page |
| A closed posting | Leaves after two complete reads lack it | Expired listings are the most common complaint in reviews | Marked by hand | Not published |
| Its date | Our own first-seen time, which never moves | The posted date | Days since added | Not published |
| Scope | Early career, with every keep rule tested on a real title | Every level; claims 8 million jobs | Internships and new grads | Every level |

Sources: Jobright's [App Store page](https://apps.apple.com/us/app/jobright-ai-job-search/id6738236788)
and [public list](https://github.com/jobright-ai/2026-Software-Engineer-Internship);
Simplify's [list](https://github.com/SimplifyJobs/Summer2026-Internships);
Hiring Cafe [as reviewed](https://www.dreamworkhq.com/blog/hiring-cafe-review).
Several review sites sell competing products.
