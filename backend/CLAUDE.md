# CLAUDE.md — backend

Guidance for Claude Code when working in `backend/`. Repo-wide rules — branch
names, the documentation split, the review skill — live in the root
`../CLAUDE.md`, which is always loaded alongside this one. This file is the
Python API.

## Where this folder sits

`backend/` is the whole Python project: its own `pyproject.toml`, `.venv`,
lockfile and tooling. Nothing above it is part of this build, and nothing in
`frontend/` is importable from here. The two halves communicate over HTTP and
share no code. The scraper is no exception: `GET /jobs` reads
`scraper/feed.json` (or the committed `data/feed.json` snapshot) as data and
imports none of its code.

**This folder owns the database.** Connection strings, schema and migrations
all live on this side. The Next.js app holds no ORM and no credentials.

## Stack

FastAPI · Uvicorn · SQLAlchemy 2.0 (async, over asyncpg) · Alembic ·
pydantic-settings · supabase-py (Storage, Auth admin) · PyJWT · Pillow
(profile-photo re-encoding). Python 3.12,
pinned by `requires-python = ">=3.12,<3.13"`.

Dependencies are managed by **uv**. `uv add <pkg>` to add one, `uv sync` to
install what the lock already names. Never `pip install` into the venv — it
writes nothing to `pyproject.toml` and the next `uv sync` silently undoes it.

**Not PostgREST, deliberately.** We connect to Postgres directly over asyncpg.
The job search needs ltree containment and trigram ranking, which PostgREST's
filter syntax expresses badly. `supabase-py` is installed for **Storage**
(file uploads) and the **Auth admin API** (creating users at signup) — never
for database queries, which still go through SQLAlchemy. `get_supabase()` in
`app/db.py` builds that one service-role client.

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

```
uv run pytest                                  run the tests in tests/
```

Tests cover the resume parser (`test_resume_parser.py`) and DOCX text
extraction (`test_resume_extraction.py`). A test that calls the resume routes
must monkeypatch `resumes.get_supabase`: the router calls it directly rather
than through `Depends`, so a dependency override misses it and the test
uploads to the real bucket. `tests/fixtures/*.txt` are extracted text
of real resumes, each in a layout that once broke parsing, cut to start at the
first section header so no contact details are committed. The heuristics
interact — a fix for one layout has broken another more than once — so when a
new resume parses wrong, add it as a fixture with its expected output in
`tests/test_resume_parser.py` before touching `app/utils/resume_parser.py`.

**Never run `alembic init` again** — it overwrites `alembic/env.py` and undoes
the schema filters. `alembic/CLAUDE.md` explains what that costs.

## Layout

```
app/
  main.py         FastAPI app. /health (liveness) and /health/db (readiness);
                  the 422 handler that keeps a non-finite number from a 500
  config.py       pydantic-settings; also rewrites URLs to postgresql+asyncpg
  db.py           Async engine, session factory, declarative Base, Supabase client
  security.py     Verifies Supabase access tokens against the project's JWKS
  deps.py         get_current_account — the dependency every protected route uses;
                  get_company_member on top of it for company-scoped routes
  schemas/        Pydantic request/response shapes, separate from models/
    auth.py       Signup body, /auth/me response
    jobs.py       JobListing — also the parser for scraper/feed.json
    company_jobs.py  JobPostingCreate and JobPosting, for /company/jobs
  routers/
    CLAUDE.md     Router conventions — read before adding a router
    auth.py       POST /auth/signup, GET /auth/me
    jobs.py       GET /jobs — the scraper's feed.json, public, no DB
    company_jobs.py  /company/jobs: create, list, load, update, pause and close a company's own jobs
    resumes.py    CRUD /applicants/{id}/resumes — upload, list, get, replace,
                  delete, set default, signed file link; extracts text from
                  PDF/DOCX and parses it into structured JSON
    avatars.py    GET/PUT/DELETE /applicants/{id}/avatar — profile photo
  services/       Logic with no HTTP or DB of its own. Never in models/,
                  whose __init__ imports every file as a model
    avatar.py     Validates and re-encodes an upload to a 512px WebP
  utils/
    resume_parser.py  Heuristic resume parser (raw text → ParsedResume)
  models/
    CLAUDE.md     Model invariants — read before adding or editing a model
    profiles.py   Account and company tables
    auth_users.py Stub of Supabase's auth.users, for foreign keys only
    jobs.py       Job postings, company-posted and scraped (NULL `company_id`),
                  and job_locations: one row per place a job is offered
    locations.py  Country and state reference tables
    resume.py     Resume storage and parsed JSONB
    dto.py        Enums and Pydantic schemas (ParsedResume, Education, etc.)
alembic/
  CLAUDE.md       Alembic decisions — read before editing anything here
  env.py          Migration environment
  versions/       Migrations. Committed — they are the schema's history
  script.py.mako  Template for generated migrations
tests/            pytest; resume parser and DOCX extraction tests, and fixtures
data/
  feed.json       Committed snapshot of scraper/feed.json — what GET /jobs
                  serves in production. See Deployment
alembic.ini       Alembic config. Deliberately holds no database URL
db/
  job_posting.md  Schema design notes — rationale, NOT a source of truth
  resume.md       Same, for resume storage and parsing
  avatar.md       Profile photo: formats, limits, storage, bucket setup
pyproject.toml    Dependencies, the pinned Python series, and Vercel's entrypoint
uv.lock           Exact resolved versions — committed
```

