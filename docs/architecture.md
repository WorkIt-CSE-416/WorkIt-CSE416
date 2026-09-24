# Architecture

A snapshot of how the two halves of WorkIt actually fit together today —
what calls what, which libraries are doing the real work, and what shape the
data is in on each side. This is a point-in-time picture, not a design doc:
`frontend/CLAUDE.md` and `backend/CLAUDE.md` own the rules and rationale,
`backend/db/*.md` own schema decisions. Update this file when the shape of
the system changes, not when a screen gets a new field.

## The two halves

```
  ┌───────────┐  HTML, sb-* cookies  ┌──────────────────────────┐  JSON + Bearer   ┌──────────────────────────┐
  │  Browser  │◀────────────────────▶│  Next.js app (frontend/)  │─────────────────▶│  FastAPI app (backend/)  │
  └───────────┘                      │  App Router · :3000       │                  │  Uvicorn · :8000          │
                                     └──────────────────────────┘                  └──────────────────────────┘
                                                  │ sign in, refresh                    │ admin API    │ asyncpg
                                                  ▼                                     ▼ (signup),    ▼
                                     ┌──────────────────────────┐◀──────────────────── JWKS  ┌──────────────────────┐
                                     │  Supabase Auth            │──── auth.users ──────────▶ │  Postgres (Supabase)  │
                                     └──────────────────────────┘                            └──────────────────────┘
```

