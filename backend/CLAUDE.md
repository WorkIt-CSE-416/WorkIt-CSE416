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

**Never run `alembic init` again.** It overwrites `alembic/env.py` with the
stock template, which discards the schema filters described below and restores
a version that proposes dropping `auth.users`.

## Layout

```
app/
  main.py         FastAPI app. /health (liveness) and /health/db (readiness)
  config.py       pydantic-settings; also rewrites URLs to postgresql+asyncpg
  db.py           Async engine, session factory, declarative Base
alembic/
  env.py          Migration environment — READ ITS HEADER before editing
  versions/       Migrations. Empty until the first model exists
  script.py.mako  Template for generated migrations
alembic.ini       Alembic config. Deliberately holds no database URL
db/
  job_posting.md  Schema design notes — rationale, NOT a source of truth
pyproject.toml    Dependencies, and the pinned Python series
uv.lock           Exact resolved versions — committed
```

Models will go in `app/models/`, routers in `app/routers/`. Neither exists yet.

## Current state

**There are no tables, no models and no migrations.** The schema is still being
designed and the wiring landed first on purpose. `alembic revision
--autogenerate` correctly produces an empty migration — that is the expected
output, not a broken setup.

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

### Why alembic/env.py filters schemas

`include_name` and `include_object` restrict Alembic to `public`. Alembic treats
anything present in the database but absent from `Base.metadata` as something to
DROP, and Supabase's own tables are exactly that. Verified against a database
holding `auth.users` and `storage.objects`:

```
with the filters:     pass                                    (empty migration)
without the filters:  op.drop_table('objects', schema='storage')
                      op.drop_table('users', schema='auth')
```

Two filters rather than one: `include_name` stops reflection descending into a
foreign schema, `include_object` catches what gets through and keeps working if
someone sets `include_schemas=True`.

### Rules that are not negotiable

- **Never add `sqlalchemy.url` to `alembic.ini`.** That file is committed; the
  password is not. `env.py` reads `DIRECT_URL` through `app.config`.
- **Never change the schema in the Supabase dashboard.** It bypasses Alembic
  silently and surfaces weeks later as an unrelated failed migration. Alembic
  is the single source of truth.
- **Import every new model in `alembic/env.py`.** A model no import reaches is
  absent from `Base.metadata`, and autogenerate will write a migration
  *dropping* the table it cannot see.
- **Read every generated migration before applying it.** Autogenerate does not
  emit `CREATE EXTENSION`, new enum values, index operator classes such as
  `gin_trgm_ops`, or anything `ltree` — and the planned schema uses all four.
  Expect it to cover roughly two thirds and hand-write the rest with
  `op.execute()`.
- **Never put a connection string or service-role key in `frontend/`.**

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

## Open decisions

`../frontend/docs/backend-integration.md` records what is settled and what is
not. Unresolved as of now: **who issues the session token** — Supabase Auth or
this API — and how that token travels. Do not write code or docs that assume a
winner.

Row-level security is effectively decided by the stack: SQLAlchemy connects as
one privileged role, so policies do not fire and authorization lives in Python.