Routers live in `app/routers/`. See `app/routers/CLAUDE.md` for conventions.

## Current state

**The initial migration has landed.** `dee263a84adb_initial_schema.py` creates
all seven tables — `applicant_profiles`, `company_profiles`,
`company_memberships`, `resumes`, `countries`, `states`, `job_postings` — plus
nine enum types. It is the root of the chain (`down_revision` is `None`).

The shared Supabase project was **dropped and rebuilt from that migration on
2026-09-21**, after a migration was applied to it whose file was never
committed. That left `alembic_version` pointing at a revision nobody had, which
broke every Alembic command for the whole team. `alembic/CLAUDE.md` records the
incident and the rule that prevents it; read it before your first migration.

Location reference data (`countries`, `states`) is seeded by migrations, and
`job_postings` references it by ISO code. `app/models/CLAUDE.md` owns the
details: what is seeded and why, how the location columns and FKs are shaped,
and the settled design for the location resolver, which is not written yet.

Credentials live in Supabase's `auth.users`, not in these tables; the account
tables' `id` references it. See Auth below.

The recommended next step is Pydantic response schemas serving fixture data, so
the frontend can replace its `data.ts` fixtures with real calls while the
schema churns underneath. The API contract should be designed deliberately
rather than falling out of whatever the tables happen to look like.

CI (`.github/workflows/ci.yml`) runs `ruff check .` and `pytest` on every PR,
but nothing about migrations yet. Two gates are worth adding: `alembic heads`
failing when it returns more than one, and `alembic check` failing on model
drift. Both would have caught the 2026-09-21 breakage before it reached anyone
else.

## Deployment

This folder deploys to **Vercel as its own project** (Root Directory
`backend`), separate from the Next.js project, both from this repo. Merging
to `main` deploys production; every PR gets a preview URL. Chosen in KAN-146
over Render (free tier sleeps after 15 idle minutes and takes ~1 minute to
wake — sign-in looked broken), Railway (no real free tier), Fly.io (no free
tier) and Cloud Run (needs a card). Render with a Dockerfile is the fallback.

- **Entrypoint** is `[tool.vercel] entrypoint` in `pyproject.toml`; the whole
  app becomes one Vercel Function. Vercel installs from `uv.lock` itself.
- **Production env vars:** `DATABASE_URL`, `SUPABASE_URL`,
  `SUPABASE_SERVICE_KEY`. **Never `DIRECT_URL`:** migrations are run by
  hand, locally (`alembic/CLAUDE.md`); the deployed API has no business
  holding the migration connection.
