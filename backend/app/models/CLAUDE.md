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
separately. This is unusual for a Supabase-style schema, which normally pairs
every auth user with one app-owned profile row.

What it buys: one row per account, so loading a recruiter or an applicant reads
a single table — no join, no discriminator column, no inheritance machinery. The
two audiences stay genuinely separate, matching how the frontend is already
split (`(seeker)` vs `/company/*`). Many HR users per company with distinct
roles still works, since `company_id` is a plain foreign key.

What it costs — properties of the design, not defects:

- **An HR user belongs to exactly one company.** `company_memberships.id` is
  both the primary key and the user's identity, so a second membership for the
  same person is a duplicate-key violation.
- **Someone who is both an applicant and an HR user has two unlinked rows.** Two
  emails, two names, no query relating them. Updating one does not touch the
  other.
- **Deleting a company deletes its HR users' accounts.** The cascade on
  `company_id` is correct for a join row, but a membership *is* the account.
  Confirm this is wanted before writing a company-delete path.

The escape hatch, if the product needs one human with both roles or a recruiter
at two employers: make `Profile` concrete and add `profile_id` foreign keys. A
migration and a backfill, not a rewrite. Do not half-do it — a `profile_id`
with no table to point at is worse than neither.

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
- `Profile` supplies `id`, `email`, `full_name`, `phone_number`, `avatar_url`.

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
| `company_role` | `Owner` | `"Owner"` | `Owner` |
| `profile_status` | `Active` | `"Active"` | `Active` |
| `company_size_range` | `ONE_TO_FIFTY` | `"1_50"` | `ONE_TO_FIFTY` |

`company_role` and `profile_status` set name and value identical, so those
columns store what Python compares against. **`company_size_range` does not** —
the column holds `ONE_TO_FIFTY` while `== "1_50"` is what returns `True`.

So: **compare against the member, never a string literal.**

```python
if membership.status == profile_status.Active:        # correct
if membership.status == "Active":                     # works, but fragile
if membership.status == "ACTIVE":                     # silently always False
```

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

## Locations — countries, states, and the resolver not yet written

### The tables

`locations.py` holds two reference tables keyed by ISO codes, with no
surrogate ids:

- `countries.code` — ISO 3166-1 alpha-2 (`US`, `GB`).
- `states.code` — ISO 3166-2 (`US-CA`), with `country_code` → `countries`.

**The code is the key.** A job posting stores `US-CA` itself, so filtering
"jobs in California" is `WHERE location_state = 'US-CA'` with no join. The join
to `states` is only for the display name.

**The foreign keys are for integrity, not speed.** They make Postgres reject
`'NY'`, `'New York'` or `'US-XX'`, so every row spells a place one way. The
speed comes from `job_postings_loc_idx` on `(location_country, location_state)`;
Postgres does not index a foreign key column by itself.

### How job_postings references them

- `location_country` — required, with its **own** FK to `countries`. Postgres
  skips a composite FK when any of its columns is NULL (`MATCH SIMPLE`), so
  without this a country-only row would go unchecked.
- `location_state` — nullable. "United States" or a country with no seeded
  subdivisions has no state.
- The composite FK `(location_state, location_country)` → `states(code,
  country_code)` rejects a state from the wrong country: `('US-NY', 'CA')`
  fails.
- **Remote is `work_style`, not a location.** A remote posting still names a
  country ("Remote, US"). Never add a sentinel "REMOTE" code; it duplicates
  `work_style` and cannot say "remote, US only".

A bad code raises `IntegrityError` on insert.

### What is seeded

Seeded by migrations, frozen inline from pycountry 26.2.16:

| Revision | Rows |
| --- | --- |
| `cca905583de8` | 15 of ISO's 249 countries — see below |
| `6b5bd2831d18` | 57 US subdivisions: 50 states, DC, 6 outlying areas (PR, GU…) |

