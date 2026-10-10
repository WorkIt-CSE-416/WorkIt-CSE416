# CLAUDE.md — models

Decisions in this folder and the failure each one prevents. Loaded on top of
`../../CLAUDE.md` (the Python API) and the repo root's. Read this before adding
or editing a model.

`profiles.py` holds the tables; `dto.py` holds the enums. **Alembic is the
source of truth for the schema** — this file is rationale and invariants, and
deliberately does not list columns, because a second copy of a column list
drifts from the first. Read `profiles.py` for the columns.

## The schema, and why it is shaped this way

Three tables, two independent halves:

```
applicant_profiles          a complete job-seeker account
company_profiles  1 ──o{  company_memberships    a complete HR-user account
                            (ON DELETE CASCADE)
```

- `applicant_profiles` — identity plus the links and headline the autofiller
  reuses.
- `company_memberships` — identity plus the company it belongs to and its role.
  Many memberships point at one company.
- `company_profiles` — the employer. One identity for future jobs, HR users and
  public company pages to attach to, which is why it exists before `jobs` does.

### There is no shared identity table

An account **is** an `applicant_profiles` row or a `company_memberships` row.
`Profile` is an abstract class that lends its identity columns to each table
separately. Each account row's `id` is its Supabase `auth.users` id, so every
auth user pairs with exactly one profile row — in whichever of the two tables
`app_metadata.account_type` names.

What it buys: one row per account, so loading a recruiter or an applicant reads
a single table — no join, no discriminator column, no inheritance machinery. The
two audiences stay genuinely separate, matching how the frontend is already
split (`(seeker)` vs `/company/*`). Many HR users per company with distinct
roles still works, since `company_id` is a plain foreign key.

What it costs — properties of the design, not defects:

- **An HR user belongs to exactly one company.** `company_memberships.id` is
  both the primary key and the user's identity, so a second membership for the
  same person is a duplicate-key violation.
- **Someone who is both an applicant and an HR user needs two emails.**
  `auth.users` holds an address once and the id is shared with the profile, so
  one sign-in identity is one account. Two addresses give two unlinked rows,
  with no query relating them.
- **Deleting a company deletes its HR users' accounts.** The cascade on
  `company_id` is correct for a join row, but a membership *is* the account.
  Confirm this is wanted before writing a company-delete path.

The escape hatch, if the product needs one human with both roles or a recruiter
at two employers: make `Profile` concrete and add `profile_id` foreign keys. A
migration and a backfill, not a rewrite. Do not half-do it — a `profile_id`
with no table to point at is worse than neither.

## Insert order is not foreign-key order

**No model here declares a `relationship()`**, only `ForeignKey` columns, and
without one the unit of work does not sort INSERTs by foreign key. Checked on
2026-09-28: a `Company_Profile` and a `Company_Membership` pointing at it,
flushed together, insert the membership first whichever was `add()`ed first.
Postgres checks the foreign key immediately, so the flush fails with an
`IntegrityError` for a company that is only missing because it has not been
inserted yet.

Whenever one flush writes a parent and a child, `await db.flush()` after
adding the parent, still inside the same transaction — `routers/auth.py`'s
company signup does exactly that. Adding a `relationship()` would let the
unit of work order them itself, but it also brings lazy loading, which is a
`MissingGreenlet` trap in async code (`../../CLAUDE.md`).

A column default such as `Company_Profile.id`'s `default=uuid.uuid4` is also
applied only at flush, so `company.id` is `None` until then. Set the id
explicitly when a child row needs it before the flush.

## There is exactly one Base, and it lives in app/db.py

```python
from app.db import Base
```

**Never write `class Base(DeclarativeBase)` in this folder.** Each subclass of
`DeclarativeBase` creates its own `registry` and its own `MetaData`.
`alembic/env.py` reads `Base.metadata` from `app.db`, so a model registered on a
second base is invisible to autogenerate — which emits `pass`, indistinguishable
from the documented "no models yet" state, and later proposes **dropping** any
table it cannot see.