- **`GET /jobs` serves `data/feed.json` in production.** A deploy ships only
  `backend/`, and `scraper/feed.json` is gitignored besides, so without the
  snapshot `/jobs` answered 503 and the seeker Jobs page showed nothing.
  `config.default_scraper_feed()` prefers `scraper/feed.json` when a local
  scraper run has written one and falls back to the snapshot otherwise; no
  env var is needed (`SCRAPER_FEED` still overrides both). Refresh it by
  running the scraper and copying its `feed.json` here, **in the same commit
  as any change to `schemas/jobs.py`** — a snapshot that no longer validates
  turns the 503 into a 500. `job_postings` can hold these rows since
  `b40588efa7b7` (NULL `company_id`, `app/models/CLAUDE.md`). Still open:
  an import that upserts the feed into it on `apply_url`, a scheduled run of
  scraper + import, and pointing `/jobs` at the table.
- **Still open: request bodies over 4.5 MB never arrive** — Vercel refuses
  them first. Uploads are still capped at 5 MB (`db/avatar.md`), so a
  4.5–5 MB upload fails on the deployment with a bare 413.
- **`NullPool` is what makes this safe** (see The database): every
  invocation opens one connection through Supavisor's transaction pooler,
  which does the pooling, so serverless scale-out cannot exhaust Postgres.

## The database

### Two connection strings, and the port is the only difference

| Variable              | Used by        | Why                                       |
| --------------------- | -------------- | ----------------------------------------- |
| `DATABASE_URL`        | The app        | Transaction pooler (port 6543)            |
| `DIRECT_URL`          | Alembic        | Session pooler (port 5432); DDL needs one session |
| `SUPABASE_URL`        | Storage, Auth  | Project URL; also where the JWKS lives    |
| `SUPABASE_SERVICE_KEY`| Storage, Auth  | Service-role key (not anon) — bypasses RLS, creates users |

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
`data.ts` fixture, so a clone with no environment file still boots. A screen
whose data has gone live renders a clear error instead of its fixture — never
the fixture in its place, which would pass made-up rows off as real. The Jobs
feed is the first (`frontend/src/app/(seeker)/jobs/listings.ts`). On this
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

## Auth — Supabase Auth issues tokens, this API authorizes

**Decided (2026-09-24): Supabase Auth owns credentials and sessions.** It
stores the password hash in `auth.users`, issues the access/refresh token pair,
and refreshes it. This API never hashes a password and never signs a token —
it only **verifies** Supabase's access token and decides what that account may
do. This replaced a working FastAPI implementation (Argon2id hashes on the
account tables, HS256 JWTs in a `session_token` cookie); that code is in git
history before this branch if it is ever needed again.

Why the switch: email verification, password reset, magic links and OAuth
providers come with Supabase Auth, and each would otherwise be ours to build
and get right. The cost is a second service in the sign-in path — a Supabase
Auth outage is a sign-in outage — and the one-account-per-email rule below.

### The flow

```
signup   Next action ──POST /auth/signup──▶ FastAPI ──admin API──▶ Supabase Auth
                                              │ creates auth.users row with
                                              │ app_metadata.account_type,
                                              │ then the profile row, same id
                                              │ (company: the company row and
                                              │ its owner's membership)
         Next action ──signInWithPassword──▶ Supabase Auth  (sets sb-* cookies)

login    Next action ──signInWithPassword──▶ Supabase Auth  (sets sb-* cookies)
         Next action ──GET /auth/me, Bearer──▶ FastAPI  (role check, redirect)

request  Browser ──sb-* cookie──▶ Next (src/proxy.ts refreshes the session)
         Server code ──Authorization: Bearer <access token>──▶ FastAPI
```

- **Signup goes through this API, not `supabase.auth.signUp()`.** The account
  type must land in `app_metadata`, which only the service-role key can write.
  `signUp()` can only set `user_metadata`, which the user can edit themselves
  — trusting it would let anyone make themselves a company account. Going
  through here also creates the profile row in the same request, so an
  `auth.users` row never exists without one. If the profile insert fails, the
  route deletes the auth user it just made.
- **The auth user comes first, the rows second.** The profile id *is* the
  `auth.users` id and a foreign key to it, so the rows cannot be written
  before Supabase answers. Everything from the first `db.add()` to the commit
  sits in one `try` whose `except` deletes that auth user — a flush left
  outside it would fail on a constraint and leave an auth user with no
  profile, whose email then 409s on every retry and signs in to nothing.
