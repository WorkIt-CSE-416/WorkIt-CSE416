# How job postings get onto WorkIt

How a job posting travels from a company job board to a card a student can
filter, open and apply to. Each section stands on its own, so read the one you
need.

> **Status (2026-10-10).** This describes the code on `KAN-171-more-jobs`,
> which builds on PRs #91 (filters and visa) and #92 (the job posting page).
> The role categories need their database migration applied before they go
> live (section 5.3).

## Three words used throughout

| Term | Means | Example |
|---|---|---|
| **Hiring system** | Software companies pay for to post jobs and collect applications (also called an ATS, applicant tracking system) | Greenhouse, Workable |
| **Company job board** | One company's page on a hiring system, listing only its own open jobs | Stripe's page on Greenhouse |
| **Job posting** | One open job on a company job board, and the row we store for it | "Software Engineer Intern" at Stripe |

One hiring system hosts thousands of company job boards; each company job board
lists that company's job postings. Our own page of results is called **the
Jobs page** (`/jobs`), never a job board, so the two can't be confused.

---

## 1. The big picture

```
 Company job boards          Scraper (Python)              Database (Supabase)
 on Greenhouse, Lever, ──▶  reads, keeps, reads    ──▶    job_postings
 Ashby, Workable,           the facts                     job_locations
 BambooHR, Recruitee
                            writes feed.json               ▲
                                  │                        │
                                  └──── import script ─────┘
                                        (every 3 hours)
                                                           │
 Student's browser    ◀──   Next.js website   ◀──   FastAPI (GET /jobs ...)
 cards, filters, page       /jobs, /search,          filters, counts,
                            /jobs/[id]               one job posting
```

| Stage | What it does | Where the code lives |
|---|---|---|
| 1. Find companies | Keeps a list of company job boards to read | `scraper/boards.csv`, `scraper/build_boards.py` |
| 2. Scrape | Reads every company job board, keeps early-career job postings, reads their facts | `scraper/workit_scraper/` |
| 3. Import | Loads the scraper's output into the database | `backend/app/scripts/import_jobs.py` |
| 4. Store | Two tables hold the job postings and their places | `backend/app/models/jobs.py`, `backend/alembic/` |
| 5. Serve | The API filters, counts and pages the job postings | `backend/app/routers/jobs.py` |
| 6. Show | The Jobs page, search, filters and each job posting's page | `frontend/src/app/(seeker)/jobs/`, `.../search/` |

The scraper never touches the database, and the website never touches the
database. Each hands its output to the next stage.

---

## 2. Finding companies

We read job postings straight from each company job board, through the free
public API its hiring system offers. No hiring system publishes a directory of
its company job boards, so we keep our own list.

| | |
|---|---|
| **The list** | `scraper/boards.csv`: about 2,130 company job boards (table below) |
| **Where it comes from** | `build_boards.py` reads the apply links in public GitHub internship lists (SimplifyJobs and vanshb03, Summer 2027) and pulls out each company job board's name, plus a few added by hand |
| **How often it's rebuilt** | By hand, when someone runs `build_boards.py` |
| **Slug** | A company job board's name in its address, like `stripe` in `boards.greenhouse.io/stripe` |

| Hiring system | Company job boards | Who uses it | How a company job board is read |
|---|---|---|---|
| Greenhouse | 871 | Tech companies of every size | Its list, then each kept job posting's own page |
| Ashby | 694 | Startups | One request, everything included |
| Lever | 341 | Startups and mid-size | One request; Lever asks for one second between requests |
| Workable | 178 | Small and mid-size companies | Its list, then each kept job posting's own page (for hybrid and pay) |
| BambooHR | 42 | Small and mid-size companies | Its list, then each kept job posting's own page (the list has no description) |
| Recruitee | 2 | Small companies, mostly in Europe | One request, everything included |

Workable, BambooHR and Recruitee were added in KAN-171. Recruitee has so few
company job boards because the GitHub lists barely mention it.

The GitHub lists are only used as a phone book. Every job posting itself is
read from the company's own job board, so we get job postings the lists never
added, the full description, and a reliable signal when a job posting closes.

---

## 3. Scraping