Same reason the import must be spelled `app.` and never `backend.`: uvicorn and
alembic both run from `backend/`, so `app` is the top-level package. Both
spellings resolving at once gives you `app.db` and `backend.app.db` as two
separate modules with two separate `Base` classes — the same bug, harder to see.

## __init__.py registers every model automatically

`alembic/env.py` does `from app import models`. A model that import does not
reach is absent from `Base.metadata`, and autogenerate writes a migration
**dropping the table it cannot see**.

`__init__.py` therefore imports every module in this folder with `pkgutil`, so
a new model file is registered without being listed anywhere. It replaced a
hand-maintained list of imports, which had already missed `locations.py` —
exactly the failure above. Two consequences:

- **Every `.py` file here is imported at startup.** A scratch or half-written
  file that raises on import breaks the app and Alembic alike. Keep non-model
  code out of this folder.
- **Nothing is re-exported.** Import a model from its module
  (`from app.models.jobs import Job_Post`), not from `app.models`.

The `noqa` on the import in `env.py` is load-bearing; linters strip "unused"
imports, and stripping that one is how the table gets dropped.

## BaseModel and Profile are abstract on purpose

Both are `__abstract__ = True`: they declare columns and map to no table. Each
concrete subclass gets its own **independent copy** of those columns.

- `BaseModel` supplies `created_at` / `updated_at`.
- `Profile` supplies `id`, `email`, `full_name`, `phone_number`, `avatar_path`,
  `onboarding_completed_at`. `id` is a foreign key to `auth.users.id`, with no
  default — see "Identity lives in auth.users" below.

An abstract class must never be given `__tablename__` — it is ignored, and it
reads as a table that exists. Dropping `__abstract__` from either one raises
`InvalidRequestError` for a missing `__tablename__`.

**Never subclass a concrete model to "extend" it.** `class X(Profile)` with a
`__tablename__` is joined-table inheritance, which needs a foreign key and a
discriminator and makes the subtypes mutually exclusive. Without a
`__tablename__` it is single-table inheritance, which silently welds the child's
columns onto the parent's table.

## Enums store .name, not .value

SQLAlchemy keys a native Postgres enum off the member **name**. The `StrEnum`
base makes this easy to miss, because the member compares equal to its *value*
in Python.

| Enum | Name | Value | In Postgres |
| --- | --- | --- | --- |
| `company_role` | `owner` | `"owner"` | `owner` |
| `profile_status` | `active` | `"active"` | `active` |
| `company_size_range` | `ONE_TO_FIFTY` | `"1_50"` | `ONE_TO_FIFTY` |

`company_role` and `profile_status` set name and value identical, so those
columns store what Python compares against. **`company_size_range` does not** —
the column holds `ONE_TO_FIFTY` while `== "1_50"` is what returns `True`.

So: **compare against the member, never a string literal.**

```python
if membership.status == profile_status.active:        # correct
if membership.status == "active":                     # works, but fragile
if membership.status == "ACTIVE":                     # silently always False
if company.size_range == "ONE_TO_FIFTY":              # silently always False
```

None of this needs a reverse mapping in Python: SQLAlchemy writes the name
and reads it back as the member, and a `StrEnum` member serializes to JSON as
its value, so the API sends and receives `"1_50"`. The name only surfaces
where SQLAlchemy's enum handling is skipped — the dashboard, exports, and raw
`text()` SQL, where `WHERE size_range = '1_50'` matches nothing.

The last form is the natural mistake — `ONE_TO_FIFTY`-style names are what you
see in the Supabase dashboard and in exports, so copying a value from where you
inspect data into where you write code produces a branch that never fires and
raises nothing.

A new enum keeps name and value identical, or passes `values_callable` to
`sqlalchemy.Enum`. Do not add a third convention.

The Postgres type name comes from the Python class name, since no `name=` is
passed. `profile_status` therefore describes a *membership*, not a profile — a
holdover worth renaming if the enum is ever touched, which is an
`ALTER TYPE ... RENAME` migration.

`enum.StrEnum` already subclasses `str`. Writing `class X(str, enum.StrEnum)`
raises `TypeError: Cannot create a consistent method resolution order`.

## Enum changes are coordinated deploys

