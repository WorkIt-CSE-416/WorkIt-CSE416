# CLAUDE.md — backend

Guidance for Claude Code when working in `backend/`. Repo-wide rules — branch
names, the documentation split, the review skill — live in the root
`../CLAUDE.md`, which is always loaded alongside this one. This file is the
Python API.

## Where this folder sits

`backend/` is the whole Python project: its own `pyproject.toml`, `.venv`,
lockfile and tooling. Nothing above it is part of this build, and nothing in
`frontend/` is importable from here. The two halves communicate over HTTP and
share no code.

**This folder owns the database.** Connection strings, schema and migrations
all live on this side. The Next.js app holds no ORM and no credentials.

## Stack

FastAPI · Uvicorn · SQLAlchemy 2.0 (async, over asyncpg) · Alembic ·
pydantic-settings. Python 3.12, pinned by `requires-python = ">=3.12,<3.13"`.

Dependencies are managed by **uv**. `uv add <pkg>` to add one, `uv sync` to
install what the lock already names. Never `pip install` into the venv — it
writes nothing to `pyproject.toml` and the next `uv sync` silently undoes it.

**Not `supabase-py` / PostgREST, deliberately.** We connect to Postgres
directly over asyncpg. The job search needs ltree containment and trigram
ranking, which PostgREST's filter syntax expresses badly, and there is no
reason to put an HTTP hop between two services that already trust each other.
Supabase is managed Postgres to us and nothing else — see Auth below.

## Commands

Always prefixed with `uv run`, which executes inside `.venv` without activating
it. That is the whole reason uv is here: `.venv/bin/activate` and
`.venv\Scripts\Activate.ps1` differ by platform and the team is on both.

```
uv sync                                        install deps from the lock
uv run uvicorn app.main:app --reload           dev server on :8000
uv run alembic revision --autogenerate -m msg  write a migration
uv run alembic upgrade head                    apply pending migrations
uv run alembic downgrade -1                    undo the last one
uv run alembic current                         which revision the DB is on
uv run alembic check                           fail if models lack a migration
```

There is no test runner yet. When one is added, document it here.

**Never run `alembic init` again** — it overwrites `alembic/env.py` and undoes
the schema filters. `alembic/CLAUDE.md` explains what that costs.

## Layout

```
app/
  main.py         FastAPI app. /health (liveness) and /health/db (readiness)
  config.py       pydantic-settings; also rewrites URLs to postgresql+asyncpg
  db.py           Async engine, session factory, declarative Base
  models/
    CLAUDE.md     Model invariants — read before adding or editing a model
    profiles.py   Account and company tables
    dto.py        Enums
alembic/
  CLAUDE.md       Alembic decisions — read before editing anything here
  env.py          Migration environment
  versions/       Migrations. Empty until the first revision is written
  script.py.mako  Template for generated migrations
alembic.ini       Alembic config. Deliberately holds no database URL
db/
  job_posting.md  Schema design notes — rationale, NOT a source of truth
  resume.md       Same, for resume storage and parsing
pyproject.toml    Dependencies, and the pinned Python series
uv.lock           Exact resolved versions — committed
```

Routers will go in `app/routers/`, which does not exist yet.

## Current state

**Models exist; there are no migrations yet.** `app/models/` holds
`applicant_profiles`, `company_profiles` and `company_memberships`. Nothing has
been applied to a database, so the first revision is still to be written — and
per `alembic/CLAUDE.md` it should be reviewed by hand rather than trusted from
a diff.

The recommended next step is Pydantic response schemas serving fixture data, so
the frontend can replace its `data.ts` fixtures with real calls while the
schema churns underneath. The API contract should be designed deliberately
rather than falling out of whatever the tables happen to look like.

There is no CI. Two gates are worth adding before the first migration lands:
`alembic heads` failing when it returns more than one, and `alembic check`
failing on model drift.

## The database

### Two connection strings, and the port is the only difference