Two self-contained projects, each with its own dependency tree, that talk
over HTTP and share no code (`../CLAUDE.md`). The backend is the only thing
that queries Postgres, directly over `asyncpg` — no PostgREST. **Supabase
Auth** owns credentials and sessions: it stores users in `auth.users`,
issues access/refresh tokens, and the API only verifies them
(`backend/CLAUDE.md`'s Auth section).

**How a request reaches the API today:** Next Server Actions call it
server-side (`frontend/src/lib/auth.ts`), never a Client Component — so the
diagram's left arrow is a Node process calling a Python process directly,
not the browser calling it. That's why there's no CORS configuration on the
FastAPI side yet: the browser never talks to `:8000` directly. The browser
holds Supabase's `sb-*` session cookies on the Next origin; Next reads the
access token out of the session and forwards it as `Authorization: Bearer`.

## Backend (`backend/`)

FastAPI · SQLAlchemy 2.0 (async) · Alembic · Postgres via `asyncpg`. Routes
are `async def`; one DB session per request via `get_session`
(`app/db.py`).

### Clients / libraries doing the real work

| Concern | Library | Notes |
| --- | --- | --- |
| HTTP framework | `fastapi` | Routers under `app/routers/` |
| ASGI server | `uvicorn[standard]` | `uv run uvicorn app.main:app` |
| DB driver | `asyncpg` | Never `psycopg`; async end to end |
| ORM / Core | `sqlalchemy[asyncio]` | `NullPool` — Supavisor already pools |
| Migrations | `alembic` | `backend/alembic/`, schema filtered to `public` |
| Settings | `pydantic-settings` | Reads root `.env`; `DATABASE_URL` (app, pooled) vs `DIRECT_URL` (Alembic, session pooler) |
| Token verification | `pyjwt[crypto]` | `app/security.py` — Supabase JWKS (ES256/RS256), or legacy HS256 secret |
| Supabase admin + Storage | `supabase` | `get_supabase()` — signup's `create_user`, resume uploads |
| Email validation | `email-validator` | Backs Pydantic's `EmailStr` |

### API surface

Everything under `/auth` lives in `app/routers/auth.py`. This is the entire
routed API today — no other domain (jobs, applications, resumes) has an
endpoint yet, even though some of them have models (see Data layer below).

| Method | Path | Auth | Request | Response |
| --- | --- | --- | --- | --- |
| GET | `/health` | none | — | `{status}` — liveness, works with no `.env` |
| GET | `/health/db` | none | — | `{status, database}` or 503 — needs `.env` |
| POST | `/auth/signup` | none | `SignupRequest` | `201` + `AuthenticatedAccount`, or `409`/`422`/`501`/`502` |
| GET | `/auth/me` | Bearer token | — | `200` + `AuthenticatedAccount`, or `401` |

- `SignupRequest` — `accountType` (`applicant`\|`company`), `name`, `email`,
  `password`. The API creates the Supabase auth user (admin API,
  `app_metadata.account_type`, already confirmed) and the profile row with
  the same id. Company accounts get `501`: `company_profiles` has two
  `NOT NULL` columns (`company_name`, `size_range`) nothing collects yet.
- There is no login endpoint. The Next server signs in against Supabase Auth
  directly and calls `/auth/me` with the resulting access token.
- `AuthenticatedAccount` — `id`, `email`, `full_name`, `account_type`,
  `onboarding_completed` (bool, not the raw timestamp), `company_id`
  (`null` for an applicant). No token in any response body.
- `get_current_account` (`app/deps.py`) is the one place a token becomes an
  identity: verify signature, audience, issuer and expiry; read `sub` and
  `app_metadata.account_type`; load the profile row. Every protected route
  is meant to depend on this rather than trusting anything client-supplied.

### Data layer

Three states a table can be in right now: migrated and reachable through
`/auth` (real), modeled but not yet migrated (defined, dormant), or not
modeled at all (doesn't exist as code).

| Table | Model | Migrated? | Reachable via API? |
| --- | --- | --- | --- |
| `applicant_profiles` | `app/models/profiles.py` | Yes | Yes — signup, me. `id` → `auth.users.id` |
| `company_profiles` | `app/models/profiles.py` | Yes | No — no company signup yet |
| `company_memberships` | `app/models/profiles.py` | Yes | `/auth/me`, for an account created some other way. `id` → `auth.users.id` |
| `auth.users` | `app/models/auth_users.py` (stub) | Owned by Supabase | Only as the account tables' FK target |
| `resumes` | `app/models/resume.py` | Yes | No — no resume endpoint exists yet |
| `job_postings` | `app/models/jobs.py` | **No** | No |
| `countries` / `states` | `app/models/locations.py` | **No** | No |

`app/models/__init__.py` auto-imports every module in the folder via
`pkgutil`, so a new model file registers itself with `Base.metadata` without
being listed anywhere — `alembic check` is what would catch a model added
without its migration (it currently reports exactly the two "No"s above as
pending, which is expected, not a bug).

**Wire vs. row shape:** Pydantic schemas (`app/schemas/`) and SQLAlchemy
models (`app/models/`) are deliberately separate layers — a schema decides
what a request/response looks like on the wire, a model decides what a
Postgres row looks like, and the translation between them (aliasing
`name` → `full_name`) happens by hand in
each router function. Nothing auto-derives one from the other.

## Frontend (`frontend/`)

Next.js 16 (App Router, Turbopack) · React 19 · TypeScript · Tailwind v4.

### Clients / libraries doing the real work

| Concern | Library | Notes |
| --- | --- | --- |
| Framework | `next` | App Router, Server Components + Server Actions |
| UI primitives | `@base-ui/react` | Headless components under `src/components/shadcn/` |
| Data table | `@tanstack/react-table` (**v9**) | Company list screens; v8 examples online don't apply |
| Charts | `recharts` | Company dashboard stat tiles/trends |
| Class merging | `clsx` + `tailwind-merge` (via `cn()`) | `src/lib/cn.ts` — every dynamic className goes through this |
| Dates | `date-fns`, `react-day-picker` | Composer/calendar UI |
| Icons | `lucide-react` | Vendored shadcn components only |
| Server-only guard | `server-only` | Marks `src/lib/auth.ts` as never bundled to the client |
| Auth session | `@supabase/ssr`, `@supabase/supabase-js` | `src/lib/supabase/server.ts`, `src/proxy.ts` — sign-in, cookies, refresh |

### How a screen gets its data today

Almost every screen still renders from a fixture, not a live call:

```
page.tsx  →  imports ./data.ts  →  hand-written TypeScript literals
```

That's true for `(seeker)/jobs`, `/applications`, `/profile`, `/search`,
`company/*`, `onboarding/applicant`, and `design-kit`. `frontend/CLAUDE.md`
calls this "the seam" on purpose — a screen's `data.ts` is meant to become
the real fetch later without `page.tsx` itself changing shape.

**The one exception is auth.** `/signup` and `/login` are wired to the real
API (see Auth flow) — no `data.ts`, no fixture, an actual `fetch()` through
`src/lib/auth.ts` on every submit.

### Current fixture data types (frontend-only, not backed by any endpoint)

A sample of what's flowing through the UI as static data right now — real
TypeScript shapes, zero persistence behind them:

| Screen | Key types (from that screen's `data.ts`) |
| --- | --- |
| `(seeker)/jobs` | `JobType`, `ExperienceLevel`, `WorkStyle`, `SalaryPeriod`, `JobPostStatus`, `Recommendation`, `Highlight` |
| `(seeker)/applications` | `Application`, `Column`, `Stage`, `StagedApplication` |
| `company/jobs` | `JobStatus`, `Posting` |
| `company/applicants`, `company/audit-logs`, `company/profile` | Their own local fixture shapes, same pattern |

Most of these already line up with `backend/app/models/dto.py`'s enums
backing `job_postings` — `JobType`, `WorkStyle`, `SalaryPeriod`,
`JobPostStatus` match their backend counterparts value-for-value.
`ExperienceLevel` doesn't: the frontend's third value is `"experienced"`,
the backend's is `"other"`. `job_postings` isn't migrated or exposed yet
(see Data layer above), so none of this is actually connected — it's
coincidental alignment (and one drift) between two hand-written shapes, not
a shared contract.

### Auth flow — the one real end-to-end path

```
Browser          Next server (:3000)             Supabase Auth          FastAPI (:8000)
  │ submit /signup  │                                  │                       │
  │────────────────▶│ apiFetch("/auth/signup") ────────┼──────────────────────▶│
  │                 │                                  │◀─ admin.create_user ──│
  │                 │                                  │   (app_metadata)      │ INSERT profile
  │                 │◀──────────────────────────────── 201 ────────────────────│ (id = auth id)
  │                 │ signInWithPassword() ───────────▶│                       │
  │                 │◀── session (set as sb-* cookies) │                       │
  │◀─ redirect ─────│                                  │                       │

  │ submit /login   │ signInWithPassword() ───────────▶│                       │
  │                 │◀── session                       │                       │
  │                 │ apiFetch("/auth/me", Bearer) ────┼──────────────────────▶│ verify via JWKS
  │                 │◀──────────────────── account ────┼───────────────────────│ load profile
  │◀─ redirect ─────│ (wrong account type → signOut, same error as bad password)
```

- Applicant accounts only end to end. Company signup round-trips to the same
  endpoint and shows whatever the API says back (currently `501`).
- `src/proxy.ts` refreshes the Supabase session on every request; it is not
  an auth guard.
- `signup-form.tsx` / `login-form.tsx` are Client Components (`useActionState`)
  so a rejected request shows inline instead of failing silently —
  everything else on these two pages stays server-rendered.

## What's real vs. what's scaffolding, right now

- **Real, persisted, reachable:** applicant signup, applicant login,
  token verification (`/auth/me`), company login (for an auth user and
  membership row created some other way — there's no company signup path
  yet), all through Supabase Auth.
- **Modeled but dormant:** resumes, job postings, countries/states — tables
  and SQLAlchemy models exist, no migration, no endpoint, no UI wired to
  them.
- **Fixture-only:** every non-auth screen in the app — job search,
  applications board, company dashboard, profiles, onboarding. Real-looking
  UI over hand-written data, by design, until each screen's endpoint lands.