**The countries list is incomplete on purpose.** It holds 15: Australia,
Canada, China, Denmark, France, Germany, Hong Kong, Italy, Japan, New Zealand,
Singapore, Spain, Taiwan, the United Kingdom and the United States. Everything
else was cut on 2026-09-22 to keep the seed small while the product is young —
not for storage, which was never the constraint (all 249 fit in about 50 KB).
Any of them can be added back when real postings need it.

Consequences, until someone adds them back:

- A posting in an unseeded country cannot be stored with that country — its
  `location_country` fails the FK. The resolver must return nothing for it
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
`location_state` NULL. That scope was chosen on purpose: earlier drafts seeded
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

### The resolver — design settled, code not in this branch

Scraped postings give free text ("New York, NY"). Something must turn that into
`(location_country, location_state)` before insert. The design below was
prototyped on 2026-09-22 against a larger seed; the cases below are
restated for the US-only seed that shipped, then left for a
separate branch. A draft may still be reachable in commit `554e279`.

**Where.** `app/services/location_resolver.py`. **Never in this folder**:
`__init__.py` imports every file here as a model at startup.

**Built from the tables, not from pycountry.** Load `countries` and `states`
once per process (two small queries) into in-memory dicts. Every code it
returns is then one the FKs accept. Lookups are dict hits; speed is a non-issue
next to fetching the posting over HTTP.

**Interface, both directions:**

```
country_code("U.S.A.")            -> "US"     country_name("US")    -> "United States"
state_code("new york")            -> "US-NY"  state_name("US-NY")   -> "New York"
resolve("Austin, Texas, USA")     -> ("US", "US-TX")
resolve("San Francisco")          -> None
```

**Normalize every key and every input the same way:** casefold, strip accents
(NFKD, drop combining marks), drop periods, map `’` to `'`, collapse whitespace.
Then "U.S." = "us", "Türkiye" = "turkiye", and "Québec" = "quebec".

**State keys are stored per country**, because abbreviations repeat once more
countries are seeded ("WA" is Washington and Western Australia). Each state is
keyed by its name, its full code (`us-ny`) and its suffix (`ny`). Skip
numeric suffixes if a future seed has them (`JP-13` is Tokyo, and a bare "13"
means nothing). Looked up without a country, a key that matches several states
returns the US one if there is one, otherwise nothing.

**Aliases the tables cannot produce**, kept as two dicts in the resolver:

- Countries: nicknames (`usa`, `uk`, `uae`, `russia`, `turkey`, `czech
  republic`, `holland`, `korea`…) and local-language names (`deutschland`,
  `espana`, `italia`, `schweiz`, `suisse`, `nederland`, `brasil`, `osterreich`).
  Many of these point at countries the trimmed seed dropped; when the resolver
  loads, discard any alias whose target is not in `countries`, or it returns
  a code the FK rejects.
- States: only `washington dc` → US-DC today. A future seed whose English
  names override ISO's adds the local names here (`bayern` → DE-BY); derive
  them by comparing pycountry's names with `states.name`, not by hand, and add
  them in the same PR as the seed.
- Alias England, Scotland, Wales and Northern Ireland to `GB` as countries
  while GB has no states, or "Edinburgh, Scotland" resolves to nothing. If GB
  states are ever seeded, drop these aliases: the nations become states
  (`GB-ENG`…), and resolving them as states still yields GB.

**`resolve(text)`.** Split on commas, drop empty parts, read from the right. Try
the last part, in order:

1. a **US state** → that state, country US
2. a **country** → that country; then try the part before it as a state
   *within that country*
3. **any other country's state** → that state and its country
4. otherwise → `None`

The order wins the collisions that matter on a US job board. Short codes
collide constantly:

| Input | Result | Instead of |
| --- | --- | --- |
| `Indianapolis, IN` | US-IN | India |
| `Atlanta, Georgia` | US-GA | the country Georgia |
| `Amsterdam, NL` | NL | Newfoundland |