| Variable       | Port | Used by | Why                                       |
| -------------- | ---- | ------- | ----------------------------------------- |
| `DATABASE_URL` | 6543 | The app | Transaction pooler; short connections     |
| `DIRECT_URL`   | 5432 | Alembic | Session pooler; DDL locks need one session |

**`.env` lives at the repo root, not in `backend/`.** Copy the root
`.env.example` to `.env` beside it — `.env*` is gitignored, with `.env.example`
negated — and fill it in from the Supabase dashboard connection string (Project
Settings → Database), using the two ports above:

```
DATABASE_URL=postgresql://postgres.<ref>:<password>@<host>.pooler.supabase.com:6543/postgres
DIRECT_URL=postgresql://postgres.<ref>:<password>@<host>.pooler.supabase.com:5432/postgres
```

URL-encode the password if it contains `@`, `/`, `:` or `#`, or the URL parses
wrong and the error will not say why.

Do not collapse them into one variable. It appears to work until a migration
hangs or prepared statements fail under load. `app/config.py` rewrites both to
`postgresql+asyncpg://` automatically, so paste what Supabase gives you.

`ENV_FILE` in `app/config.py` resolves the root path from `__file__`, not from
the working directory. That is deliberate: pydantic's default `env_file=".env"`
is relative to wherever the process started, so it would find the file when run
from the root and silently miss it when run from `backend/` — which is where
uvicorn and alembic actually run. If the file ever moves again, that one
constant is the only thing to change.

### Engine settings that are not optional

`app/db.py` sets `NullPool` because Supavisor is already a connection pool, and
`statement_cache_size=0` plus `prepared_statement_cache_size=0` because
transaction mode hands each statement to whichever backend is free — a prepared
statement made on one connection is absent on the next, and queries fail
intermittently under load rather than immediately in development.

Both are DBAPI arguments and belong in `connect_args`. Passing
`prepared_statement_cache_size` directly to `create_async_engine()` raises
`TypeError: Invalid argument(s) sent to create_engine()`.

### Migrations

**`alembic/CLAUDE.md` owns this** — the schema filters that stop autogenerate
dropping `auth.users`, what autogenerate does not emit, the revision chain, and
the rules for `versions/`. Read it before touching anything under `alembic/`.

The two that matter from out here:

- **Alembic is the single source of truth for the schema.** Never change the
  schema in the Supabase dashboard; it bypasses Alembic silently and surfaces
  weeks later as an unrelated failed migration. `db/*.md` are design rationale,
  not truth.
- **Import every new model in `alembic/env.py`.** A model no import reaches is
  absent from `Base.metadata`, and autogenerate will write a migration
  *dropping* the table it cannot see.

### Never put a connection string or service-role key in `frontend/`

They belong to this service's environment. A variable added there is one typo
away from a `NEXT_PUBLIC_` prefix and the client bundle.

## The frontend contract

The two halves communicate over HTTP and share no code. What each side may
assume about the other:

**`frontend/` does not query the database.** No ORM, no connection pool, no
connection string, no schema, no migrations. Drizzle used to live in
`frontend/src/db/` and was removed when the API moved to Python. A query
someone is tempted to write in a React component belongs in an endpoint here.

**A screen's `data.ts` is the seam.** Each screen holds fixture data in a
sibling `data.ts` today, and that file becomes the fetch once the endpoint
exists — so `page.tsx` is untouched either way. Design endpoints against those
fixture shapes; they are the closest thing to a agreed contract that exists.

**The app must keep running without this service.** Every screen renders its
`data.ts` fixture, so a clone with no environment file still boots. On this
side, `/health` and every fixture route work without the root `.env`; only
`/health/db` needs it. Keep both true — it is what lets someone work on one
half without the other, and it makes a failure point at one side or the other
instead of being ambiguous.

**Schema changes through the Supabase dashboard are banned.** A UI edit bypasses
Alembic silently and surfaces weeks later as an unrelated failed migration.
Revoke dashboard write access if the plan allows it.

## Conventions

