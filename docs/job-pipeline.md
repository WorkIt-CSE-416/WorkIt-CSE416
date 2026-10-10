# How jobs get onto WorkIt

How a job travels from a company's job board to a card a student can filter,
open and apply to. Each section stands on its own, so read the one you need.

> **Status (2026-10-10).** This describes the code on `KAN-171-more-jobs`,
> which builds on PRs #91 (filters and visa) and #92 (the job page). The role
> categories need their database migration applied before they go live
> (section 5.3).

---

## 1. The big picture

```
 Company job boards          Scraper (Python)              Database (Supabase)
 Greenhouse, Lever,   ──▶   reads, keeps, reads    ──▶    job_postings
 Ashby, Workable,           the facts                     job_locations
 BambooHR, Recruitee
                            writes feed.json               ▲
                                  │                        │
                                  └──── import script ─────┘
                                        (every 3 hours)
                                                           │
 Student's browser    ◀──   Next.js website   ◀──   FastAPI (GET /jobs ...)
 cards, filters, page       /jobs, /search,          filters, counts,
                            /jobs/[id]               one job
```

| Stage | What it does | Where the code lives |
|---|---|---|
| 1. Find companies | Keeps a list of company job boards to read | `scraper/boards.csv`, `scraper/build_boards.py` |
| 2. Scrape | Reads every board, keeps early-career roles, reads their facts | `scraper/workit_scraper/` |
| 3. Import | Loads the scraper's output into the database | `backend/app/scripts/import_jobs.py` |
| 4. Store | Two tables hold the jobs and their places | `backend/app/models/jobs.py`, `backend/alembic/` |
| 5. Serve | The API filters, counts and pages the jobs | `backend/app/routers/jobs.py` |
| 6. Show | The job board, search, filters and the job page | `frontend/src/app/(seeker)/jobs/`, `.../search/` |

The scraper never touches the database, and the website never touches the
database. Each hands its output to the next stage.

---

## 2. Finding companies

We read jobs straight from each company's own job board, through the free
public API its hiring software offers. There is no public directory of every
company on those systems, so we need a list.

| | |
|---|---|
| **The list** | `scraper/boards.csv`: about 2,130 boards (table below) |
| **Where it comes from** | `build_boards.py` reads the apply links in public GitHub internship lists (SimplifyJobs and vanshb03, Summer 2027) and pulls out each company's board name, plus a few boards added by hand |
| **How often it's rebuilt** | By hand, when someone runs `build_boards.py` |
| **Words to know** | **ATS** (applicant tracking system): the hiring software a company uses, like Greenhouse. **Board**: one company's page on it. **Slug**: the board's name in its address, like `stripe` |

| Hiring system | Boards | Who uses it | How a board is read |
|---|---|---|---|
| Greenhouse | 871 | Tech companies of every size | Board list, then each kept job's own page |
| Ashby | 694 | Startups | One request per board, everything included |
| Lever | 341 | Startups and mid-size | One request per board; asks for one second between requests |
| Workable | 178 | Small and mid-size companies | Board list, then each kept job's own page (for hybrid and pay) |
| BambooHR | 42 | Small and mid-size companies | Board list, then each kept job's own page (the list has no description) |
| Recruitee | 2 | Small companies, mostly in Europe | One request per board |

Workable, BambooHR and Recruitee were added in KAN-171. Recruitee has so few
boards because the GitHub lists barely mention it.

The GitHub lists are only used as a phone book. Every job itself is read from
the employer's own board, so we get jobs the lists never added, the full
description, and a reliable signal when a job closes.

---

## 3. Scraping

`.github/workflows/scrape.yml` runs the scraper and then the import **every 3
hours, at 17 minutes past** (off the hour, since GitHub delays runs scheduled
on it). A run takes a few minutes.

### What one run does