`ALTER TYPE ... ADD VALUE` does not autogenerate and does not roll back cleanly.
`../../alembic/CLAUDE.md` covers this; the version here is that adding or
renaming an enum value is a hand-written `op.execute()` and a deploy, not an
edit. That window has closed — `dee263a84adb` created all nine types on
2026-09-21, so every value change from here is the coordinated kind.

`company_size_range` uses fixed MVP buckets for exactly this reason — the
domain does not grow with the product. For anything that will, a lookup table
costs a join and saves the coordination.

## A new column reaches the database before the model that maps it

`deferred=True` keeps a column out of reads, not writes. On an ORM INSERT,
SQLAlchemy adds an explicit `NULL` for every mapped column with no value and no
default (its own source calls this "legacy behavior"). So a column declared
here appears in every `Model(...)` insert, even when nothing sets it.

Deploy that model to a database without the column and every such insert fails.
For `resumes.embedding` (below) that would have meant resume upload answering
500 "Failed to save resume record", and company job creation an unhandled 500.
It was caught in review on 2026-10-09, before anything shipped.

Adding a nullable column is harmless to the code already running, so applying
its migration early costs nothing, but deploying the model first breaks inserts.
Run `alembic upgrade head` right after merging, before the new deployment is
live. A column whose value the database supplies (`Computed`, a
`server_default`) is left out of inserts and is not affected.

## Locations — countries, states, and the resolver

### The tables

`locations.py` holds two reference tables keyed by ISO codes, with no
surrogate ids:

- `countries.code` — ISO 3166-1 alpha-2 (`US`, `GB`).
- `states.code` — ISO 3166-2 (`US-CA`), with `country_code` → `countries`.

**The code is the key.** A job location stores `US-CA` itself, so filtering
"jobs in California" is `job_locations.state = 'US-CA'` with no join to
`states`. That join is only for the display name.

**The foreign keys are for integrity, not speed.** They make Postgres reject
`'NY'`, `'New York'` or `'US-XX'`, so every row spells a place one way. The
speed comes from `job_locations_place_idx` on `(country, state)`; Postgres
does not index a foreign key column by itself. Filter with the country as
well as the state (`country = 'US' AND state = 'US-CA'`), which a state code
always implies, so that index's leading column is used.

### job_locations — where a job is offered

`job_postings` holds no location codes since `4138dcee44b1`. Each place a job
is offered is one `job_locations` row (`Job_Location` in `jobs.py`): a job in
San Francisco and New York has two, a job naming no place has none. One
column pair on the job could not hold both, so a New York filter would miss
every job whose first-listed office was elsewhere — 78 of the 1,069 scraped
jobs list several. "Jobs in California" is an `EXISTS` on this table.

- `country` — NOT NULL, with its **own** FK to `countries`. Postgres skips a
  composite FK when any of its columns is NULL (`MATCH SIMPLE`), so without
  it a country-only row would go unchecked. `ZZ` means a place the seed does
  not cover.
- `state` — nullable. "United States" or a country with no seeded
  subdivisions has no state.
- The composite FK `(state, country)` → `states(code, country_code)` rejects a
  state from the wrong country: `('US-NY', 'CA')` fails.
- `UNIQUE NULLS NOT DISTINCT (job_id, country, state)` stops the same place
  twice. `NULLS NOT DISTINCT` matters: plain `UNIQUE` treats two
  `(job, US, NULL)` rows as different. It needs Postgres 15+, so test locally
  on 15 or later. That constraint's index also serves lookups by `job_id`,
  which is why the column has no index of its own.
- `ON DELETE CASCADE` from the job: deleting a job deletes its places.
- **Display uses `job_postings.location_raw`**, never these rows. The codes are
  for filtering and lose the city.
- **The company API keeps one place per job.** Its body and response still
  carry `locationCountry`/`locationState`; `routers/company_jobs.py` writes
  them as the job's single row and reads them back the same way, so the
  composer did not change. Several places are for scraped jobs.
- **Remote is `work_style`, not a location.** A remote posting may still name
  a country ("Remote, US"). Never add a sentinel "REMOTE" code; it duplicates
  `work_style` and cannot say "remote, US only".