- **Create Company writes two rows in one transaction**: the
  `company_profiles` row, and a `company_memberships` row for the person
  signing up with role `owner`, status `active`. The body carries a nested
  `company` object (`CompanySignup` in `app/schemas/auth.py`);
  `SignupRequest`'s model validator requires it for a company and rejects it
  for an applicant, so the route never checks. Joining an existing company is
  not built.
- **Two Supabase dashboard settings back this up, and live nowhere in code.**
  The anon key and project URL ship to the browser, so anyone can call
  Supabase Auth directly and skip both the form and this API. Minimum
  password length is **8**, matching `SignupRequest.password` and the form's
  `PASSWORD_MIN_LENGTH`, so a signed-in user can't `updateUser()` their way to
  a shorter one — set this on any new Supabase project.

  Authentication → **"Allow new users to sign up" must be ON.** It reads as
  the opposite of what it should be — turning it off was the original plan,
  to refuse a direct `signUp()` and force account creation through this API
  (the service-role `admin.create_user` is unaffected either way) — but
  GoTrue applies that same switch to **every** path that creates a new
  `auth.users` row, OAuth included: a first-time Google/LinkedIn sign-in *is*
  a new signup from its side. Off, `signInWithOAuth()` fails with
  `access_denied` / `signup_disabled` ("Signups not allowed for this
  instance") before ever reaching this API — the OAuth section below depends
  on this being on. It stopped being a real guard the day
  `/auth/oauth/account-type` shipped: that endpoint already lets any
  authenticated, type-less identity self-report `account_type` the same way
  the signup form's body always has (trusted at the same level, never
  escalated afterward — `user_metadata` still isn't). A bare `signUp()` just
  reaches that same self-service step through a different front door, and a
  type-less account can't do anything protected regardless
  (`get_current_account` 401s it). Turning this on does not reopen the
  privilege the original setting was guarding.
- **Login does not touch this API's database code for the password.** Supabase
  Auth checks it against `auth.users`. The Next action then calls `/auth/me`
  to learn the account type and onboarding state.
- **Signup creates the user already confirmed** (`email_confirm=True`), which
  matches the behaviour before the switch. Turning on email verification means
  dropping that flag and adding a confirmation route on the frontend.

### How a token is verified — `app/security.py` and `app/deps.py`

`get_current_account` reads `Authorization: Bearer`, **never a cookie**:
Supabase's cookies belong to the Next origin, and are chunked and
base64-encoded besides. It then:

1. Verifies the signature. Projects on asymmetric signing keys are checked
   against the public JWKS at `{SUPABASE_URL}/auth/v1/.well-known/jwks.json`,
   fetched once and cached by `PyJWKClient` — no network call per request.
   Only ES256/RS256 are accepted. Supabase's legacy shared-secret HS256
   scheme is deliberately unsupported: that secret can mint tokens as well as
   verify them, so holding it here would let a leak forge any user. If the
   project is ever switched back to it, sign-in breaks with 401s — switch
   it back to signing keys (Project Settings → JWT Keys), don't add the
   secret here.
2. Checks `aud == "authenticated"`, the issuer, and expiry.
3. Reads `sub` (the `auth.users` id, which **is** the profile's primary key)
   and `app_metadata.account_type`, then loads the profile row. `company_id`
   and onboarding state come from that row, never from the token.

Never read `user_metadata` for anything that decides access.

### OAuth (Google, LinkedIn)

**Decided: Supabase Auth's native `google` and `linkedin_oidc` providers, with a
"Choose Account Type" step filling the gap signup() closes for a password
account.** `signInWithOAuth()` lets Supabase create the `auth.users` row
itself after the identity provider redirects back — it never goes through
this API, so `app_metadata.account_type` and the profile row are both
missing afterward, the same two things `/auth/signup` sets atomically for a
password account.

`GET /auth/oauth/status` and `POST /auth/oauth/account-type` close that gap,
both behind `get_verified_identity` (`app/deps.py`) rather than
`get_current_account` — the one dependency that verifies the token without
requiring a profile row to already exist, which is exactly the state a
first-time OAuth sign-in is in. `/oauth/account-type` sets
`app_metadata.account_type` through the same admin API `/auth/signup` uses,
then creates the profile row; on failure it resets `account_type` back to
`None` rather than deleting the auth user, since — unlike signup() — that
user's Google/LinkedIn session is real and didn't originate here.

Each provider needs its Client ID/Secret pasted into the Supabase dashboard
(Authentication → Providers) from the corresponding developer console —
Google Cloud Console for `google`, a LinkedIn Developer app with the
"Sign In with LinkedIn using OpenID Connect" product for `linkedin_oidc` (the
older `linkedin` provider is deprecated). Neither lives in code; both are
dashboard-only settings, same category as the minimum password length two
sections up.

**Needs "Allow new users to sign up" on** (two sections up) — without it,
`signInWithOAuth()` for a first-time identity fails with `access_denied` /
`signup_disabled` before any redirect back here, since GoTrue treats a new
Google/LinkedIn identity as a signup same as a password one.

### Identity rules

- **One email, one account.** `auth.users` holds an address once, so a person
  can no longer have both an applicant and a company account on the same
  email. Signup for a taken address is a 409 whichever type is asked for, and
  login for the wrong account type is rejected by the frontend after `/me`.
- **The profile id is the `auth.users` id.** Both account tables have
  `id REFERENCES auth.users(id) ON DELETE CASCADE`, so deleting a user in the
  Supabase dashboard deletes their profile. The id has no default: a profile
  row cannot be created without an auth user first.
- **`email` on the profile tables is a copy** for display and queries.
  `auth.users.email` is the one Supabase signs in with. Nothing changes an
  email yet; the day something does, it must update both.

### Rules that did not change

- **Whoever acts on a token verifies its signature.** One place —
  `get_current_account` — used by every protected route.
- **Authorization is Python, not row-level security.** SQLAlchemy connects as
  one privileged role, so RLS policies never fire, even though Supabase Auth
  now exists. A policy written against this connection is dead code that reads
  as a security control. Every company-scoped endpoint checks for an active
  membership on the requested `company_id`; role checks are Python guards.
- **RLS is enabled on every `public` table, with no policies**
  (`ce5b2e3f9b78`). That is a deny-all backstop for the `anon` and
  `authenticated` roles, which Supabase's Data API uses for the public anon
  key and for signed-in users. The Data API does not expose `public` either;
  the RLS is what still holds if someone turns it back on. Every new table
  enables RLS in its own migration — `alembic/CLAUDE.md` has the rule. Do
  not add policies to "open up" a table: this app has no path that reads
  through them, so data a screen needs goes through an endpoint here.
- **Never trust a client-supplied `company_id`, `profile_id` or role.** Derive
  identity from the verified token, then check access against it.
- **The Next proxy is not a security boundary.** It refreshes the session and
  may redirect for convenience; this API is reachable without going through
  Next, so every endpoint checks for itself.

### Configuration

`SUPABASE_URL` and `SUPABASE_SERVICE_KEY` (already used for Storage) are what
signup's admin call and JWKS verification need. There is no JWT secret —
`JWT_SECRET` from the old FastAPI auth is gone, and the legacy
`SUPABASE_JWT_SECRET` is not supported. **The service-role key never
goes to `frontend/`** — the frontend gets the anon key only.

### Still open

- Email verification and password reset: supported by Supabase, not wired up.
- Deleting an account cascades its rows but not its Storage objects
  (`Resume/<id>/`, `Avatar/<id>/`). Nothing cleans those up yet.
- Joining an existing company: no endpoint, and the form's Join tab is a
  placeholder.
- Every `IntegrityError` at signup answers "An account with this email already
  exists" — including a taken `company_profiles.contact_email`, where the
  sign-in email is fine. Tell them apart by constraint name in `exc.orig`.
- Nothing sets `onboarding_completed_at` for a membership, so `/auth/me`
  always reports a company account as not onboarded. The frontend routes
  around it (companies skip onboarding); whatever builds company onboarding
  must set it.
