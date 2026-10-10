# CLAUDE.md — scraper

Repo-wide conventions live in [`../CLAUDE.md`](../CLAUDE.md). This file is the
scraper's design and the rules for changing it; `README.md` is only how to run it.

```sh
cd scraper
python3 -m workit_scraper                          # scrape, then write the page and feed.json
python3 -m workit_scraper --full                   # the same, quiet boards included
python3 -m workit_scraper --offline                # no network; rewrite both from jobs.json
python3 build_boards.py                            # add the boards the lists name now
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
| `details.py` | pay, job type, years of experience, start term and visa sponsorship read out of a description |
| `store.py` | `jobs.json`, `first_seen_at`, and what "listed" and "new today" mean |
| `shortlist.py` | which postings belong on the page, each one's category, and collapsing duplicates |
| `report.py` | rendering the page |
| `feed.py` | `feed.json`, the backend's copy of the same roles |
| `logos.py` | each company's logo, read once off its job board's page |
| `__main__.py` | the thread pool and the two commands |

Every provider returns a whole board in one request, so there is no pagination.

## Some postings' own pages are read once, and only for kept postings

What a posting's own text says is one value, `providers.Page`: the description
(plain text, cut to `DESCRIPTION_CHARS` for Scout), the card's `details.Facts`,
and on Greenhouse the posting's offices. Lever, Ashby and Recruitee send it with the
board's list, so their `Job.page` is rebuilt on every read. Greenhouse, Workable and
BambooHR do not (`providers.JOB_URL`). Greenhouse's `content=true` would send every
posting's full HTML, hundreds of megabytes a run to describe the ~2% we keep;
Workable's widget has no work model or pay; BambooHR's list has no description,
date or pay at all. So their listings have `page=None`, and `__main__.with_page`
reads each *kept* posting's own page once (`providers.describe`), through the same
robots and pacing. A posting whose page fails or is disallowed simply has none.

**The store carries a `Page` forward whole: `job.page or old.page`.** That one rule is
the point of the model. It used to be nine flat fields carried one by one, and two
bugs came of it: a Greenhouse listing's title-only "2027" overwrote the page's
"Summer 2027", and Strada's internship stayed "full-time" after Ashby changed it.
Ashby, Lever and Recruitee always bring a fresh page, so theirs always wins.
`posted_at` is carried the same way, for BambooHR, whose date is only on the page.

`Page.version` is the `providers.PAGE_VERSION` it was read under, and `with_page`
reads again any whose version is older. **Bump `PAGE_VERSION` whenever a `Page`
starts holding something new**, or postings already stored never get it; the bump
costs one read per kept Greenhouse, Workable and BambooHR posting, once. `with_page`
only ever sees postings a board just listed, so one that has left its board is never
asked for.

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
5. If its list leaves out the description or a fact the posting's own page has: the
   page's URL in `JOB_URL` and a `describe_<ats>` in `describe`'s table.
6. If its board page has a square logo: `logos.PAGE` and `logos.PATTERN`, and the
   image host in `frontend/next.config.ts` (see Logos below).
7. If each company is its own subdomain: its domain in `polite.SHARED_PACE`.

Read the provider's `robots.txt` before writing anything. SmartRecruiters is absent
because it disallows us, and that is the whole reason.

### Workable, Recruitee and BambooHR (KAN-171)

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

Only Workable's logos are read (below). BambooHR's header logo is served as
`application/octet-stream` from numbered hosts (`images7.bamboohr.com`), which
next/image may refuse, and Recruitee's sits inside a 1 MB board page for the one
board we read; their cards show initials until someone checks both.

**A 404 means the board does not exist. A 200 carrying an empty list means a real board
with nothing open right now.** Raise `BoardNotFound` for the first and return `[]` for
the second. Collapsing them turns a typo in `boards.csv` into "this company stopped
hiring", which nobody notices.

**Providers disagree about types.** Lever sends `createdAt` as an `int` in some records
and a numeric string in others; trusting one shape silently dropped every Lever board on
the first live run. `_iso()` takes `object` and narrows on purpose — normalise through
it rather than reading a provider field directly. Workable and BambooHR send a bare
date and Recruitee "2026-10-08 10:34:56 UTC"; a time with no zone is UTC, never the
machine's own.

**They also disagree about what they publish at all.** Ashby, Lever, Recruitee,
BambooHR and Workable (on its page) state a work model; Greenhouse has no field for one, so a Greenhouse posting states one only when
its location *is* a work model -- Cloudflare names every location "In-Office" -- or a
sentence says so. What the card shows when nothing states it is decided in
`shortlist`; see the card's facts below.

A location that is only a work model is not a place. Cloudflare's Lisbon and London
internships both read "Software Engineer Intern (2027) · In-Office" until `Job.places`
took the city from the posting page's `offices`. Two cards that look identical are
usually this, not a dedupe bug -- `pick` keys on the apply URL on purpose (below).

## The card's facts: the provider's field, then the description, then only a measured rule

The app's card shows six facts: location, job type, salary, work style, level and
years of experience -- or, on an internship, when it starts ("Start in Summer 2027"),
since nobody asks an intern for years. Each is filled from the provider's own field
where it has one (Ashby `employmentType` and `compensation`, Lever `commitment` and
`salaryRange`, Greenhouse `pay_input_ranges` and board metadata, Workable `type` and
`salary_*`, Recruitee `employment_type_code` and `salary`, BambooHR
`employmentStatusLabel` and `compensation`), and otherwise from
the description by `details.py`. What neither states stays null, and the card says
"not listed" -- except work style and job type, each inferred by a measured rule below.

**Facts are read from the whole description, when it is fetched** (`details.read`, from
`providers._page`),
and only then is it cut to `DESCRIPTION_CHARS` for storage. Pay is often the last thing
a posting says, under a long benefits section: reading the stored, cut copy missed it
on a sixteenth of the feed. So `--offline` re-renders the facts a fetch found but finds
no new ones; changing a pattern in `details.py` takes a live run (and, for Greenhouse,
a `PAGE_VERSION` bump) to reach stored postings.

`details.py` is regex over prose, so it is fussy in the same way `shortlist.py` is, and
every case in `tests/test_details.py` was seen in a real posting, except
`TestConstructedGuards` (see the visa section below):

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
- **Job type is the other** (`shortlist._job_type`, KAN-171): what the posting states,
  then "full_time" for a new-grad role or a summer internship (its title or start term
  says Summer, and neither names fall, spring, winter, a semester, part-time or a
  co-op). Measured on the live feed (2026-10-10): 216 of 216 new-grad roles that state
  a type say full-time, and 71 of 74 summer internships (two part-time, one contract).
  Every other internship stays empty: school-year terms and co-ops are often
  part-time. A stated type always wins, so a part-time or contract posting is never
  turned full-time. It runs in `pick`, not `details.read`, so `--offline` applies it to
  stored postings with no re-read. On the cached feed it filled 467 of 1,635 roles
  (empty job types went from 1,047 to 580).
- **A start term comes from the title first.** "Software Engineer Intern (2027)" is the
  employer's label for its cohort. The description can name the season ("our Summer
  2027 program") or a start month, but only of the title's year; a year alone in a
  description is as likely a founding date. Years are any 20xx judged against
  today (`details._near`: last year to three ahead), so no pattern needs editing
  as the calendar moves. A date range in the title starts at its first month
  ("(January - August 2027)" is January, not the "August 2027" at its end), and a
  title's words skip the deadline guard: Rivian's "Applications" is a team. With no
  year anywhere, a bare month or season stands ("May - August", "As a summer
  intern"), taking the title's year when it has one.

**Audit them against the source, not against each other** (2026-10-08). Every posting
showing a "not listed" fact was re-fetched whole from its board and searched; a few were
opened on the employer's own page too, which never showed anything the API did not.
Most gaps were honest -- 444 of 474 without pay, 267 of 311 internships without a start,
253 of 269 new grads without years state none -- and the rest became the patterns now in
`details.py`, each with its posting's sentence in `tests/test_details.py`
(`TestAuditFindings`). What it taught:

- **A period right after an amount proves pay** ("Intern/Undergraduate: $34/hour"),
  unless the money is something else just before it (`_NOT_PAY_BEFORE`: save, budget,
  401(k), allowance -- "save $40,000 a year" is not pay).
- **A currency can be a code with no symbol** ("800 USD monthly", "34.000 - 38.000 EUR",
  "CAD $30-50/hour"), thousands can be "." ("$120.000"), and a range's low end can be
  short ("€55-65,000").
- **A LinkedIn tag (`#LI-Hybrid`) is the employer's own work-style label** and wins;
  **Hybrid beside On site is Hybrid** (Lyft: "in-office on a hybrid schedule, 3 days
  per week"); naming weekdays onsite is hybrid. Greenhouse boards add a "Working
  Conditions" field, and Lever boards sometimes put "Remote" in `commitment`.
- **"Remote" and "hybrid" block the On-site guess only when they are about work**
  (`shortlist.FLEXIBLE`): "remote battery monitoring" and "hybrid cloud" are not.
- **Measure a pattern change on the whole feed before trusting it:** compare every fact
  before and after, and read every *changed* value, not only the newly filled ones. That
  is how three regressions were caught here (a title range read from its end, a
  currency code before the symbol, "lease" matching inside "please").

### Visa sponsorship (KAN-168)

`Facts.sponsorship` is what the posting says about visas, read by `details.sponsorship`
from the whole description like every other fact (visa lines sit near the end, past
the cut on 635 of ~1,090 stored copies):

| value | meaning |
|---|---|
| `citizens_only` | US citizenship, or a US security clearance (which needs it), is required |
| `no_sponsorship` | the role will not sponsor a visa, or requires a US person (below) |
| `sponsors` | the posting says it sponsors, including a benefits bullet "Visa Sponsorship" |
| `None` | nothing usable, which is most postings |

**It is in `feed.json`.** `feed.row()` writes it and the backend's import stores it in
`job_postings.sponsorship`, so these four values are part of the feed's contract with
`backend/app/schemas/jobs.py`: a new value is a change on both sides. `internships.html`
does not show it. Like every fact, a pattern change reaches Lever and Ashby postings on
the next live run and stored Greenhouse postings only when their page is read again,
which is why `PAGE_VERSION` went to 9 when sponsorship was added and to 10 with the
fixes below.

The rules, each from a posting in `tests/test_details.py` (`TestSponsorship`):

- **Read sentence by sentence; strongest wins.** Citizens only beats no, and no beats
  yes, across the whole posting. "U.S." (and "U.S citizen", and the statute's
  "U.S.C.") is rewritten first, or it would end the sentence. "Must be U.S. citizens"
  counts in the plural (OpenAI).
- **A "U.S. person" is not only a citizen.** ITAR's definition takes green card
  holders, refugees and asylees, so "must be a U.S. citizen, lawful permanent resident
  ... or protected individual" (Astranis, Anduril, Varda) is `no_sponsorship`, never
  `citizens_only`: no visa holder qualifies, but a permanent resident does. When the
  same posting offers an export licence instead ("or be eligible to obtain the
  required authorizations": 58 postings at 17 companies, SpaceX, Rocket Lab and
  Antares among them; Hermeus's "deemed export licensing") it says nothing, since a
  visa holder can still be hired. This is the call that most changes the counts: read
  the other way, those 58 would be `no_sponsorship`. The licence has to follow a
  US-person requirement (in its sentence or the ~300 characters after it), and then it
  answers every such requirement in the posting: SpaceX states one in its
  qualifications and the licence in its ITAR paragraph at the very end. A licence that
  follows none is some other licence ("Help our customers obtain export licenses").
  "Open only to U.S. citizens and other U.S. Persons" (GovSignals) or "... or Green Card
  holders" (Skydio, Proto Labs) is a US-person list too.
- **A clearance counts only when it is US and required.** A US marker (US, Secret,
  TS/SCI, DoD, DOE, Q, polygraph) is needed, because Palantir's UK and Australian
  internships ask for their own countries' clearances. The abbreviations are matched
  in capitals only ("join us"), and customs clearance is a shipment's. "A plus but not
  required", "may be required", "not a requirement", Palantir's "For USG:" scoping,
  and any list headed as optional ("What We Value", "Preferred", "Nice to Have",
  `_under_preferred`) do not count; Palantir's verbless "Active US Security clearance,
  or eligibility ..." does under "What We Require".
- **Only the nearest heading decides.** `_under_preferred` walks back to the first
  heading-like line: one ending in a colon, one naming a list ("Requirements", "What Is
  Required", "Strongly Preferred"), or one in capitals (Valinor's "WHAT VALINOR
  OFFERS"). A bulleted line, or one grading itself in lower case (CGS's "- Experience
  with Salesforce preferred", ERG's "PE license is preferred"), is an item, never a
  heading. "Values" is a company's values unless it ends in a colon.
- **OPT and CPT are not sponsorship.** They are the student's own authorization, so
  "OPT/CPT eligible" and Akuna's "including F-1 students using OPT" are `None`, and so
  is a sponsorship that names only them or says "OPT/CPT only" (`_opt_only`). One that
  names an employer's visa beside them stands: Ambrook's "(OPT/CPT, TN, J-1)", Jump
  Trading's "we sponsor work visas". They are read as capitalised whole words, which
  keeps "optimised" and "adoption" out.
- **Statements about this role only.** "Sponsorship for an export license"
  (Cloudflare), "company-sponsored events", "available for selected roles" (Maven),
  "Certain roles may require U.S. Person status" (Rivet) and IMC's rule for
  candidates from Russia, Belarus or Iran (IMC otherwise sponsors) say nothing. Jump
  Trading's "we sponsor work visas for full-time positions" is `sponsors` on its
  full-time postings and `None` on its internships, which is why the function takes
  the title. An internship is "intern", "co-op" or a season in the title ("Summer
  Analyst"); a year alone is not, since new-grad titles carry one too.
- **Negations need their sponsor word, in the same clause.** "We are not able to
  sponsor visas or take over sponsorship" (Enova) is a no that a loose "able to sponsor
  visas" read as yes; Samaya's "aren't able to successfully sponsor visas for every
  role" right after "We do sponsor visas!" is not a no. A negation stops at a comma
  that starts a new clause (Corvus's "preferred but not required, can sponsor visas"
  is a yes) but not at one around an aside ("We are not, at this time, able to sponsor
  visas" is a no; stopping at every comma read it as a yes), and "whether or
  not" and "without regard to sponsorship status" are not one. "Candidates who require
  sponsorship will not be considered" is a no; "when sponsorship is unavailable"
  (Xsolla, on gas fees) is nothing.
- **A need is the candidate's only before the offer.** "Candidates who require
  sponsorship" offers nothing, but Frontier Health's "we are able to sponsor visas if
  required" and n8n's "We can sponsor visas to Germany; ... you need to have existing
  right to work" do, and so does Wordware's "We require US work authorization, but are
  open to O-1 or J-1 visa sponsorship" (the need is past a comma).

Measured 2026-10-09 on a live `--full` run, from each posting's whole text: of 1,103
roles on the feed, 62 `citizens_only`, 97 `no_sponsorship`, 37 `sponsors` and 907
`None`, the same before and after the fixes above (every `sponsors` and
`citizens_only` posting and 30 `no_sponsorship` ones were read against their sentence
in the first pass). The fixes were measured on every description that run read, 38,732
including the boards' senior and non-software roles: 140 changed, every one read, all
judged right (53 to `sponsors`, mostly n8n and Wordware; 70 to `no_sponsorship`, Proto
Labs, GovSignals and Skydio's US-person lists; 17 to `citizens_only`, CGS, ERG,
Valinor and OpenAI). Two first drafts were caught this way: a 60-character limit on
verbless items dropped dozens of real "U.S. Citizenship and ability to obtain ..." lines, and
an export licence counted only beside its sentence lost SpaceX's and Revel's. Known
misses, left as `None` on purpose: a requirement list with no heading and no verb that
could be either list; "authorized to work in the US now and in the future" with no word
of sponsorship.

**`TestConstructedGuards` is the one exception to "seen in a real posting":** KAN-168's
review found bugs with sentences built to show them, and where no live posting said it
that way the built sentence stays, in that class only, as a guard.

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
- **A provider is paced as one host even when each company is its own origin.**
  Recruitee and BambooHR serve every board from `{company}.<provider>.com`, so
  per-origin pacing alone would let a lane's eight workers hit one provider eight
  boards at a time. `polite.SHARED_PACE` gives all of a provider's subdomains one
  lock; each still has its own robots.txt, read up front like any other.
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
  posting we keep -- most of `boards.csv`: 282 of 333 on Lever -- is read on one *day* in
  `QUIET_EVERY` (on every run that day), staggered by its key so each day takes its own
  share, and always once that many days have passed. The cost is accepted: a first posting on a quiet board can
  appear two days late. `--full` reads every board. A board with any kept posting, ever,
  is read every run; nothing closes, so it never turns quiet again.

The page's "postings scanned" counts what this run read, so it is lower on a run that
rested quiet boards.

## `boards.csv` is a seed, not a conclusion

`build_boards.py` grows it from public curated internship lists: run it rather
than hand-editing rows. Those lists are kept by people who add a company when it
starts hiring interns, so about a quarter of their boards yield an early-career
software role, against roughly a twentieth of a random ATS registry. We take one fact
from them — which ATS slug a company uses — and nothing else: every board still has to
answer the employer's own API, and postings are always scraped from the employer.

**The scheduled scrape grows it before every run** (KAN-167). Run once by hand on
2026-09-27 and never again, the committed list had missed 72 companies the lists
named by 2026-10-09: none of them was ever scraped. A run now adds whatever the lists
name that day, so a new company is read on the next run without a commit. That is
safe because the list only grows: a board already in the file is kept, a list that
fails to download raises before anything is written, and the step is
`continue-on-error`, so the scrape still runs on the committed list. Those additions
live only in that run, so re-run `build_boards.py` and commit `boards.csv` now and
then, which keeps a local run reading what the scheduled one does.

**The internship lists are renamed each season** (`Summer2026-Internships` became
`Summer2027-Internships`), and GitHub serves a renamed repo's files at the old address
too, so an old name in `SOURCES` keeps working. Update it to the current name each
season anyway; a list that starts a new repo instead of renaming would otherwise go
unread.

## Filter changes need a real title

`shortlist.py` is where a bug is most silent: a loose pattern fills the page with
senior roles, a tight one empties it, and both look like a working scraper. Every string
in `tests/test_shortlist.py` was observed on a live board — add cases the same way, from
a title you actually saw, including the ones that must be rejected. Tag names are the
`Tag` enum; the page's filter chips read from it too.

**`engineer` on its own is not a signal**, and reinstating it is the tempting
mistake. Wade Trim posts "Engineer Summer Intern", Olsson posts "Entry-Level Roadway
Engineer", Rocket Lab posts "Thermal Engineering Intern" -- all real early-career
engineering, none of it in our five categories. Each category names its specialisms
explicitly instead. The cost is accepted: a bare "Engineering Intern" at a software
company is dropped too, because nothing in that title tells it apart from Wade Trim's.

Two more live examples of why the wording is fussy. `\bintern\b` must not fire on
"Internal Applications". `SENIOR` beats the stage, so Together AI's "Junior/Senior or
Staff Software Engineer" -- one opening at any level -- is not a new-grad role.

## Five categories, one per role (KAN-171)

The page used to keep software and AI roles only. It now keeps the SimplifyJobs lists'
five, the lists `boards.csv` is built from: `software`, `data_ai` (data science, AI and
machine learning), `product` (product management), `quant` (quantitative research,
trading and development) and `hardware`. Still early-career only, still never senior,
and still nothing outside the five: sales, marketing, recruiting, finance, mechanical,
civil and the rest are `NOT_OURS`, whose words beat every category's.

**One category per role, the first in `CATEGORIES` that matches.** `feed.json` carries
it as `role_category`, the backend's `role_category` enum: a new category is a change
on both sides, and a migration. The order is the decision:

1. `QUANT` (quant, quantitative, trader): "Quantitative Developer" is a quant's job.
2. `PRODUCT` (product manager, management, owner, analyst). `SENIOR`'s `manager`
   spares "product manager", or every PM title would read as senior.
3. `DATA_AI`: machine learning, data science and analytics, data engineering, applied
   science, perception, robot learning. ML outranks what it runs on, so IMC's "Hardware
   Machine Learning PhD Research Internship" is data.
4. `HARDWARE`, then 5. `SOFTWARE`. Hardware first, because the software list's generic
   words ("platform", "infrastructure") would otherwise claim a "Hardware Platform
   Development Intern".
6. `ROBOTICS` is hardware only after software has passed: Neuralink's "Software Engineer
   Intern, Robotics" writes software, Bracket Bot's "Robotics Engineering Intern" builds
   robots.
7. `AI` as a bare modifier is weak: "Software Engineer Intern (AI Internal Tools)" is
   software, as SimplifyJobs files 281 of its 347 titles naming both.
8. `TRADING` alone is weak: "Campus Python Software Engineer" at Jump is software,
   "Commodities Trading Intern" is quant, "Trading Operations" is neither.

Decisions, each checked against SimplifyJobs' own labels (their listings carry a
category) and against our scan:

- **Hardware is electrical, computer, embedded and silicon engineering, RF, optics,
  avionics, robotics and mechatronics.** Mechanical, thermal, civil, structural,
  manufacturing and nuclear stay out: different degrees, and SimplifyJobs files 641
  "electrical" titles under Hardware against 74 "mechanical". An electrical engineer for
  buildings and utilities is a civil discipline (Burns & McDonnell's "Electrical
  Engineer-Power Systems", "- Facilities (Healthcare)", "Midstream ..."), and trades are
  not engineering (an "Electrical Apprentice", a "Technician", a robot "Operator").
- **Firmware and embedded are hardware**, "Embedded Software Engineer" included. They
  used to be software here; SimplifyJobs files 681 of 701 under Hardware, which is
  where an embedded seeker looks.
- **Data engineers and data analysts are data**, not software (SimplifyJobs: 665 of
  666, and 1,063 of 1,064).
- **Product designers are out**, and so are program managers: design and program
  management are not among the five. "Product Designer, New Grad" used to slip in on
  nothing; now `product design` is in `NOT_OURS`.
- **Forward deployed engineers are software** (SimplifyJobs: 114 of 130), the one widening
  of the software list.

Measured on a live scan of every board on 2026-10-10 (94,271 postings): kept postings
went from 1,163 to 1,635. By category: software 806, data 347, hardware 258, quant 170,
product 54. Against SimplifyJobs' labels on their own 21,492 titles, 86% of the 6,584
we keep land in the same category; most of the rest is SimplifyJobs filing a company's
every role under one category (Hardware for "Software Engineer Intern" at a chip maker).
False positives found and guarded, each now a test: Waymo's "Quantitative UX
Researcher", Belvedere's "Talent Partner - Trading", Brooks's "Run Perception Graduate
Internship", Hermeus's "Flight Software ... (Hardware-In-The-Loop)", Rivian's "Hardware
Thermal Simulation", Healf's "Software Engineer (Supply Chain)" (a first draft vetoed
"supply chain"). **Known misses, accepted:** an MEP firm's bare "Electrical Engineer
Summer Intern" (Syska Hennessy posts nine) reads as hardware, as nothing in the title
says buildings; Waymo's "Quantitative Software Engineer" reads as quant; "Product
Engineer" and a bare "Product Intern" are dropped, being software at one company and
consumer goods at the next.

**What it costs a run.** Greenhouse reads a page per kept posting, once (above). The
first live `--full` run after the change, on a store from the day before, read 372
pages, 335 of them for roles only the new categories keep, and 25 seconds of logos for
the boards newly on the page: 379 seconds in all, against 349 for the boards alone.
The page reads cost nothing on the clock, since the Greenhouse lane finishes them while
Lever's one-second Crawl-delay is still going; after that first run only the day's new
postings are read.

**Widening the net makes the newly kept roles "new today" once.** Only matching
postings are stored, so the first run after this change counts every newly kept role on
a board already read as new (the known limit under "New today", above). Expect a day of
inflated "new" counts.

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
`min_years_experience`, `start_term`, `sponsorship`), and so does the role's category
(`role_category`, above); descriptions ride along in the rows, and the
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
must come from the board: Ashby's `publicWebsite`, a Workable account's `url`, a Greenhouse board's job descriptions
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
`og:image` is a 1200x630 banner, so its header `<img>` is used instead. Workable's
board page is a script shell, so its logo is read from the account JSON
(`/api/v1/accounts/{slug}`): `logo` on `workablehr.s3.amazonaws.com` under
`/uploads/account/logo/`, never its `open_graph_logo`. It is 120px tall, a square or
a wordmark up to 720 wide (17 of the first 25), which the card letterboxes like any
other wordmark. Recruitee and BambooHR
are not in `logos.PAGE` at all (see the KAN-171 notes above).

## Committed data

Only `boards.csv` is committed, marked `linguist-generated` so it stays collapsed in
review.

`jobs.json` is the store, the `first_seen_at` history, the per-board read ledger and the
offline fallback in one file -- and it is gitignored, at a reviewer's request: it is
megabytes per run, and few people on the team run the scraper. So each machine keeps
its own history -- and the scheduled run (`.github/workflows/scrape.yml`) keeps its own
in the Actions cache, saved after each finished scrape. A fresh clone has none: its first live run counts nothing as new
(see "New today" above), and `--offline` refuses to run until a live run has written
the file. `internships.html` and `feed.json` are gitignored output of either command.