A bad code raises `IntegrityError` on insert.

### What is seeded

Seeded by migrations, frozen inline from pycountry 26.2.16:

| Revision | Rows |
| --- | --- |
| `cca905583de8` | 15 of ISO's 249 countries — see below |
| `6b5bd2831d18` | 57 US subdivisions: 50 states, DC, 6 outlying areas (PR, GU…) |
| `4b3c00b5167d` | "Other": country `ZZ`, state `ZZ-ZZ` |
| `4623ff1e8bb1` | Removes every country but US; their postings move to `ZZ` |

**`ZZ` is a catch-all for places outside the seed**, not a real country. It is
ISO's user-assigned "unknown" code, so it can never collide with one ISO
assigns later. Never use it for Remote — that is `work_style` (above); a job
remote from anywhere is `work_style = remote` with country `ZZ`.
The state is `ZZ-ZZ`, not `ZZ`, because the API requires a state code to be
`<country>-<sub>` and start with its country (`schemas/company_jobs.py`).
Anything filed under it cannot be told apart later, so the resolver should
still return nothing on a miss rather than fall back to `ZZ`.

**The countries list is incomplete on purpose.** It holds `US` and `ZZ`
only. `cca905583de8` seeded 15 (Australia, Canada, China, Denmark, France,
Germany, Hong Kong, Italy, Japan, New Zealand, Singapore, Spain, Taiwan, the
United Kingdom and the United States); the rest of ISO's 249 were cut on
2026-09-22, and `4623ff1e8bb1` removed all but the US on 2026-10-05, to keep
the product US-only while it is young — not for storage, which was never the
constraint (all 249 fit in about 50 KB). Any of them can be added back when
real postings need it. `frontend/src/app/company/jobs/new/data.ts`'s
`COUNTRIES` mirrors this table by hand and must change with it.

Consequences, until someone adds them back:

- A posting in an unseeded country cannot be stored with that country — its
  `job_locations.country` fails the FK. The resolver must return nothing for it
  rather than guess a neighbour.
- Puerto Rico, Guam and the other US outlying areas exist only as US states
  (`US-PR`), not as countries (`PR`).

**Adding countries back.** Take the rows from pycountry 26.2.16 — the version
the rest were frozen from — using `common_name` and no commas; the full list is
in this file's git history before 2026-09-22. As of 2026-09-22 the shared
database has not applied `cca905583de8` (it is on `dee263a84adb`), which is
the only reason editing it in place was safe. Once it has been applied
anywhere, add countries in a **new** seed migration instead — Alembic never
re-runs an applied revision, so an edit would reach fresh databases only.

**Only the US has states.** A posting anywhere else stores its country with
`state` NULL. That scope was chosen on purpose: earlier drafts seeded
15 countries' subdivisions (310 rows), then the UK's four nations alone, and
both were cut as more than the product needs for now. Adding a country later is
a new seed migration, not an edit to one already applied, and follows the
rules below.

Rules the seeds follow, which a new one must follow too:

- **Never read pycountry at upgrade time.** Its data changes between releases,
  so two machines would insert different rows. Generate once, inline the rows.
- **Top level only.** `states` is one level deep, and postings name the top
  level ("London, England, United Kingdom" names England), not a borough or
  département.
- **English names.** Country names use pycountry's `common_name` ("South
  Korea", not "Korea, Republic of"). ISO names many subdivisions in the local
  language ("Bayern"); store the English one ("Bavaria") and give the local one
  to the resolver as an alias. No name may contain a comma, because the
  resolver splits posting text on commas.
- **Nothing that is already a country.** Some top-level entries are ISO
  countries in their own right (Hong Kong under CN, Aruba under NL); they
  already have a `countries` row, so leave them out.
- **Check the top level is what postings write** before seeding a country.
  Ireland's is four historic provinces and Singapore's five districts; both are
  better left country-only.

### The resolver — `app/services/location_resolver.py`