| Step | What happens |
|---|---|
| 1. Pick boards | A board that has ever had a job we keep is read every run. The rest ("quiet" boards) are read one day in three, so a first job at a quiet company can appear up to two days late. `--full` reads every board. |
| 2. Read politely | Checks each site's `robots.txt`, waits between requests (Lever asks for one second) and names itself honestly. Each provider has its own lane of workers, so slow Lever doesn't hold up Greenhouse. BambooHR and Recruitee give every company its own subdomain, and each provider's subdomains share one pace. |
| 3. Keep the right jobs | Checks each title (section 3.1). About 100,000 postings are read; about 1,700 are kept. |
| 4. Fetch full pages | Greenhouse, Workable and BambooHR lists leave out the description, pay or work style, so the scraper reads the full page of each kept job there, once. |
| 5. Read the facts | Pulls pay, job type, work style, start date, years and visa out of each kept job (section 3.2). |
| 6. Merge duplicates | Postings that share one apply link become one job with all their locations. |
| 7. Write files | `jobs.json` (the scraper's memory between runs) and `feed.json` (what the import loads). |

**A job only disappears after a complete read of its board.** If a board fails
to load, its jobs are kept as they were.

### 3.1 Which jobs are kept

A title must pass three checks:

| Check | Passes | Fails |
|---|---|---|
| **Early career** | intern, co-op, new grad, graduate, entry level, junior, university, campus, apprentice | anything senior, staff, principal, director, manager |
| **In one of five categories** | see the table below | a title naming none of them |
| **Not another discipline** | | sales, marketing, recruiting, HR, finance operations and similar |

Each kept job gets **one category** (KAN-171), using the same five categories
as the SimplifyJobs lists:

| Category | Stored as | Examples | Kept (scan of 2026-10-10) |
|---|---|---|---|
| Software Engineering | `software` | Software Engineer Intern, Backend, Mobile, DevOps | 806 |
| Data Science, AI & ML | `data_ai` | Applied Scientist Intern, Data Analyst, Data Engineer | 347 |
| Hardware Engineering | `hardware` | Electrical Engineering Intern, FPGA, Firmware, Robotics | 258 |
| Quantitative Finance | `quant` | Quantitative Trader Intern, Quant Researcher | 170 |
| Product Management | `product` | Product Management Intern, Associate Product Manager | 54 |

Until KAN-171 only Software and AI roles were kept. Edge cases: firmware and
embedded count as Hardware, "Quantitative Developer" counts as Quant, and
mechanical, civil and building-services roles stay out.

### 3.2 Reading the facts

The rule everywhere: **use the job board's own field first, then the
description's text, and never guess.** A missing fact stays empty rather than
filled with a likely value.

| Fact | Where it comes from | How often a posting states it |
|---|---|---|
| Location | The board's location text | Almost always |
| Work style (remote, hybrid, on-site) | The board's field (Ashby, Lever, Workable, BambooHR); on Greenhouse, a location that says "Remote"; else the description | About 97% |
| Experience level | The title (internship or new grad) | Always |
| Job type (full-time, part-time, contract) | The board's field, else the description | Most |
| Pay | The description ("$40-$50/hr"), never a funding amount | About 60% |
| Start date | The description ("Summer 2027") | Most internships |
| Years of experience | The description ("2+ years") | Some new-grad roles |
| Visa sponsorship | Sentences in the description (KAN-168) | About 1 in 6 |
| Role category | The title (section 3.1) | Always |

Visa sponsorship has three answers, or none when the posting doesn't say:

| Value | Means |
|---|---|
| `sponsors` | The posting says it sponsors visas |
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
| 3. Upsert | New jobs are added, changed jobs updated, unchanged jobs left alone. A job is identified by its apply link. |
| 4. Places | Each job's place rows are brought in line |
| 5. Close | Jobs no longer in the feed are marked closed; a job that comes back reopens |

**Safety net:** the import refuses to close more than half the jobs at once
and rolls back. A broken scrape fails loudly instead of emptying the site.

`--dry-run` does everything and then rolls back; pull requests that touch the
scraper run it that way.

---

## 5. Storage

### 5.1 `job_postings`, one row per job

Scraped jobs and jobs companies post themselves share this table. Scraped
jobs have no `company_id`.

| Column | Holds |
|---|---|
| `title`, `company_name`, `apply_url`, `company_logo_url` | What the card shows; `apply_url` is unique |
| `description` | The full text, for the job page and Scout |
| `location_raw` | The location as written, for display |
| `work_style` | `remote`, `hybrid`, `onsite`, or empty |
| `experience_level` | `internship` or `new_grad` |
| `job_type` | `full_time`, `part_time`, `contract`, or empty |
| `salary_min`, `salary_max`, `salary_currency`, `salary_period` | Pay as a range, with its period (hour, week, month, year) |
| `start_term` | As the posting says it, like "Summer 2027" |
| `min_years_experience` | A number, or empty |
| `sponsorship` | Section 3.2's three values, or empty |
| `role_category` | Section 3.1's five values (new in KAN-171) |
| `status`, `posted_at` | Published or closed; when the board says it went up |
| `embedding`, `fts` | For job matching (KAN-139), not used by the job board yet |

### 5.2 `job_locations`, one row per place a job is in

A job in three cities has three rows. Each row is a country code (`US`) and
optionally a state (`US-CA`). Filtering by place reads these rows; the card
shows `location_raw` instead.

| Location text | Rows |
|---|---|
| "San Francisco, CA" | `US`, `US-CA` |
| "New York, NY; Austin, TX" | `US`/`US-NY`, `US`/`US-TX` |
| "London, UK" | `ZZ` ("Other": every country except the US, for now) |
| "Remote" | none: a place, not a work style, is what this table holds |

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
| `GET /jobs` | A page of published jobs, newest first, without descriptions |
| `GET /jobs/count` | How many jobs match, for "Show 128 Jobs" and /search's count |
| `GET /jobs/facets` | How many jobs each filter option holds, across the whole feed |
| `GET /jobs/locations` | Every country and state that has jobs, with counts |
| `GET /jobs/{id}` | One job with its description, or 404 once closed |

### Filters (`GET /jobs` and `GET /jobs/count`)

Several values in one filter mean **any of them**; different filters combine
with **and**.

| Parameter | Example | Matches |
|---|---|---|
| `location` | `US`, `US-CA` | A place row there, **or a remote job that names no place** (it can be done from anywhere) |
| `work_style` | `remote` | That work style |
| `experience` | `internship` | That level |
| `job_type` | `full_time` | That type |
| `role` | `quant` | That category |
| `posted_within` | `7` | Posted in the last 7 days |
| `min_pay`, `max_pay`, `pay_per` | `30`, `50`, `hour` | A pay range that overlaps this one, compared as yearly US dollars (hour × 2,080, week × 52, month × 12) |
| `start_term` | `summer-2027` | That season; seasons that have ended aren't offered |
| `visa` | `sponsors` | Says it sponsors. `not_ruled_out` keeps jobs that sponsor or don't say |
| `q` | `stripe` | The title or company name contains the words |
| `limit`, `offset` | `51`, `50` | Paging, for Load More |

**A filter hides jobs that don't state that fact.** Picking a salary range
hides the roughly 40% of jobs that give no pay. That's deliberate: a job
can't be shown as matching a fact it never stated.

---

## 7. The job board

### 7.1 `/jobs` and `/search`

| Piece | How it works |
|---|---|
| **Filters live in the address** | `/jobs?work_style=remote&role=quant`. A reload or a shared link keeps them. A value the API would refuse is dropped, not shown as an error. |
| **The filter row** | Location, Role, Workplace, Experience, Date Posted, Job Type, Visa, plus All Filters. As the window narrows, filters move into All Filters one at a time; Location always stays. |
| **All Filters** | One panel with every option as chips. Changes are a draft until "Show N Jobs", whose number is counted live. |
| **Counts beside options** | From `/jobs/facets` and `/jobs/locations`, cached for 5 minutes (they only change when an import runs). |
| **Applying a filter** | The list dims at once while the narrowed list loads. |
| **Load More** | The first 50 jobs, then a button adding 50 more with the same filters, until "That's every role that matches." |
| **Search** | The words go to the API (`q`), so a search covers every job, not only the first 50. |
| **Pinned header** | The title and filters stay at the top while the list scrolls; on a phone only the filter row stays. |

### 7.2 A job's page, `/jobs/[id]`

| Piece | How it works |
|---|---|
| **Opening it** | A click anywhere on a card |
| **Header** | The same facts as the card, and the company logo |
| **About the Role** | The description, with headings and bullet lists recovered from the plain text |
| **Actions** | Apply Now (the employer's page), Ask Scout, Share (copies the link). Save and Report aren't built yet. |
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
| Six hiring systems, not the big-company ones | Each hiring system needs its own reader | Workday (most large employers) is KAN-134 |
| Every country but the US is "Other" | Only the US is in the countries table | Add countries in a migration (the resolver needs no change) |
| Only internships and new-grad roles | The scraper keeps early-career titles only | A product decision |
| Many jobs lack pay, start date or visa | Employers don't state them | Nothing on our side; filters hide these jobs |
| The company list goes stale | `build_boards.py` runs by hand | Run it on a schedule |
| A new job at a quiet company can be two days late | Quiet boards are read one day in three | `--full` runs, or reading more often |

---

## 9. Where to look

| To change... | Start in |
|---|---|
| Which companies are read | `scraper/build_boards.py`, `scraper/boards.csv` |
| How a hiring system's boards are read | `scraper/workit_scraper/providers.py` |
| Which titles are kept, and their category | `scraper/workit_scraper/shortlist.py` |
| How a fact is read from a description | `scraper/workit_scraper/details.py` |
| What the import writes | `backend/app/scripts/import_jobs.py` |
| How a location becomes a place | `backend/app/services/location_resolver.py` |
| A filter's meaning | `backend/app/routers/jobs.py` (`JobFilters`, `matching`) |
| A filter's options and URL | `frontend/src/app/(seeker)/jobs/filter-query.ts` |
| The filter row and panel | `.../jobs/filters.tsx`, `.../jobs/all-filters.tsx` |
| The list and Load More | `.../jobs/feed-list.tsx` |
| The card | `frontend/src/components/job-posting-card.tsx` |
| The job's page | `.../jobs/[jobId]/` |

Each folder's `CLAUDE.md` holds the detailed rules and the reasons behind them;
this page is the map.
