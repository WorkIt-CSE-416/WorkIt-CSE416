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

### KAN-233: internship is a job type, levels are who the job is for

`job_type` gained `internship`, and `experience_level` became `student`,
`new_grad` and `experienced` (from `internship`, `new_grad` and `other`).
Every internship is `job_type = internship` with `experience_level =
student`; the hours an internship states aren't kept, as the cards never
showed them (KAN-171). It is the first enum change made with no downtime,
expand then contract, and the recipe for the next one:

1. **Expand** (`027620538860`, before the deploy): `ADD VALUE` the new values
   only, in an autocommit block. The running code never meets them.
2. **Deploy** code that writes only new values and reads both. Here every read
   of the two columns goes through `queries/jobs/legacy_levels.py`, and the
   enum keeps the old members marked LEGACY.
3. **Move the rows** (`aa97037c00e5`, after one import on step 2's code):
   rewrite the remaining old values as new ones, and leave the type alone.
   Then deploy the code without `legacy_levels.py` and the LEGACY members,
   which can't read an old value.
4. **Drop the old values** (`188c8c2d7c14`, after that deploy): rebuild
   `experience_level` without them.

**Steps 3 and 4 must be two migrations with the deploy between them.** One
contract migration has no safe order: applied first, it drops values the live
code still names in its queries (`experience_level IN ('student',
'internship')`), and Postgres refuses a query that names a value its enum
lacks, so the Experience filter and counts fail; deployed first, the new code
meets rows it can't read. KAN-233 first wrote it as one, and review caught it
before it was applied.

**The column keeps `student`; the filter no longer offers it (KAN-284).**
`student` meant exactly the internships, so the Jobs page's Student with
Full-Time matched no job. The Experience Level filter now offers `new_grad`
("Entry Level / New Grad") and `experienced`, and `queries/jobs/filters.py`'s
`filter_levels` makes `new_grad` match `student` too: every internship counts
as entry level. A search's "new grad" (`query_levels`) stays `new_grad` only.
`?experience=student` is still accepted, for old links and saved preferences.

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

## The experience bank

`bank.py` holds the bank row, entries, bullets and skills (KAN-206). The
design rationale is in `../../../docs/resume.md`, "The experience bank";
the rules every write follows are in `../services/bank.py`. Invariants a
change here must keep:

- **`bank_section` has six values, not seven.** Skills is a section to the
  student but its own table. Adding a section is an `ALTER TYPE ... ADD
  VALUE` and a coordinated deploy (above).
- **`experience_banks` has one row per applicant, made by the first bank
  change** (an upsert in `clear_embedding`), not at signup. A missing row
  reads as "no embedding yet". Its `embedding` is the only applicant vector
  the recommender reads (KAN-212).
- **Section fields are plain nullable columns on `bank_entries`**, not a
  JSONB blob, so later queries (graduation date, Tailor's text search) read
  them directly. `schemas/bank.py`'s `SECTION_FIELDS` says which section
  owns which; the database only checks the end (`bank_entries_end_check`).
- **A skill name appears once per applicant, ignoring case**
  (`bank_skills_applicant_name_key` on `lower(name)`), so Tailor's "Have you
  used X?" and import can look a skill up by name.
- **Bullet positions are 0..n-1 within an entry.** The service renumbers on
  every move and delete; there is no unique constraint on them, because a
  reorder would then have to dodge its own rows mid-update.
- **`bank_skill_links` joins a skill to an entry of the same applicant**
  (KAN-216), keyed by the pair, cascading from either side. The table has
  no applicant column, so it cannot check that both sides share an owner:
  `services/bank.py`'s `link_skill` does, and a link written any other way
  can join two students' rows.

## Built resumes

`built_resume.py` (KAN-207): a built resume and its choice rows. Rationale in
`../../../docs/resume.md`, "Built resumes"; what shows is
`../services/resume_view.py`. Invariants:

- **Choice rows hold no text.** `built_resume_entries`, `_bullets` and
  `_skills` say only whether a bank item shows, its position and (entries)
  the GPA and coursework toggles; the words always come from the bank (ADR
  0001). Never copy bank text onto a built resume.
- **No choice row means not on the resume**, for entries, bullets and skills
  alike, so what is added to the bank after Generate waits in the tray.
  Deleting a bank item cascades to its choice rows.
- **A base resume has no `job_posting_id`; a tailored one has one**, unique
  per applicant and posting (`built_resumes_applicant_posting_key`; NULLs are
  distinct, so base resumes are many). No built resume counts toward the
  limit of 5, which is uploads only (`../services/built_resumes.py`).
- **The default resume is two pointers, at most one set.**
  `applicant_profiles.default_resume_id` (an uploaded resume) and
  `default_built_resume_id` (a base or tailored resume; tailored since
  KAN-268), each `ON DELETE SET NULL`, with
  the check `applicant_profiles_one_default_resume`. One column could not
  carry a foreign key to two tables; setting one clears the other
  (`set_default`). Code that reads "the default" checks both: a base default
  leaves `default_resume_id` null. The recommender and Scout read neither:
  they read the experience bank (KAN-212).
- **A bullet choice may name a variant** (`variant_id`, KAN-217), whose
  text the view shows in place of the original; `ON DELETE SET NULL`
  brings the original back. The table cannot check that the variant
  belongs to the choice's bullet: Tailor's Done makes or reuses the
  variant for that bullet itself, and whatever writes `variant_id` next
  (the editor) must do the same.
- **`bank_bullet_variants` has two owners, at most one set**: a job posting
  (Tailor) or a built resume (a local variant, at most one per bullet and
  resume, `bank_bullet_variants_local_key`), with the check
  `bank_bullet_variants_one_owner_check`. Neither set is allowed and reads
  as a variant of the bank's own.
- **`default_built_resume_id` is a mapped column on `applicant_profiles`**,
  so every signup INSERT names it: migration `5753545063f3` is applied
  before the code deploys (above, "A new column reaches the database...").

## Sent resumes

`sent_resume.py` (KAN-208): the exact file a student downloaded or applied
with. Rationale in `../../../docs/resume.md`, "Sent resumes". Invariants:

- **A row never changes after it is written**, and its file is never
  overwritten. The API lists and deletes sent resumes, never edits them.
- **`built_resume_id`, `uploaded_resume_id` and `job_posting_id` are
  `ON DELETE SET NULL`**: the record outlives its source. At most one source
  is set (`sent_resumes_one_source`).
- **`storage_path` may be shared** with an uploaded resume or another sent
  resume, so a file is removed only when no row uses it
  (`../services/sent_resumes.py`'s `file_in_use`). `content_hash` is null on
  a row from an uploaded resume.

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
- **Display uses `job_postings.location_label`, else `location_raw`**, never
  these rows. The codes are for filtering and lose the city. The import
  writes `location_label` ("San Francisco, CA") from the city the resolver
  already picks (`Resolution.label`, KAN-171): a segment becomes "City, ST"
  only when every place in it is a US city with a state and it names no
  arrangement ("Remote - San Francisco" keeps its words), so the label never
  says less than the posting. It is display text, not a city field: nothing
  filters on it, and the Location filter stays at countries and states (a
  city filter's options would run to thousands, which the team ruled out on
  2026-10-09). GeoNames names a job listing wouldn't use are swapped in
  `_DISPLAY_NAME` ("New York City" reads "New York").
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
assigns later. Never use it for Remote — that is `work_style` (above). A job
remote from anywhere ("Remote", "Work Remotely") has `work_style = remote`
and no `job_locations` rows: the resolver reads those words as no place, and
the job board's location filter keeps such a job under every place
(`unplaced_remote` in `queries/jobs/filters.py`). Filing it under `ZZ` instead, as
this said before, would have put it beside the roles in Peru and Colombia,
hidden from a seeker picking United States all the same.
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
   most populous match, or a US match at least half that size, by its own
   name first: only a name that is no city's own ("SF", "NYC") goes by
   alternates. "Waterloo" is a Waterloo, not Austin's old name (that put
   "Austin, TX" on a Waterloo co-op's card, review 2026-10-10). A name alone
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

## Job roles — `job_roles.py`

The short list of roles search filters by and onboarding will offer, and the
roles each job is tagged with. **This is what `GET /jobs?role=`, `?q=` and
the Jobs page's Role filter read (KAN-155), not `job_postings.roles`**
(KAN-172, below): that column holds the scraper's own category keys
(`"data_ai/ml"`), which the import still writes until a later migration drops
it (expand, then contract). The scraper still uses those keys itself, to
decide which postings to keep; that is unchanged. `job_role_tags` holds
`job_roles` slugs from `services/role_resolver.py`. `../../../docs/search.md` has the design and
why; the rules for this folder:

- **`job_roles` is keyed by `slug`**, like `countries.code`: no surrogate id.
  The slug is copied into every tag, every onboarding pick and the resolver's
  alias dict, so **it never changes once shipped**. Renaming what people see
  changes `name`. The `job_roles_slug_shape` CHECK keeps it lowercase words
  joined by underscores, so it reads cleanly in `?role=`.
- **Only migrations change the list**, each a frozen copy of the rows it
  inserts or updates, as the country and state seeds are. Never import a
  Python constant into one: editing the constant later would change what an
  old migration does. The frontend reads the list from the API, never a copy.
- **`job_role_tags` is many-to-many on purpose.** A job has zero, one or
  several roles, so there is no `role_slug` column on `job_postings`. The
  primary key `(job_id, role_slug)` serves lookups by job, and
  `job_role_tags_role_idx` the role filter. `job_id` is named as in
  `job_locations`.
- **Deleting a job drops its tags (CASCADE); deleting a role is refused
  while any job is tagged with it (RESTRICT).** Removing a role is then
  deliberate: its migration deletes the tags first. SET NULL isn't possible,
  as `role_slug` is part of the primary key. Neither foreign key can ever
  delete a job: a cascade only runs from the table pointed at to the table
  pointing at it. Onboarding picks should take RESTRICT too.
- **Their migrations:** `362182aaa4fd` creates the tables (RLS on both) and
  revises `98ab19cfe840` (main's `roles` column; re-parented from
  `4485d7a7a712` when KAN-155 merged main, before either was applied);
  `ab07572bba38` seeds
  the first 49 roles, flat, grouped to cover the twelve categories the
  scraper keeps (so a job it keeps finds a role), with `sort_order` in gaps
  of 10 so a role can be
  inserted between two without renumbering. **The import reads `job_roles`
  and writes `job_role_tags`, so both migrations must be on the database
  before that code runs**; without them it refuses and writes nothing
  (`../../CLAUDE.md`, Commands).
- **A seed's downgrade deletes its roles' tags first**, since RESTRICT refuses
  the role delete otherwise. The import writes the tags again.
- **Adding a role is a seed migration plus its aliases** in
  `../services/role_resolver.py`. The resolver is built from the slugs the
  database holds and raises on an alias for one it doesn't, so aliases for a
  role whose migration isn't applied fail the import loudly.

### The resolver — `app/services/role_resolver.py`

Title (or search query) → slugs, by whole-word alias lookup. The module
docstring has the steps and `../../../docs/search.md` the measurements and
why. Rules that a change here must keep:

- **Add a case to `tests/test_role_resolver.py` before changing an alias.**
  Aliases interact: a short one fires inside a longer title, and an outright
  role drops the others. The tests read the roles from the seed migration,
  check every role's name and every alias resolve to their own role, and hold
  a 90% coverage floor on `data/feed.json` (95.8% on 2026-10-11).
- **`WORD_FORMS` holds a person's forms, never a process.** `development` →
  `developer` tagged "Graduate Development Program" as software.
- **An `OUTRIGHT` role's aliases name the job, never only its field.** A lone
  "sales" or "recruiting" would take "Software Engineer, Sales Platform" away
  from software.
- **One phrase, one owner.** Construction raises if two roles, or a role and
  `NOT_ROLES`, claim the same phrase after word forms.
- **Precision over recall.** A title that names no role gets no tag; it is
  still found by keyword. Never add a catch-all alias to raise coverage.
- **Search reads the title as well as the tag.** The longest alias takes a
  title's words, so "Embedded Software Engineer" is `embedded_engineer`
  alone. `read_query` returns the phrases that named each role (`said`), and
  `GET /jobs?q=` keeps a job tagged with the role *or* whose title says them
  (`title_pattern`: whole words, in order, in their `WORD_FORMS` spellings).
  The tag stays exact; only search widens. Never make that match stemmed:
  the `english` stemmer makes "developer" "development" again.
- **Typos are corrected in queries, never in titles.** `read_query` snaps a
  word of `FUZZY_MIN_LENGTH` (5) letters or more that no alias holds to the
  nearest one that does (`difflib`, cutoff `FUZZY_CUTOFF` 0.8): "sofware
  enginer" finds `software_engineer`. `resolve` stays exact, since its result
  is a stored tag. A corrected word leaves `rest` only if it completed an
  alias, so a company that looks like an alias word ("scale" ~ "sales") is
  still searched for. Raising the cutoff or lowering the length is a test
  change first: `test_read_query_leaves_names_alone` holds the company and
  keyword names that must pass through untouched.

## Saved preferences — `preferences.py` (KAN-231)

What onboarding asks, kept so the Jobs page can apply it as filters:

- **`applicant_preferences`**, one row per applicant (primary key
  `applicant_id`, CASCADE), holds the picks in **GET /jobs' own values**
  (`remote`, `full_time`, `summer-2027`...), so the API hands a saved set back in
  the query's names and the frontend turns it into filters with no
  conversion. Lists are `text[] NOT NULL DEFAULT '{}'`: no pick is an empty
  list, never NULL. Pay is stored as entered, per `pay_per`, and converted
  to yearly only when GET /jobs filters on it.
- **Text with CHECKs, not Postgres enums.** Changing an enum's values is a
  coordinated deploy (KAN-233 took an expand and a contract step), while a
  CHECK changes in one migration.
  The CHECKs mirror the values `routers/jobs.py` accepts; seasons are
  checked by shape in the API only, as GET /jobs checks them. A new filter
  value changes both.
- **Roles are `applicant_job_roles` rows**, not a column, for their foreign
  key to `job_roles` (RESTRICT, as above). The API checks the slugs first so a
  bad one is a 422 that names it, not an `IntegrityError`.
- **Places are `applicant_locations` rows, built like `job_locations`**: a
  country, and the state when one was picked, with the same foreign keys and
  `UNIQUE NULLS NOT DISTINCT`. `Place.from_code` (`services/location_resolver.py`)
  turns a filter code into that row for both the Jobs page's location filter
  and the preferences route, so the two cannot read "US-CA" differently. An
  unknown code is a 422, as for roles.
- **The GET is one query**: the row plus an `ARRAY(subquery)` for the roles
  and one for the places, each `'{}'` when none.
- **Date Posted is never saved**: a fixed "past 24 hours" would empty the
  feed within days.
- **Saving is finishing onboarding.** `PUT /applicants/{id}/preferences` sets
  `onboarding_completed_at` once, in the same transaction.
- **Their migration is `4c59715d02db`** (RLS on all three tables), on top of
  `027620538860` (KAN-233's expand). It must be on the database before the
  API that maps them deploys.

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
- **`job_postings.embedding` and `resumes.embedding`** hold embedding vectors,
  `vector(768)` from pgvector, sized by `dto.EMBEDDING_DIMENSIONS`.
  **`resumes.embedding` is no longer mapped** (KAN-212 moved the embedding to
  `experience_banks`): the column stays in the database until a contract
  migration drops it, written and applied only after the code that stopped
  mapping it is deployed, as with `824f0b2e3d84` below. Until then
  `alembic revision --autogenerate` proposes `drop_column('resumes',
  'embedding')`: delete that line from any migration that is not the drop
  itself, or the drop ships before the deploy and old code's inserts fail.
- **`job_postings.fts`** is a generated `tsvector` of the title (weighted A)
  and description (weighted D), so anything that ranks with `ts_rank` puts a
  title match first (search itself doesn't rank: `@@` ignores weights), with
  the GIN index `job_postings_fts_idx` serving `GET /jobs?q=`; both from
  `a70c641b2f99`, which drops and adds the column (a generated column's
  expression can't be altered in place everywhere). Postgres computes it and
  keeps it current, and `Computed` keeps it out of every INSERT and UPDATE, so
  nothing in Python writes it. `@@` ignores weights, so matching's skill
  overlap reads it unchanged.
- **All three are `deferred`**, so the company-jobs and resume routes' ORM loads
  never pull 768 numbers, or a few KB of search terms, per row.
- **Their migration is `4485d7a7a712`**, which revises `b81d4e2f6c09` (visa
  sponsorship). Until it is applied, any branch that maps these columns
  breaks resume upload and company job creation (see "A new column reaches the database before the model that
  maps it", above).

What writes them, and why, is `../services/matching/CLAUDE.md`.

**Tailor's keywords are cached on the posting (KAN-215).** `keywords` (JSONB,
at most 20 `{"keyword", "kind"}`) and `keywords_hash` (the SHA-256 of the
description they came from), both `deferred`, from `e1c4a7b9d215`. A hash
that differs from the description's means stale, so a company's edit is
caught with no extra code; the feed import also clears both when it changes
a description, so a stale list never sits in the table. Only
`services/keywords.py` reads or writes them. Apply the migration before the
deploy: the model maps them, so company job creation fails on a database
without them (above).

**`job_postings.role_category` and `job_postings.roles` are gone
(`824f0b2e3d84`).** They held the scraper's role keys: `role_category` one of
five disciplines (KAN-171, `aa41fdc1ba80`, with its `role_category` enum) and
`roles` up to two of twelve categories plus specialties (KAN-172,
`98ab19cfe840`, `text[]` with the GIN index `job_postings_roles_idx`), which
`GET /jobs?role=` filtered on. KAN-155 replaced both with `job_roles` /
`job_role_tags` (above), and the backend's `dto.role_key` and
`dto.role_category` went with them. The drop is the contract half of an expand,
then contract: it must be applied only **after** the code that stopped
reading and writing the columns is deployed (`../../CLAUDE.md`, Commands).
Its downgrade puts the columns back empty; the old import refills them.

## job_applications — each applicant's application to each job (KAN-232, KAN-223)

`applications.py`: one row per (applicant, job). The Applied button
(`routers/applications.py`) writes it `applied`, a Save button `saved`
(KAN-261); auto apply (`app/auto_apply/`) writes it `queued` and moves it on.
GET /jobs leaves out that applicant's `applied` jobs (`JobFilters.applied_by`,
a `NOT EXISTS`); auto apply's matches leave out every stage, `saved` too
(`no_application_by`), so a batch never picks a saved job. Rules:

- **A join table, never an array of applicant ids on `job_postings`.**
  Postgres can't foreign-key an array's elements, so deleted applicants
  would linger in it; every apply would rewrite a job row the import also
  upserts; and "jobs I applied to" would scan every job.
- **The primary key `(applicant_id, job_id)`** stops a second row for one
  job and serves the feed's filter, which leads with the applicant;
  `job_applications_job_idx` serves "who applied to this job".
- **CASCADE from both sides**: deleting the account or the job deletes the
  row. A closed job keeps its rows, since closing is a status, not a delete.
- **`stage` is the status** (`dto.application_stage`: `saved`, `queued`,
  `needs_you`, `skipped`, `applied`; `c0467afe819c`, `saved` from
  `17ea74fa4573`), a column here rather than a second table, so one row is
  one application. `created_at` orders the queue.
- **`saved` is a bookmark, not an application** (KAN-261). Nothing queues
  it by itself: batches skip it. Applying, or the job's own Auto Apply
  click, moves it on (`mark_applied`; `queue_applications`, which also
  moves its `created_at` to now so it doesn't jump the queue); saving never
  moves a later stage back (`ON CONFLICT DO NOTHING`), and unsaving deletes
  a `saved` row only, a 409 otherwise. A saved insert names `applied_at`
  NULL, as a queued one does. Live Activity asks for every stage but saved;
  the Applications board asks for saved and applied.
- **`17ea74fa4573` goes on before the deploy that writes `saved`.** It only
  adds the value, so the code running before it never meets it; deployed
  first, every Save answers 500. Applied to the shared database on
  2026-10-18, before the Save feature merged.
- **`applied_at` is NULL until the applicant applies**, and the
  `job_applications_applied_dated` CHECK keeps an `applied` row dated.
- **The defaults (`stage` `applied`, `applied_at` `now()`) are for applied
  inserts**, so the code from before stages kept working whichever came
  first, the migration or the deploy. A queued insert must name both: its
  stage, and `applied_at` NULL (`auto_apply/queries.py`), or the default
  dates a job nobody applied to.
- **The Applied button upserts**: a saved, queued, skipped or needs_you row
  becomes applied; an applied row keeps its first `applied_at` (`ON CONFLICT
  DO UPDATE ... WHERE applied_at IS NULL`).
- **Apply `c0467afe819c` right after merging.** Until then the deployed
  code's queue routes and stage filters fail on the missing column; the
  Applied button keeps working either way.
- The resume sent and an undo are not built. The tracker's later stages
  (interviewing, offer) are Out of scope below.

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
  `../../../docs/avatar.md` has why.

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

- Pipeline stages, interviews, offers, resume scores. Hiring-system clones
  model all of them; `../../../docs/job_posting.md` starts that work. Jobs and
  the applied mark (`job_applications`, above) exist now.
- Resume storage and parsing — implemented in `resume.py` (model) and
  `../utils/resume_parser.py` (heuristic parser). See `../../../docs/resume.md`
  for design rationale.
- Browser-automation or session state for the autofiller. If autofill needs it
  later, that is a separate `autofill_runs` table, not a column here.

## Pointers, not copies

- Auth, why not PostgREST, and what each half may assume of the other (its
  Conventions) — `../../CLAUDE.md`.
- Migration rules, the schema filters, and what autogenerate does not emit —
  `../../alembic/CLAUDE.md`.
- Models vs Pydantic schemas stay separate layers — `../../CLAUDE.md`.