Turns a scraped posting's free text into `job_locations` rows:
`"San Francisco, CA • New York, NY"` → `Place("US", "US-CA")`,
`Place("US", "US-NY")`. Built 2026-10-07; the module docstring walks through
the five steps, and `tests/test_location_resolver.py` pins about 80 real and
made-up strings to their answers. **Add a failing string there before changing
a rule**: the rules interact, and fixes broke other shapes more than once
while it was written.

**Every scraped job goes through it on the way in.** Insert or update scraped
postings (`company_id` NULL) only through `app/scripts/import_jobs.py`, which
resolves each listing's location and writes its `job_locations` rows in the
same transaction. Never write scraped rows to `job_postings` any other way: no
hand-written INSERT, no seed script, no new endpoint. A job that skips the
resolver has no `job_locations` rows, so the location filter on the job board
never shows it, and nothing reports that it's missing. A new path for scraped
jobs either calls `import_jobs`' `prepare()` and its location sync or builds
`LocationResolver` the same way and writes the rows itself. Company-posted jobs
don't use the resolver: their form already gives a country and state.

**Where.** `app/services/`, never this folder (`__init__.py` imports every
file here as a model). Pure: no database, no network.

**Codes come from the database, names from data.** The import builds
`LocationResolver(countries, states)` from the `countries`/`states` tables, so
every code it returns passes the FKs, and seeding a country later needs no
code change (a test proves it with `GB-ENG`). A place in an unseeded country
becomes `ZZ`. Names come from `data/places.tsv` (below) plus the seeded
states' names and codes. The only hand-written lists are vocabulary: filler
words ("remote", "hq", "office"), a dozen country nicknames GeoNames spells
differently ("uk", "czech republic", "turkiye"), areas wholly outside the US
("europe", "apac"), and two metro names ("bay area", "silicon valley").

**How it reads a string**, in short:

1. Split on separators that only mean "another place": `•` `;` `|` `/`, and
   a *lowercase* ` or ` / ` and ` between names. `Portland, OR` is Oregon;
   `Newfoundland and Labrador` is one name.
2. Split on commas, brackets and a spaced dash into pieces; drop filler.
3. Read each piece as every city, region and country it can be. A run of
   names without commas (`US-WA-Bellevue`, `Long Beach CA`) is broken into
   the longest known names, narrowest first. An unknown piece of 5+ letters
   is checked for a misspelt region or country (`Pennslyvania`).
4. Group pieces into places: a name, then broader qualifiers. A piece that
   can't qualify the one before (`Austin, New York`) starts a new place, so
   `Cambridge, MA, Arlington, VA` is two places and `Boston, MA, USA` one.
5. Decide each place. A city must fit its qualifiers; one alone takes the
   most populous match, or a US match at least half that size. A name alone
   prefers a US state, then a country, then a region abroad (unless it is
   also a US city of 250k+), then a city.

The numbers that tune it are constants at the top of the module, each with
the case that set it: `_US_PREFERENCE` (Cambridge, MA over England),
`_MAJOR_CITY` (`Perth, WA` is Australia, `Springfield, VT` stays Vermont),
`_BIG_US_CITY` (`San Jose` is California, `Ontario` the province),
`_TYPO_CUTOFF`.

**Two-letter pieces** are a state or country code before they are a city
(Wa is a city in Ghana). Between a US state and a country, the city decides:
`Indianapolis, IN` is Indiana, `Berlin, DE` Germany, `Amsterdam, NL` the
Netherlands.

**Coverage on the 1,069-job feed (2026-10-07):** 1,046 resolve to at least one
place; 20 name none ("Remote", "Any Location"); 3 miss (`Any SpaceX Site`,
`RWC HQ`). `Resolution.unresolved` lists the pieces of a miss and stays empty
for strings that name no place, so the import can log only real misses.

**Known misses, accepted:**

- A lone name that's a region abroad and a US city under 250k goes abroad:
  `Santa Cruz` is Bolivia's province, not Santa Cruz, CA.
- Lone `LA` is Louisiana, not Los Angeles; lone `Washington` is the state.
- A lone city with a much bigger foreign namesake goes abroad:
  `Birmingham` is England.
- Abbreviations GeoNames lacks (`RWC` for Redwood City) resolve to nothing.
- Non-US regions never become state codes unless that country's states are
  seeded under GeoNames' admin1 code (true for `GB-ENG`, not for most).