Known misses, accepted: "Berlin, DE" → Delaware, "Regina, SK" → Slovakia,
"Perth, WA" → Washington. Spelled-out names resolve correctly. Step 3 only
matters once a second country has states; with the US alone, a bare "ON" or
"Bavaria" resolves to nothing. With the 15-country seed, India, Georgia, the
Netherlands and Slovakia are not seeded either, so the collisions above cannot
happen yet — keep the order anyway, since they return with those countries.

Cases checked against the seeds, as a starting test set:

```
New York, NY                          US, US-NY
Seattle, WA, United States            US, US-WA
Washington, D.C.                      US, US-DC
London, England, United Kingdom       GB, —
London, UK                            GB, —
Edinburgh, Scotland                   GB, —       (via the scotland alias)
Paris, Île-de-France, France          FR, —       (no FR states seeded)
München, Bayern, Deutschland          DE, —       (via the deutschland alias)
Bengaluru, Karnataka, India           IN, —
Toronto, ON, Canada                   CA, —
Remote, US                            US, —
Dublin, Ireland                       IE, —
San Francisco / Remote / ""           None
```

**What it cannot do.** A city alone ("San Francisco") has no ISO entry; that
needs city data such as GeoNames `cities15000.txt` (city → country + admin1),
picking the most populous match for a repeated name. Until then, do not guess
on a miss: log it, since misses show which aliases to add. `job_postings` has
no column for the raw text, so an unresolved posting cannot be stored for a
later retry. Add a `location_raw` column if that matters.

## Credentials are missing, and that is now blocking

**FastAPI issues the session token** — see `../../CLAUDE.md`. Supabase is
managed Postgres only, so there is no `auth.users` table to reference and no
external identity provider. That resolves an old question: these tables
correctly have no foreign key to `auth.users`, because no such table exists.

It also creates one. **Nothing here stores a password hash.** The account tables
have `email` (unique per table) and no credential column at all, so this schema
cannot authenticate anyone yet.

**The first migration shipped without it.** `dee263a84adb` created these tables
with no credential column, so closing the gap is now an `ALTER TABLE ADD
COLUMN` migration rather than a free edit. There is already a consumer waiting:
the KAN-114 auth branch expects `password_hash` and `onboarding_completed_at`
on the account tables, and must bring its own migration adding them.

Settle the question below first, because it is an identity decision and not a
column addition:

- **`email` is unique per table, not globally.** The same address can exist in
  both `applicant_profiles` and `company_memberships`, so "look up the user by
  email" has two answers. Either enforce global uniqueness across both tables,
  or make login account-type-scoped and accept that one address can own two
  accounts.
- **Where the hash lives** follows from that. A shared `credentials` table keyed
  by email gives one login path and one place to rotate hashing parameters, but
  it reintroduces the shared identity row this schema deliberately avoids. A
  `password_hash` column on each account table keeps the halves separate and
  duplicates the login logic.

Do not add a `password_hash` column to one table and not the other, and do not
store a hash without deciding which of the two shapes above is being built.

## Known gaps

Real, not forgotten. Do not treat their absence as a decision already made.

- No index on `company_memberships.company_id` — the column every authorization
  check filters on.
- No UUID default anywhere; every insert must supply `id`. A
  `server_default=func.gen_random_uuid()` would move that into the database.
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
- Resume storage and parsing — Brian's separate work, see `../../db/resume.md`.
  That design should reconsider `file_hash` for deduplication and idempotent
  parsing.
- Browser-automation or session state for the autofiller. If autofill needs it
  later, that is a separate `autofill_runs` table, not a column here.

## Pointers, not copies

- Auth, the frontend contract, and why not PostgREST — `../../CLAUDE.md`.
- Migration rules, the schema filters, and what autogenerate does not emit —
  `../../alembic/CLAUDE.md`.
- Models vs Pydantic schemas stay separate layers — `../../CLAUDE.md`.
