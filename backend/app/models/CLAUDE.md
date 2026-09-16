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

## Register every model in __init__.py

`alembic/env.py` does `from app import models`. A model that import does not
reach is absent from `Base.metadata`, and autogenerate writes a migration
**dropping the table it cannot see**.

List classes explicitly rather than `import *` — guaranteeing registration is
this file's whole job, and a star import hides what it registered. The `noqa` on
the import in `env.py` is load-bearing; linters strip "unused" imports, and
stripping that one is how the table gets dropped.

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
edit. Get the value set right before the first migration lands.

`company_size_range` uses fixed MVP buckets for exactly this reason — the
domain does not grow with the product. For anything that will, a lookup table
costs a join and saves the coordination.

## Credentials are missing, and that is now blocking

**FastAPI issues the session token** — see `../../CLAUDE.md`. Supabase is
managed Postgres only, so there is no `auth.users` table to reference and no
external identity provider. That resolves an old question: these tables
correctly have no foreign key to `auth.users`, because no such table exists.

It also creates one. **Nothing here stores a password hash.** The account tables
have `email` (unique per table) and no credential column at all, so this schema
cannot authenticate anyone yet.

Resolve this before the first migration, because it is an identity decision and
not a column addition:

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
