# Providers — notes per hiring system

How each of Workable, Recruitee and BambooHR is read, and the quirks found adding them. Reached from `../CLAUDE.md`, "Adding a provider"; Greenhouse, Lever and Ashby are documented in `providers.py` itself, and Workday in `workday.md`.

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
  for good (`Provider.page_title`, `store.carry`).
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