`.github/workflows/scrape.yml` runs the scraper and then the import **every 3
hours, at 17 minutes past** (off the hour, since GitHub delays runs scheduled
on it). A run takes a few minutes.

### What one run does

| Step | What happens |
|---|---|
| 1. Pick company job boards | One that has ever had a job posting we keep is read every run. The rest ("quiet" ones) are read one day in three, so a first job posting at a quiet company can appear up to two days late. `--full` reads them all. |
| 2. Read politely | Checks each site's `robots.txt`, waits between requests (Lever asks for one second) and names itself honestly. Each hiring system has its own lane of workers, so slow Lever doesn't hold up Greenhouse. BambooHR and Recruitee give every company its own subdomain, and each hiring system's subdomains share one pace. |
| 3. Keep the right job postings | Checks each title (section 3.1). About 100,000 job postings are read; about 1,700 are kept. |
| 4. Fetch full pages | Greenhouse, Workable and BambooHR lists leave out the description, pay or work style, so the scraper reads the full page of each kept job posting there, once. |
| 5. Read the facts | Pulls pay, job type, work style, start date, years and visa out of each kept job posting (section 3.2). |
| 6. Merge duplicates | Job postings that share one apply link become one, with all their locations. |
| 7. Write files | `jobs.json` (the scraper's memory between runs) and `feed.json` (what the import loads). |

**A job posting only disappears after a complete read of its company job
board.** If a company job board fails to load, its job postings are kept as
they were.

### 3.1 Which job postings are kept

A title must pass three checks:

| Check | Passes | Fails |
|---|---|---|
| **Early career** | intern, co-op, new grad, graduate, entry level, junior, university, campus, apprentice | anything senior, staff, principal, director, manager |
| **In one of five categories** | see the table below | a title naming none of them |
| **Not another discipline** | | sales, marketing, recruiting, HR, finance operations and similar |

Each kept job posting gets **one category** (KAN-171), using the same five
categories as the SimplifyJobs lists:

| Category | Stored as | Examples | Kept (scan of 2026-10-10) |
|---|---|---|---|
| Software Engineering | `software` | Software Engineer Intern, Backend, Mobile, DevOps | 806 |
| Data Science, AI & ML | `data_ai` | Applied Scientist Intern, Data Analyst, Data Engineer | 347 |
| Hardware Engineering | `hardware` | Electrical Engineering Intern, FPGA, Firmware, Robotics | 258 |
| Quantitative Finance | `quant` | Quantitative Trader Intern, Quant Researcher | 170 |
| Product Management | `product` | Product Management Intern, Associate Product Manager | 54 |

Until KAN-171 only Software and AI job postings were kept. Edge cases: firmware
and embedded count as Hardware, "Quantitative Developer" counts as Quant, and
mechanical, civil and building-services roles stay out.

### 3.2 Reading the facts

The rule everywhere: **use the hiring system's own field first, then the
description's text, and never guess.** A missing fact stays empty rather than
filled with a likely value.

| Fact | Where it comes from | How often a job posting states it |
|---|---|---|
| Location | The company job board's location text | Almost always |
| Work style (remote, hybrid, on-site) | The hiring system's field (Ashby, Lever, Workable, BambooHR); on Greenhouse, a location that says "Remote"; else the description | About 97% |
| Experience level | The title (internship or new grad) | Always |
| Job type (full-time, part-time, contract) | The hiring system's field, else the description | Most |
| Pay | The description ("$40-$50/hr"), never a funding amount | About 60% |
| Start date | The description ("Summer 2027") | Most internships |
| Years of experience | The description ("2+ years") | Some new-grad roles |
| Visa sponsorship | Sentences in the description (KAN-168) | About 1 in 6 |
| Role category | The title (section 3.1) | Always |

Visa sponsorship has three answers, or none when the job posting doesn't say:

| Value | Means |
|---|---|
| `sponsors` | The job posting says it sponsors visas |
| `no_sponsorship` | It says it doesn't, or needs US work authorization |
| `citizens_only` | It needs US citizenship (often for a security clearance) |

Long descriptions are cut at 8,000 characters, ending in " …".

---

## 4. Import

`import_jobs.py` loads `feed.json` into the database, all in **one
transaction**: if any step fails, nothing changes.

| Step | What happens |
|---|---|
| 1. Check | Every row is checked against the API's schema |
| 2. Read places | Each location's text is turned into place codes (section 5.2) |
| 3. Upsert | New job postings are added, changed ones updated, unchanged ones left alone. A job posting is identified by its apply link. |
| 4. Places | Each job posting's place rows are brought in line |
| 5. Close | Job postings no longer in the feed are marked closed; one that comes back reopens |

**Safety net:** the import refuses to close more than half the job postings at
once and rolls back. A broken scrape fails loudly instead of emptying the site.

`--dry-run` does everything and then rolls back; pull requests that touch the
scraper run it that way.

---

## 5. Storage

### 5.1 `job_postings`, one row per job posting

Scraped job postings and ones companies post on WorkIt themselves share this
table. Scraped ones have no `company_id`.

| Column | Holds |
|---|---|
| `title`, `company_name`, `apply_url`, `company_logo_url` | What the card shows; `apply_url` is unique |
| `description` | The full text, for the job posting's page and Scout |
| `location_raw` | The location as written, for display |
| `work_style` | `remote`, `hybrid`, `onsite`, or empty |
| `experience_level` | `internship` or `new_grad` |
| `job_type` | `full_time`, `part_time`, `contract`, or empty |
| `salary_min`, `salary_max`, `salary_currency`, `salary_period` | Pay as a range, with its period (hour, week, month, year) |
| `start_term` | As the job posting says it, like "Summer 2027" |
| `min_years_experience` | A number, or empty |
| `sponsorship` | Section 3.2's three values, or empty |
| `role_category` | Section 3.1's five values (new in KAN-171) |
| `status`, `posted_at` | Published or closed; when the company job board says it went up |
| `embedding`, `fts` | For job matching (KAN-139), not used by the Jobs page yet |

### 5.2 `job_locations`, one row per place a job posting is in

A job posting in three cities has three rows. Each row is a country code (`US`)
and optionally a state (`US-CA`). Filtering by place reads these rows; the card
shows `location_raw` instead.

| Location text | Rows |
|---|---|
| "San Francisco, CA" | `US`, `US-CA` |
| "New York, NY; Austin, TX" | `US`/`US-NY`, `US`/`US-TX` |
| "London, UK" | `ZZ` ("Other": every country except the US, for now) |
| "Remote" | none: this table holds places, and remote is a work style |

The **location resolver** (`backend/app/services/location_resolver.py`) does
the reading. It knows city, state and country names and handles typos and
abbreviations. A handful of locations name no real place ("Any SpaceX Site")
and get no rows.

### 5.3 Changing the schema

Alembic owns the schema. A new column is a migration, which must be **merged to
`main` before anyone applies it** to the shared database, and only a person
runs `uv run alembic upgrade head`. The role categories' migration
(`aa41fdc1ba80`) is waiting on exactly that.

---

## 6. The API

All public, no sign-in needed (they serve public job postings).

| Endpoint | Returns |
|---|---|
| `GET /jobs` | A page of published job postings, newest first, without descriptions |
| `GET /jobs/count` | How many job postings match, for "Show 128 Jobs" and /search's count |
| `GET /jobs/facets` | How many job postings each filter option holds, across the whole feed |
| `GET /jobs/locations` | Every country and state that has job postings, with counts |
| `GET /jobs/{id}` | One job posting with its description, or 404 once closed |

### Filters (`GET /jobs` and `GET /jobs/count`)

Several values in one filter mean **any of them**; different filters combine
with **and**.

| Parameter | Example | Matches |
|---|---|---|
| `location` | `US`, `US-CA` | A place row there, **or a remote job posting that names no place** (it can be done from anywhere) |
| `work_style` | `remote` | That work style |
| `experience` | `internship` | That level |
| `job_type` | `full_time` | That type |
| `role` | `quant` | That category |
| `posted_within` | `7` | Posted in the last 7 days |
| `min_pay`, `max_pay`, `pay_per` | `30`, `50`, `hour` | A pay range that overlaps this one, compared as yearly US dollars (hour × 2,080, week × 52, month × 12) |
| `start_term` | `summer-2027` | That season; seasons that have ended aren't offered |
| `visa` | `sponsors` | Says it sponsors. `not_ruled_out` keeps job postings that sponsor or don't say |
| `q` | `stripe` | The title or company name contains the words |
| `limit`, `offset` | `51`, `50` | Paging, for Load More |

**A filter hides job postings that don't state that fact.** Picking a salary
range hides the roughly 40% that give no pay. That's deliberate: a job posting
can't be shown as matching a fact it never stated.

---

## 7. The Jobs page

### 7.1 `/jobs` and `/search`

| Piece | How it works |
|---|---|
| **Filters live in the address** | `/jobs?work_style=remote&role=quant`. A reload or a shared link keeps them. A value the API would refuse is dropped, not shown as an error. |
| **The filter row** | Location, Role, Workplace, Experience, Date Posted, Job Type, Visa, plus All Filters. As the window narrows, filters move into All Filters one at a time; Location always stays. |
| **All Filters** | One panel with every option as chips. Changes are a draft until "Show N Jobs", whose number is counted live. |
| **Counts beside options** | From `/jobs/facets` and `/jobs/locations`, cached for 5 minutes (they only change when an import runs). |
| **Applying a filter** | The list dims at once while the narrowed list loads. |
| **Load More** | The first 50 job postings, then a button adding 50 more with the same filters, until "That's every role that matches." |
| **Search** | The words go to the API (`q`), so a search covers every job posting, not only the first 50. |
| **Pinned header** | The title and filters stay at the top while the list scrolls; on a phone only the filter row stays. |

### 7.2 A job posting's page, `/jobs/[id]`

| Piece | How it works |
|---|---|
| **Opening it** | A click anywhere on a card |
| **Header** | The same facts as the card, and the company logo |
| **About the Role** | The description, with headings and bullet lists recovered from the plain text |
| **Actions** | Apply Now (the company's own page), Ask Scout, Share (copies the link). Save and Report aren't built yet. |
| **Back to Jobs** | Returns to the list you came from, with its filters |

### 7.3 Coming back

The app scrolls inside its own panel rather than the browser window, so the
browser can't restore your place by itself. The app does it instead:

| You come back by | You land |
|---|---|
| Browser Back or Forward | Where you were, on any page in the app |
| "Back to Jobs" | Where you were in the list, with your Load More pages still loaded (for 30 minutes) |
| A sidebar link or a fresh link | At the top |

---

## 8. Known limits

| Limit | Why | What would fix it |
|---|---|---|
| Six hiring systems, not the ones large companies use | Each hiring system needs its own reader | Workday (most large employers) is KAN-134 |
| Every country but the US is "Other" | Only the US is in the countries table | Add countries in a migration (the resolver needs no change) |
| Only internships and new-grad roles | The scraper keeps early-career titles only | A product decision |
| Many job postings lack pay, start date or visa | Companies don't state them | Nothing on our side; filters hide these job postings |
| The list of company job boards goes stale | `build_boards.py` runs by hand | Run it on a schedule |
| A new job posting at a quiet company can be two days late | Quiet company job boards are read one day in three | `--full` runs, or reading more often |

---

## 9. Where to look

| To change... | Start in |
|---|---|
| Which company job boards are read | `scraper/build_boards.py`, `scraper/boards.csv` |
| How a hiring system's company job boards are read | `scraper/workit_scraper/providers.py` |
| Which job postings are kept, and their category | `scraper/workit_scraper/shortlist.py` |
| How a fact is read from a description | `scraper/workit_scraper/details.py` |
| What the import writes | `backend/app/scripts/import_jobs.py` |
| How a location becomes a place | `backend/app/services/location_resolver.py` |
| A filter's meaning | `backend/app/routers/jobs.py` (`JobFilters`, `matching`) |
| A filter's options and URL | `frontend/src/app/(seeker)/jobs/filter-query.ts` |
| The filter row and panel | `.../jobs/filters.tsx`, `.../jobs/all-filters.tsx` |
| The list and Load More | `.../jobs/feed-list.tsx` |
| The card | `frontend/src/components/job-posting-card.tsx` |
| A job posting's page | `.../jobs/[jobId]/` |

Each folder's `CLAUDE.md` holds the detailed rules and the reasons behind them;
this page is the map. The code itself says "board" for a company job board
(`boards.csv`, `Board`) and "provider" for a hiring system.