**Unresolved postings are stored anyway** with no `job_locations` rows;
`location_raw` (`b40588efa7b7`) keeps the text, so they can be resolved again
when the resolver improves.

### data/places.tsv — the gazetteer

Built by `scripts/build_geonames.py` from GeoNames' `cities15000` (≈34k
cities of 15,000+ people, with population, country, state and alternate
names), `countryInfo` and `admin1CodesASCII` (first-level regions
worldwide). About 3.2 MB, committed, so a build is reproducible and the import
never downloads anything. Re-run the script to refresh it.

- **CC BY 4.0:** the attribution line at the top of the file must stay.
- Alternate names are kept only in plain Latin letters; other scripts would
  triple the file and match nothing an English job board writes.
- Towns under 15,000 are absent, which is fine when a state follows
  (`Montpelier, VT`) and a miss when one stands alone. `cities5000` is the
  next size up if that starts to matter.
- It ships with the Vercel deploy although only the import reads it.

## job_postings holds company-posted and scraped jobs

One table, two kinds of row (`b40588efa7b7`), told apart by `company_id`:

- **Set** — posted through the company form by that company.
- **NULL** — scraped, imported from the scraper's `feed.json`. The employer is
  `company_name`/`company_logo_url`, and `apply_url` is where the seeker
  applies. `apply_url` is unique because the scraper dedupes on it, which
  makes it the key an import upserts on. `description` is the scraper's
  plain-text copy, which Scout reads; it is most of the table's size (first
  import, 2026-10-07: 4.9 MB of text stored as 3.2 MB compressed, in TOAST,
  for 1,069 jobs).

Chosen over a separate scraped-jobs table so a seeker feed, search and
location filter are one query over one table, and saves/applications can
reference either kind with one foreign key. There is no `source` column on
purpose: it would only restate whether `company_id` is NULL, and the two
could disagree. If a company ever claims a scraped job, setting `company_id`
is what makes it theirs.

**The nullable columns are nullable for scraped rows only.** `company_id`,
`description`, `job_type`, `experience_level` and `work_style` were
`NOT NULL`; the `company_job_complete` CHECK still requires the last four when
`company_id` is set, and `scraped_job_completed` requires `company_name` and
`apply_url` when it is not. Add a column one kind needs to the matching CHECK,
not a bare `NOT NULL`.

**No salary is required at the database level** — `salary_exist` was dropped,
since job boards rarely state one. `JobPostingCreate` in
`schemas/company_jobs.py` still requires one from the company form; that is
a product rule, kept in the API.

**`status` defaults to `published`** in the model and the database, so an
import that sends no status lists the job at once. The company form always
sends one (draft unless published), so a company's job is unaffected.

**Company routes stay safe without changes:** they filter on
`company_id = account.company_id`, which a scraped row's NULL never matches.
Anything that lists jobs *across* companies must decide whether it wants
`company_id IS NULL` filtered.

`posted_at` is when the job board says the job went up; `created_at` is when
the row was stored. Nothing sets `posted_at` for a company's job yet.

**Company search uses a trigram GIN index** on `company_name`
(`55f3c813be50`), so `ILIKE '%term%'` and the fuzzy `<%` operator look
matches up instead of scanning. Measured on 2026-10-06: about 140 KB for the
1,069-job feed and about 3.1 MB at 100k rows. A search under 3 characters
produces no trigram and scans anyway. `title` had one too, dropped in
`4cfa4c1836cd`; title search has no index now. `company_name` is only filled for scraped jobs, so
searching company-posted jobs by employer needs a join or a copied name.

**Job matching adds three columns (KAN-139):**
- **`job_postings.embedding` and `resumes.embedding`** hold Gemini vectors,
  `vector(768)` from pgvector, sized by `dto.EMBEDDING_DIMENSIONS`.
- **`job_postings.fts`** is a generated `tsvector` of the title and
  description. Postgres computes it and keeps it current, and `Computed` keeps
  it out of every INSERT and UPDATE, so nothing in Python writes it.
