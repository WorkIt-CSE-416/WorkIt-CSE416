# How job postings get onto WorkIt

How a job posting travels from a company job board to a card a student can
filter, open and apply to. Each section stands on its own, so read the one you
need.

> **Status (2026-10-13).** This describes the code on `KAN-134-workday` (the
> Workday reader), which builds on `main` after the twelve role categories
> (#98) and KAN-155's search (#108). It adds no database column (section 5.4).

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
 BambooHR, Recruitee,
 Rippling, iCIMS, Oracle,
 Workday                    writes feed.json               ▲
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
| 5. Serve | The API filters, counts and pages the job postings | `backend/app/routers/jobs.py` (the routes), `backend/app/queries/jobs/` (the queries) |
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
| **The list** | `scraper/boards.csv`: about 3,830 company job boards (table below) |
| **Where it comes from** | `build_boards.py` reads the apply links in public GitHub internship lists (SimplifyJobs and vanshb03, Summer 2027) and pulls out each company job board's name, plus a few added by hand |
| **How often it's refreshed** | At the start of every scheduled run, every 3 hours (KAN-167), so new companies and new job postings arrive together |
| **Slug** | A company job board's name in its address, like `stripe` in `boards.greenhouse.io/stripe` |

How the refresh behaves:

| | |
|---|---|
| **It only adds** | A company job board a list newly names is added; one already in the file is never dropped, even if the lists stop naming it |
| **It's safe to fail** | If a list won't download, nothing is changed and the scrape runs on the list as it was |
| **It isn't saved back** | The additions live only in that run, and each run makes them again. A local run reads the committed `boards.csv`, so re-run `build_boards.py` and commit it now and then to keep the two in step |
| **It says what it missed** | It prints each list's yield (a list whose links name no company job board gets a warning) and the apply links it could not use, by cause: an employer's own site, a short link, a hiring system behind a company's own address, SmartRecruiters and the others |
| **`--resolve`, on request** | Finds the company job boards behind short links and companies' careers pages (Greenhouse, iCIMS), each one proved: the board must hold that very job posting. It asks a few hundred sites, so a person runs it and commits the result; the scheduled run never does |

| Hiring system | Company job boards | Who uses it | How a company job board is read |
|---|---|---|---|
| Greenhouse | 871 | Tech companies of every size | Its list, then each kept job posting's own page |
| Ashby | 694 | Startups | One request, everything included |
| Lever | 341 | Startups and mid-size | One request; Lever asks for one second between requests. Its EU company job boards are on their own address (`api.eu.lever.co`) |
| Workable | 178 | Small and mid-size companies | Its list, then each kept job posting's own page (for hybrid and pay) |
| BambooHR | 42 | Small and mid-size companies | Its list, then each kept job posting's own page (the list has no description) |
| Recruitee | 2 | Small companies, mostly in Europe | One request, everything included |
| Rippling | about 165 | Small and mid-size companies | One request, then each kept job posting's own record (the list has no description, date or pay) |
| iCIMS | about 320 | Large employers, many in defense and government work | Its sitemap in one request (each job's URL only), then each kept job posting's own page |
| Oracle Cloud | about 190 | Large employers: chips, banks, insurers, retailers | 200 job postings a request, so a run reads as many company job boards whole as fit in 12 minutes, the least recently read first, as Workday's; then each kept job posting's own record |
| Workday | 1,700 | Large companies and most non-tech employers: banks, defense, chips, cars, retail, hospitals | 20 job postings a request, so a run reads as many company job boards whole as fit in 12 minutes, the least recently read first; then each kept job posting's own page |

Workable, BambooHR and Recruitee were added in KAN-171, Workday in KAN-134, and
Rippling, iCIMS and Oracle Cloud in KAN-301.
Recruitee has so few company job boards because the GitHub lists barely mention
it. Workday is the opposite: nearly half the lists' apply links point at it.

Workday is different in three ways worth knowing:

| | |
|---|---|
| **Read over several runs** | Reading every Workday company job board whole takes about 22,000 requests (they hold about 430,000 job postings), far more than one run can make politely. So each run reads them for 12 minutes, starting with the ones read longest ago, and the rest wait their turn. The first run read 439 of them, so each is read about every 12 hours, and a new Workday job posting can take that long to appear (a closed one stays as long) |
| **Some are skipped** | 141 whose `robots.txt` asks crawlers to stay off that careers site (Caterpillar, Citi, CACI, eBay), and 20 too big to read whole: over 5,000 job postings (Accenture, Walmart, Target, CVS), or capped at 2,000 by Workday with no filter to split them by (Airbus, Sysco) |
| **Logos from the company's website** | Workday's careers-page images are wide banners, so a card shows the icon of the website the careers site links as its home page or privacy policy. About 3 in 10 link neither, and those cards show the company's initials |

The GitHub lists are only used as a phone book. Every job posting itself is
read from the company's own job board, so we get job postings the lists never
added, the full description, and a reliable signal when a job posting closes.

---

## 3. Scraping

`.github/workflows/scrape.yml` runs the scraper and then the import **every 3
hours, at 17 minutes past** (off the hour, since GitHub delays runs scheduled
on it). A run takes about 15 minutes: 12 of them are Workday's share, and the
other hiring systems finish inside it (about 3 minutes without Workday).

### What one run does

| Step | What happens |
|---|---|
| 1. Pick company job boards | One that has ever had a job posting we keep is read every run. The rest ("quiet" ones) are read one run in three, a third of them on each run, so a first job posting at a quiet company can appear about nine hours late. `--full` reads them all. Workday's are read for 12 minutes a run, least recently read first (section 2). A board that went unread three runs in a row (it failed, said it does not exist, or `robots.txt` refused it) rests for 6 hours, then 12, then a day at most, until one read succeeds. |
| 2. Read politely | Checks each site's `robots.txt`, waits between requests (Lever asks for one second) and names itself honestly. Each hiring system has its own lane of workers, so slow Lever doesn't hold up Greenhouse. BambooHR, Recruitee and Workday give every company its own subdomain, and each hiring system's subdomains share one pace. A "too many requests" answer (429) pauses every request to that site, from 1 second up to a minute. |
| 3. Keep the right job postings | Checks each title (section 3.1). About 100,000 job postings are read on the other hiring systems and about 115,000 more on Workday each run. About 3,500 of the first are kept; Workday's first run kept 664, under the five categories before KAN-172. |
| 4. Fetch full pages | Greenhouse, Workable, BambooHR and Workday lists leave out the description, pay, work style or exact date, so the scraper reads the full page of each kept job posting there, once. |
| 5. Read the facts | Pulls pay, job type, work style, start date, years and visa out of each kept job posting (section 3.2). |
| 6. Merge duplicates | Job postings that share one apply link become one, with all their locations. So does a Workday job posted on two or three of a company's careers sites (the same requisition number at the same company, as on Autodesk's `ext` and `uni`): one card, linking the careers site made for students. Job postings that only share a title stay apart, since each is its own application. |
| 7. Write files | `jobs.json` (the scraper's memory between runs) and `feed.json` (what the import loads). |

**A company's logo is read once per company job board**, from the board's own
page: the image the company uploaded there, or else the icon of the company's
website when the board names it (`scraper/docs/logos.md`). A card with neither
shows the company's initials. A board found with no logo is read again only when
the logo reader learns a new place to look.

**A job posting only disappears after two complete reads of its company job
board in a row without it.** One was enough until 2026-10-27, and one bad
answer (an empty list from a hiring system having an outage) closed every job
posting on the board until the next read. When most of one hiring system's
company job boards with job postings answer with an empty list in the same run,
those answers count as no read, so a long outage closes nothing. A company job board with a job posting
missed once is read first in its hiring system's next run, so the second read is
3 hours later, even on Workday. If a company job board fails to load, its job
postings are kept as they were. A Workday company job board is read whole or not
at all: every page, adding up to the count Workday reports, or the read counts
for nothing.
A company job board that answers "no such board" twice in a row after we have
read it (the company left that hiring system) counts as a complete read with
nothing open, so its job postings close. One answer closes nothing, and neither
does most of one hiring system's company job boards answering so in the same
run. One we never read is just reported.

### 3.1 Which job postings are kept

A title must pass one check: it must be **early career**. Every field is kept
since KAN-430, because WorkIt is for college students of every major.

| Check | Passes | Fails |
|---|---|---|
| **Early career** | intern, co-op, working student, Summer Analyst, new grad, graduate, entry level, junior, trainee, university, campus, rotational program, apprentice | anything senior, staff, principal, director, VP; a manager or lead unless it is also junior or an intern; a recruiter *for* a university or campus |

The field then gives the job posting its **category**: one of the twelve in
the table below, one of the six fields held off until KAN-430 (`law`,
`consulting`, `support`, `arts`, `policy`, `education`), or `other` for a
title that names no field ("Engineering Intern") or a trade, operator, medical
or hotel job.

Each kept job posting gets **one category, or two** for the engineering jobs
that are two at once: a machine learning, AI or data engineer is Data and
Software, a firmware or embedded engineer Hardware and Software, a quant developer
Quant and Software. Some also get **specialties**, named in the title:

| Category | Stored as | Specialties | Examples | Kept (2026-10-10) |
|---|---|---|---|---|
| Software Engineering | `software` | Security & IT (`software/security`): 122 | Software Engineer Intern, Backend, DevOps, IT Helpdesk Intern, Cybersecurity Intern | 957 (1,144 with the second category) |
| Data Science, AI & ML | `data_ai` | Machine Learning & AI (`data_ai/ml`): 243; Data Science: 75; Data Analytics: 68; Data Engineering: 43 | Applied Scientist Intern, Data Analyst, Data Engineer | 413 |
| Hardware Engineering | `hardware` | | Electrical Engineering Intern, FPGA, Firmware, Robotics | 287 |
| Quantitative Finance | `quant` | | Quantitative Trader Intern, Quant Researcher | 187 |
| Product Management | `product` | | Product Management Intern, Associate Product Manager | 64 |
| Other Engineering | `engineering` | Civil & Structural (`engineering/civil`): 269; Mechanical: 160; Manufacturing & Industrial: 101; Aerospace: 59 | Civil Engineering Intern, Mechanical Engineer, Propulsion Intern, Nuclear Engineer | 703 |
| Business & Operations | `business` | | Business Operations Intern, Supply Chain Intern, Project Management Intern | 227 |
| Accounting & Finance | `finance` | | Accounting Intern, Credit Analyst, Investment Banking Summer Analyst | 198 |
| Marketing & Communications | `marketing` | | Marketing Intern, Social Media Intern, Copywriter | 157 |
| Sales & Business Development | `sales` | | Sales Development Representative, Account Executive, Sales Engineer | 156 |
| HR & Recruiting | `hr` | | Talent Acquisition Intern, People Operations Intern, Junior Recruiter | 100 |
| Design | `design` | | Product Design Intern, UX Research Intern, Graphic Design Intern | 58 |

187 job postings have two categories. In all 3,507 were kept, against 1,723
under the five categories that came before (KAN-171), from the same 101,000 job
postings. Edge cases: firmware and embedded count as Hardware, "Quantitative
Developer" counts as Quant, a recruiter of engineers is HR, an electrical engineer
for buildings and power systems is Other Engineering, and a bare "Engineering
Intern" names no discipline, so it is `other` (dropped until KAN-430). The
counts above are from before KAN-430, which added about 41% more job postings
(`scraper/docs/categories.md`).

### 3.2 Reading the facts

The rule everywhere: **use the hiring system's own field first, then the
description's text, and never guess.** A missing fact stays empty rather than
filled with a likely value. The two exceptions are rules measured on the live
feed to be nearly always right: work style falls back to "On site", and job type
to full-time for new-grad roles. An internship's job type is always
`internship`, for the level `student`, whatever hours it states (KAN-233).

| Fact | Where it comes from | How often a job posting states it |
|---|---|---|
| Location | The company job board's location text | Almost always |
| Work style (remote, hybrid, on-site) | The hiring system's field (Ashby, Lever, Workable, BambooHR, and Workday where the company fills it in); on Greenhouse, a location that says "Remote"; else the description | About 97% |
| Experience level | The title: `student` for an internship, else `new_grad` (`experienced` exists for the roles the scraper will keep later) | Always |
| Job type | Every internship: `internship`. Otherwise the hiring system's field, else the description, else full-time for a new-grad role (all 216 new-grad job postings that state one say full-time) | Always, for internships and new-grad roles |
| Pay | The description ("$40-$50/hr"), never a funding amount | About 60% |
| Start date | The description ("Summer 2027") | Most internships |
| Years of experience | The description ("2+ years") | Some new-grad roles |
| Visa sponsorship | Sentences in the description (KAN-168) | About 1 in 6 |
| Role categories and specialties | The title (section 3.1) | Always |

Visa sponsorship has three answers, or none when the job posting doesn't say:

| Value | Means |
|---|---|
| `sponsors` | The job posting says it sponsors visas |
| `no_sponsorship` | It says it doesn't, or needs US work authorization |
| `citizens_only` | It needs US citizenship (often for a security clearance) |

A description keeps only what says what the job is (KAN-229). The scraper finds
its headings ("What you'll do", "Who you are", "Benefits") and stores the intro,
then Overview, Responsibilities, Requirements, Preferred Qualifications, Pay
and Details, in that order and under those fixed headings. After them come
Benefits, How to Apply and About the Company: the job posting's page shows them
last, folded, and job matching, its keywords and Tailor never read them. Only
legal notices are left out. A line the employer's page listed is stored as
"• item", and the page's own markup tells the scraper which lines are headings
and which are list items. When the job's own sections would keep under a tenth
of a description, the headings were misread, and the whole description is
stored instead. A heading the rules don't know
("Role Purpose") is looked up in a list of labels a model gave once and the team
reviewed (`scraper/workit_scraper/learned_headings.json`); the scrape itself
never calls a model. The facts above are read from the whole
text first, so leaving text out never loses one. Then a long description is cut at 8,000 characters, ending in " …". The
rules and the measurements are in `scraper/docs/sections.md`.

---

## 4. Import

`import_jobs.py` loads `feed.json` into the database, all in **one
transaction**: if any step fails, nothing changes.

| Step | What happens |
|---|---|
| 1. Check | Every row is checked against the API's schema |
| 2. Read places | Each location's text is turned into place codes (section 5.2) |
| 3. Upsert | New job postings are added, changed ones updated, unchanged ones left alone. A job posting is identified by its apply link. The feed's `roles` keys are ignored (KAN-155): roles come from step 5. A changed description clears the job posting's cached keywords (section 5.1) |
| 4. Places | Each job posting's place rows are brought in line |
| 5. Role tags | Each title is matched against the `job_roles` list (section 5.3) and the job posting's `job_role_tags` rows are brought in line. The report lists titles that matched no role |
| 6. Close | Job postings no longer in the feed are marked closed, with the reason the scraper gives in `closings.json` (gone from its company job board, the board gone, no longer kept by the shortlist, or replaced by another copy), else "unknown"; one that comes back reopens |

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
| `description` | The kept sections under their fixed headings (section 3), for the job posting's page, search and Scout. Matching, its keywords and Tailor read only the job's sections, never Benefits, How to Apply or About the Company |
| `location_raw` | The location as the company job board wrote it |
| `location_label` | The card's version, "San Francisco, CA", written by the import (section 5.2) |
| `work_style` | `remote`, `hybrid`, `onsite`, or empty |
| `experience_level` | `student` (every internship) or `new_grad`; `experienced` when the scraper keeps such roles |
| `job_type` | `full_time`, `part_time`, `contract`, or empty |
| `salary_min`, `salary_max`, `salary_currency`, `salary_period` | Pay as a range, with its period (hour, week, month, year) |
| `start_term` | As the job posting says it, like "Summer 2027" |
| `min_years_experience` | A number, or empty |
| `sponsorship` | Section 3.2's three values, or empty |
| `status`, `posted_at` | Published or closed; when the company job board says it went up |
| `embedding`, `fts` | For job matching (KAN-139): the Jobs page's Best Match order ranks by them (KAN-231, KAN-288). The embedding reads the title, Overview (or the intro when there is none), Responsibilities, Requirements and Preferred Qualifications (KAN-229) |
| `keywords`, `keywords_hash` | Tailor's keywords (KAN-215): at most 20, each required or preferred, read by the model, with a hash of what the model read: the title and the job's own sections of the description, not its perks (`posting_text_hash`, which the import and Tailor's check share). The import reads them after it commits, for new and changed job postings, at most 100 a run (KAN-392); a company's job posting is read when it is saved as published. A job posting neither has reached yet is read the first time a student's resume is matched against it. A change to the title or the job's sections makes them stale, and the import clears them when the description changes |

### 5.2 `job_locations`, one row per place a job posting is in

A job posting in three cities has three rows. Each row is a country code (`US`)
and optionally a state (`US-CA`). Filtering by place reads these rows; the card
shows `location_label` instead (below).

**No city is filtered on.** State is as fine as the Location filter goes: a
city filter would need thousands of options (and 30+ Springfields) to answer
"jobs in Austin" when "jobs in Texas" serves a student.

**But the card does get the city.** The resolver already picks a city while
deciding the state, so the import writes it into `location_label` as display
text:

| Location text | `location_label` |
|---|---|
| "SF", "San Francisco Office" | San Francisco, CA |
| "Philadelphia, Pennsylvania, United States" | Philadelphia, PA |
| "Austin, Texas, United States; Boston, Massachusetts, United States" | Austin, TX; Boston, MA |
| "Toronto, Ontario, Canada", "California", "Remote - San Francisco" | none: abroad, a state alone, or remote keeps the posting's words |

About 680 of 1,160 job postings get a label; the website tidies the rest.

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

### 5.3 `job_roles` and `job_role_tags`, WorkIt's own role list (KAN-155)

`job_roles` is a short, fixed list of job titles (Software Engineer, Data
Scientist, Financial Analyst, Nurse: 49 today), seeded by a migration, for
onboarding and recommendations as well as search. It is what `?role=`, `?q=`
and the Jobs page's Role filter read. `job_role_tags` links a job posting to
each role its title names, zero or more. The import fills it from
`backend/app/services/role_resolver.py`, which matches whole-word aliases in
the title. This replaced KAN-172's `roles` column, since dropped; the scraper
still uses its categories to decide what to keep. `docs/search.md` has the design.

### 5.4 Changing the schema

Alembic owns the schema. A new column is a migration, which must be **merged to
`main` before anyone applies it** to the shared database, and only a person
runs `uv run alembic upgrade head`. The role categories' and location labels' migrations
(`aa41fdc1ba80`, `5c8d6ee05a0c`) went to `main` first (#94) and were applied
on 2026-10-10.

`roles` (`98ab19cfe840`, merged to `main` on its own in #97 and applied on
2026-10-11) was added the safe way round, **expand then contract**: the
migration added `roles` beside `role_category` and dropped nothing, because
the code running when it was applied still read `role_category`. KAN-155
finished the contract: its code reads `job_role_tags` instead, and
`824f0b2e3d84` drops both columns, applied only **after** that code is
deployed (`backend/CLAUDE.md`, Commands).

### 5.5 `job_applications`, one row per job posting an applicant saved or applied to (KAN-232, KAN-261)

An applicant id and a job posting id, with a `stage`, `created_at` and
`applied_at`. The applicant writes an `applied` row by answering "Did You
Apply?" after Apply Now opens the employer's posting (section 7.2), and a `saved` row with a Save button
(on the card and the page). A saved row counts as no application yet: the
application confirmation or auto apply moves it on, and saving never moves a later
stage back. Auto apply writes `queued` rows and
moves them to `applied`, `skipped` or `needs_you`
(`auto-apply/architecture.md`, "Data model"); `applied_at` stays empty until
the applicant applies. A join table, not an array of applicant ids on the job
posting: the foreign keys keep both ids real, an apply never rewrites the row
the import upserts, and more columns (the resume sent) can join it later.
Deleting the applicant or the job posting deletes its rows.

---

## 6. The API

All public, no sign-in needed (they serve public job postings). A signed-in
applicant's token is read when sent: `GET /jobs`, `/jobs/count` and
`/jobs/recommended` then leave out the job postings that applicant marked as
applied (stage `applied`; a job only saved, or queued for auto apply, stays in). Without a token, or with a bad or company one, nothing is left out.

Every job posting the API sends carries `auto_apply`: true when its
`apply_url` is on a hiring system auto apply can fill, which is Greenhouse
only for now (any `greenhouse.io` host, or a company's own page with
`?gh_jid=` that embeds its form, outside `SKIP_EMBEDDING`). It is worked out from the URL, never stored. The
Auto Apply button shows only where it is true, and auto apply's matches and
queue take only those job postings (`backend/app/auto_apply/hosts.py`).

| Endpoint | Returns |
|---|---|
| `GET /jobs` | A page of published job postings, newest first, without descriptions |
| `GET /jobs/count` | How many job postings match, for "Show 128 Jobs" and /search's count |
| `GET /jobs/facets` | How many job postings each filter option holds, across the whole feed (a job posting in two categories counts in both) |
| `GET /jobs/locations` | Every country and state that has job postings, with counts |
| `GET /jobs/{id}` | One job posting with its description, or 404 once closed |
| `GET /jobs/{id}/applied` | Applicants only: when they marked it applied, or null |
| `POST /jobs/{id}/applied` | Applicants only: marks it applied, a queued or saved one too; a second mark keeps the first date |
| `POST /jobs/{id}/saved` | Applicants only: saves it, and answers its stage; one already queued or applied keeps that stage |
| `DELETE /jobs/{id}/saved` | Applicants only: takes it out of saved; 409 once it is past saved |

### Filters (`GET /jobs` and `GET /jobs/count`)

Several values in one filter mean **any of them**; different filters combine
with **and**.

| Parameter | Example | Matches |
|---|---|---|
| `location` | `US`, `US-CA` | A place row there, **or a remote job posting that names no place** (it can be done from anywhere) |
| `work_style` | `remote` | That work style |
| `experience` | `new_grad`, `experienced` | That level. `new_grad` (Entry Level / New Grad) also matches every internship, whose level is `student` (KAN-284); `student` is still accepted, for old links and saved preferences |
| `job_type` | `full_time`, `internship` | That type; every internship is `internship` (KAN-233) |
| `role` | `software_engineer`, `civil_engineer` | A job posting tagged with that `job_roles` role in `job_role_tags` (section 5.3, KAN-155). Before KAN-155 this read the scraper's `roles` keys |
| `posted_within` | `7` | Posted in the last 7 days |
| `min_pay`, `max_pay`, `pay_per` | `30`, `50`, `hour` | A pay range that overlaps this one, compared as yearly US dollars (hour × 2,080, week × 52, month × 12) |
| `start_term` | `summer-2027` | That season; seasons that have ended aren't offered |
| `visa` | `sponsors` | Says it sponsors. `not_ruled_out` (sponsors or doesn't say) went in KAN-275 |
| `auto_apply` | `true` | Only job postings auto apply can fill: `auto_apply` true (section 6), Greenhouse for now |
| `q` | `swe intern stripe` | A company it names by whole name (a typo corrected) narrows to that company's jobs; the roles it names (typos corrected) narrow to jobs tagged with them or whose title says the words that named them ("software" finds "Embedded Software Engineer"); "intern", "new grad", "remote", "summer 2027" and the like narrow their own columns (a start term and "remote" also match a title saying them); every other word must be in the job posting's text or its company's name. Newest first, like the rest of the feed |
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
| **The filter row** | Location, Role, Workplace, Experience and Date Posted, plus All Filters, and a Clear Filters X while any filter is on. Job Type, Visa, Salary, Start Date and Auto Apply Supported are in All Filters only. As the window narrows, filters move into All Filters one at a time; Location always stays. The row's Role is searched by typing; a job posting tagged with two roles shows under both. Job Type offers Internship beside Full-Time, Part-Time and Contract (section 3.2). |
| **All Filters** | One panel with every option as chips, or a search picker for the long lists: Location, Start Date, and Role, whose specialties ("Mechanical Engineering", "Security & IT") sit indented under their category. Changes are a draft until "Show N Jobs", whose number is counted live. |
| **Option lists** | Role's names from `/jobs/facets` and Location's places from `/jobs/locations`, cached for 5 minutes (they only change when an import runs). No option shows a job count; "Show N Jobs" in All Filters is the one count. |
| **Applying a filter** | The list dims at once while the narrowed list loads. |
| **Load More** | The first 50 job postings, then a button adding 50 more with the same filters, until "That's every role that matches." |
| **Search** | The words go to the API (`q`), so a search covers every job posting, not only the first 50. |
| **Auto Apply on a card** | Only on a job posting whose `auto_apply` is true (Greenhouse for now; section 6). Its page shows it on the same rule. |
| **Apply Now on a card** | Opens the same dialog as a job posting's page (section 7.2): pick a resume, then "Did You Apply?". |
| **Location on a card** | The import's label where there is one ("San Francisco, CA" for "SF"), else the raw text tidied ("Philadelphia, PA"). Several places read "Austin, TX +3 more", with every place listed on the job posting's page. `placesOf` in `jobs/format.ts`. |
| **Pinned header** | The title and filters stay at the top while the list scrolls; on a phone only the filter row stays. |

### 7.2 A job posting's page, `/jobs/[id]`

| Piece | How it works |
|---|---|
| **Opening it** | A click anywhere on a card |
| **Header** | The same facts as the card, and the company logo |
| **About the Role** | The description, with headings and bullet lists recovered from the plain text |
| **Actions** | One row under the title: Save, a "…" menu (Copy Link, Report), Ask Scout, Auto Apply, Tailor My Resume and Apply Now (the company's own page). Save keeps the job posting in the Saved column on My Applications; a second click takes it out. Report isn't built yet. |
| **Applied** | Signed-in applicants only. After Apply Now opens the company's page, the dialog asks "Did You Apply?". Yes records the job posting in `job_applications`, and the page reads "You applied on Oct 17, 2026", on the viewer's own calendar. The job posting then leaves their Jobs page, search and matches. There is no undo yet. |
| **Back to Jobs** | Returns to the list you came from, with its filters |

### 7.3 Coming back

The app scrolls inside its own panel rather than the browser window, so the
browser can't restore your place by itself. The app does it instead:

| You come back by | You land |
|---|---|
| Browser Back or Forward | Where you were, on any page in the app |
| "Back to Jobs" | Where you were in the list, with your Load More pages still loaded (for 30 minutes) |
| A sidebar link, a fresh link or a reload | At the top, with the first 50 job postings |

---

## 8. Known limits

| Limit | Why | What would fix it |
|---|---|---|
| Ten hiring systems. The next biggest in the GitHub lists, SmartRecruiters (about 1,200 apply links), goes unread, and so do employers' own careers sites (TikTok, Apple, Amazon, Microsoft) | SmartRecruiters' `robots.txt` disallows us, and each employer's own site needs a reader of its own | Ask SmartRecruiters for access; a reader per large employer. `build_boards.py` prints the unread apply links by cause, which ranks them (`scraper/docs/coverage.md`) |
| A Workday job posting can take about 12 hours to appear, or to leave | Its company job boards are read whole, about every fourth run each, within a 12-minute share of each run | An arrival scan of every company job board's newest page each run, once `metrics.json` shows Workday lists its newest job postings first (`scraper/docs/coverage.md`) |
| The biggest Workday company job boards are skipped | Over 5,000 job postings, or capped at 2,000 with no filter to split them (Accenture, Walmart, Target, Airbus): 20 company job boards | Read a giant one over several runs, or split a capped one by two filters |
| About 3 in 10 Workday cards have no logo | Workday's careers-page images are wide banners, so only the website a careers site links is used, and some link none | Find a square image Workday serves |
| Some Greenhouse and Lever cards have no logo (139 jobs on 2026-10-19, mostly Greenhouse) | The company job board has no uploaded image and names no website we can trust (Arc, MEMX, Muon Space), or names one whose name does not match the company (Graviton: gravitontrading.com) | A person confirms the website and adds it to `logos.CHECKED_WEBSITES` |
| Recruitee cards have no logo | Its logo sits inside a 1 MB board page, for the one company job board we read | Read it there if more Recruitee companies arrive |
| A place abroad reads as the posting wrote it ("Toronto, Ontario, Canada") | The label only rewrites US cities | Extend the label to other countries if it matters |
| Every country but the US is "Other" | Only the US is in the countries table | Add countries in a migration (the resolver needs no change) |
| Only internships and new-grad roles | The scraper keeps early-career titles only | A product decision. `metrics.json` counts what each wider step would add (`widening`) |
| No law, consulting, teaching, arts, policy or customer support job postings, and none whose title names no field ("Engineering Intern") | Held off in KAN-172; a bare title can't be told apart (a civil firm's "Engineering Intern" from a software company's) | Add a category in the scraper, the API and the Jobs page together (no migration: `roles` is plain text) |
| Some titles land in the wrong category | It is read from the title alone: a trading firm's "Systems Engineer" is IT work read as engineering | Read the description too, or the company's other job postings |
| Many job postings lack pay, start date or visa | Companies don't state them | Nothing on our side; filters hide these job postings |
| A company only arrives once a GitHub list names it | The lists are our only source of company job boards | `build_boards.py --resolve` finds the ones behind short links and companies' careers pages; next, proved guesses from company names (`scraper/docs/coverage.md`). Common Crawl's `robots.txt` disallows every bot |
| A new job posting at a quiet company can be about nine hours late | Quiet company job boards are read one run in three | `--full` runs, or reading more often |

---

## 9. Where to look

| To change... | Start in |
|---|---|
| Which company job boards are read | `scraper/build_boards.py`, `scraper/boards.csv` |
| How a hiring system's company job boards are read | `scraper/workit_scraper/providers/systems/` (one module per hiring system) |
| Which job postings are kept, and their categories and specialties | `scraper/workit_scraper/shortlist.py` |
| How a fact is read from a description | `scraper/workit_scraper/details.py` |
| What the import writes | `backend/app/scripts/import_jobs.py` |
| How a location becomes a place | `backend/app/services/location_resolver.py` |
| A filter's meaning | `backend/app/queries/jobs/filters.py` (`JobFilters`, `matching`) |
| A filter's options and URL | `frontend/src/app/(seeker)/jobs/filter-query.ts` |
| The filter row and panel | `.../jobs/filters.tsx`, `.../jobs/all-filters.tsx` |
| The list and Load More | `.../jobs/feed-list.tsx` |
| The card | `frontend/src/components/job-posting-card.tsx` |
| A job posting's page | `.../jobs/[jobId]/` |

Each folder's `CLAUDE.md` holds the detailed rules and the reasons behind them;
this page is the map. The code itself says "board" for a company job board
(`boards.csv`, `Board`) and "provider" for a hiring system.