**Routes are `async def`.** Mixing sync and async arbitrarily invites blocking
work inside an async route, which stalls the event loop for every request.

**One session per request**, through the `get_session` dependency in
`app/db.py`. Sharing a session across requests shares a transaction, and
concurrent requests then see each other's uncommitted writes.

**Prefer SQLAlchemy Core for queries**, and the ORM where object graphs help.
The search endpoints have many optional filters, which Core composes cleanly;
the ORM's lazy loading is a trap in async code — load relationships explicitly
with `selectinload()` or you will meet `MissingGreenlet`.

**SQLAlchemy models and Pydantic schemas are separate layers.** Models describe
database rows, Pydantic describes request and response shapes. Do not collapse
them — the first time an internal column must not be exposed, you will regret
it.

**Comments explain why, not what.** This matches the density of the frontend
and of the Drizzle layer this replaced. A non-obvious setting gets a sentence
on what breaks without it.

**The app must start with no credentials.** `/health` and every fixture route
work without the root `.env`; only `/health/db` needs it. Keep that true — it is what
lets someone work on routes without database access, and it makes a failure
point at one half or the other.

## Auth — this API owns identity end to end

**Decided: FastAPI issues the session token.** Supabase is managed Postgres and
nothing else. There is no Supabase Auth in the picture, so nothing references
`auth.users`, there is no JWKS fetch, and there is no second service in the
sign-in path.

**This does not make `alembic/env.py`'s schema filters unnecessary.** A Supabase
project provisions `auth`, `storage`, `realtime` and the rest whether or not we
use them, so autogenerate would still propose dropping them. Not using Supabase
Auth means we never *reference* `auth.users`; it does not mean the table is
gone. Leave the filters alone.

This was an open question for a long time and the alternative was real —
Supabase Auth would have given us OAuth providers, email verification, password
reset and magic links for free. We chose one service owning identity instead:
simpler to reason about, simpler to test, and no sign-in outage when Supabase
has one. **The cost is that we now write all of that ourselves.** Budget for it
honestly rather than discovering it at the end.

What this API therefore owns, none of which exists yet:

- Password hashing and verification. Use a vetted KDF; do not invent one.
- Session token issuance and refresh.
- Email verification and password reset, which means a mail sender.
- Every OAuth callback, if social sign-in is wanted.

Three rules that hold regardless of how the above gets built:

- **Whoever acts on a token verifies its signature.** Never trust a decoded
  cookie or a client-supplied identity claim. Since we issue the tokens, this
  is our signing key and our verification dependency — one place, used by every
  protected route.
- **Authorization is Python, not row-level security.** SQLAlchemy connects as
  one privileged role, so RLS policies never fire. A policy written against
  this connection is dead code that reads as a security control. Every
  company-scoped endpoint checks for an active membership on the requested
  `company_id` before reading or writing; role checks are Python guards.
- **Never trust a client-supplied `company_id`, `profile_id` or role.** Derive
  identity from the verified token, then check access against it.

Still open, and smaller than it looks:

- **How the token travels.** Server Components calling this API server-side
  keeps it out of browser JavaScript and is the safest default. Client
  Components calling directly need CORS here. Next Route Handlers proxying is
  same-origin with one extra hop. Related: whether the two halves run on one
  origin or two, which drives CORS and cookie `SameSite`.
- **Whether to write RLS policies anyway as a backstop.** They cost little and
  catch a direct-connection mistake, but they are invisible to Alembic
  autogenerate and must be hand-written in migrations. Do not drift into
  `SET LOCAL ROLE` per transaction by half — it is transaction-scoped and
  fights connection pooling, leaking one request's identity into the next.

### Consequence for the schema

The account tables carry `email` with a unique constraint but **no credential
column** — nothing stores a password hash. Under this decision that is a gap to
close, not a design. `app/models/CLAUDE.md` records where it lands and the
ambiguity to resolve first: `email` is unique *per table*, so the same address
can exist in both `applicant_profiles` and `company_memberships`, and
"authenticate by email" has no single answer until that is settled.