- **All three are `deferred`**, so the company-jobs and resume routes' ORM loads
  never pull 768 numbers, or a few KB of search terms, per row.
- **Their migration is `4485d7a7a712`**, which revises `b81d4e2f6c09` (visa
  sponsorship). Until it is applied, any branch that maps these columns
  breaks resume upload and company job creation (see "A new column reaches the database before the model that
  maps it", above).

What writes them, and why, is `../services/matching/CLAUDE.md`.

## Identity lives in auth.users

Supabase Auth owns credentials (`../../CLAUDE.md`'s Auth section). **No table
here stores a password or a hash, and none should** — `197cfcdecdb8` dropped
the `password_hash` columns an earlier FastAPI-issued auth had added.

What that means for the account tables:

- **`id` references `auth.users(id) ON DELETE CASCADE`** and has no default.
  Create the auth user first and use its id; `routers/auth.py`'s signup does
  exactly that, and deletes the auth user again if the profile insert fails.
  Deleting a user in the Supabase dashboard deletes their account row.
- **`auth_users.py` is a stub**, one column, so SQLAlchemy can resolve that
  foreign key. `alembic/env.py`'s filters keep autogenerate from ever creating
  or dropping it. Do not add columns to it or query through it.
- **`email` is a copy** of `auth.users.email`, kept for display and joins.
  Supabase signs in with its own copy. Nothing changes an email yet; whatever
  first does must update both.
- **Global email uniqueness now comes from `auth.users`,** which the old
  per-table `UNIQUE` on `email` could never give. The per-table constraints
  stay as a second check.
- **`onboarding_completed_at`** stays here: it is app state, not identity.
  NULL until onboarding completes, and read on every `/auth/me`.
- **`avatar_path`** is a path in the private `Avatar` Storage bucket, never a
  URL and never image bytes. Renamed from `avatar_url` in `4f1a9c2e7b30`;
  `../../db/avatar.md` has why.

## Known gaps

Real, not forgotten. Do not treat their absence as a decision already made.

- No index on `company_memberships.company_id` — the column every authorization
  check filters on.
- Only `company_profiles.id` has a UUID default (Python `uuid4` plus
  `gen_random_uuid()`); every other insert must supply `id`. The account
  tables must keep having none — their id is the `auth.users` id.
- `autofill_answers` is not implemented. It is still wanted: one reusable answer
  bank per applicant, keyed on `applicant_profiles.id`, with a `jsonb answers`
  column mapping stable question keys to `{question_text, answer}`. Workday-style
  forms repeat the same authorization, sponsorship and availability questions, so
  one JSONB bank beats a row per question. It needs
  `NOT NULL DEFAULT '{}'::jsonb`, a `CHECK (jsonb_typeof(answers) = 'object')`,
  and per-key writes through `jsonb_set` rather than replacing the bank from
  stale client state — none of which autogenerate emits.
- `applicant_profiles.location` and `company_profiles.industry` are absent.
- `company_profiles.contact_email` is unique, which forbids two companies sharing
  an HR inbox — plausible for subsidiaries. Probably wrong; confirm it is
  intended.
- `updated_at` is maintained by SQLAlchemy's `onupdate`, which covers ORM and
  Core writes but **not** changes made from psql or the Supabase dashboard. A
  database trigger would; autogenerate emits none.

## Out of scope

These belong to later tickets and should not be added here:

- Jobs, applications, pipeline stages, interviews, offers, resume scores. ATS
  clones model all of them; `../../db/job_posting.md` starts that work.
- Resume storage and parsing — implemented in `resume.py` (model) and
  `../utils/resume_parser.py` (heuristic parser). See `../../db/resume.md`
  for design rationale.
- Browser-automation or session state for the autofiller. If autofill needs it
  later, that is a separate `autofill_runs` table, not a column here.

## Pointers, not copies

- Auth, the frontend contract, and why not PostgREST — `../../CLAUDE.md`.
- Migration rules, the schema filters, and what autogenerate does not emit —
  `../../alembic/CLAUDE.md`.
- Models vs Pydantic schemas stay separate layers — `../../CLAUDE.md`.
