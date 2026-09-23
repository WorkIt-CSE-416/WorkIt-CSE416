# Architecture

A snapshot of how the two halves of WorkIt actually fit together today —
what calls what, which libraries are doing the real work, and what shape the
data is in on each side. This is a point-in-time picture, not a design doc:
`frontend/CLAUDE.md` and `backend/CLAUDE.md` own the rules and rationale,
`backend/db/*.md` own schema decisions. Update this file when the shape of
the system changes, not when a screen gets a new field.

## The two halves

```
┌─────────────────────────┐        HTTP, server-to-server        ┌──────────────────────────┐
│  Next.js app (frontend/) │ ────────────────────────────────────▶│  FastAPI app (backend/)  │
│  App Router · :3000      │◀──────────────────────────────────── │  Uvicorn · :8000          │
└─────────────────────────┘         JSON + Set-Cookie             └──────────────────────────┘
        ▲                                                                    │
        │ HTML / cookies                                                    │ asyncpg
        │                                                                    ▼
  ┌───────────┐                                                   ┌──────────────────────┐
  │  Browser  │                                                   │  Postgres (Supabase)  │
  └───────────┘                                                   └──────────────────────┘
```

Two self-contained projects, each with its own dependency tree, that talk
over HTTP and share no code (`../CLAUDE.md`). The backend is the only thing
that touches Postgres — Supabase is used as managed Postgres only, nothing
else. There is no Supabase Auth, no `auth.users`, no PostgREST; the API
connects directly over `asyncpg` and issues its own session tokens.

**How a request reaches the API today:** Next Server Actions call it
server-side (`frontend/src/lib/auth.ts`), never a Client Component — so the
diagram's left arrow is a Node process calling a Python process directly,
not the browser calling it. That's why there's no CORS configuration on the
FastAPI side yet: the browser never talks to `:8000` directly. See
"Auth flow" below for the one place this actually matters right now — the
API hands a session token back only via `Set-Cookie`, and a server-to-server
`fetch`'s `Set-Cookie` doesn't reach the browser on its own, so the Next
action re-sets it as its own cookie.

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
| Password hashing | `argon2-cffi` | `app/security.py` — argon2id, vetted KDF |
| Email validation | `email-validator` | Backs Pydantic's `EmailStr` |

### API surface

Everything under `/auth` lives in `app/routers/auth.py`. This is the entire
routed API today — no other domain (jobs, applications, resumes) has an
endpoint yet, even though some of them have models (see Data layer below).

| Method | Path | Auth | Request | Response |
| --- | --- | --- | --- | --- |
| GET | `/health` | none | — | `{status}` — liveness, works with no `.env` |
| GET | `/health/db` | none | — | `{status, database}` or 503 — needs `.env` |
| POST | `/auth/signup` | none | `SignupRequest` | `201` + `AuthenticatedAccount`, or `409`/`422`/`501` |
| POST | `/auth/login` | none | `LoginRequest` | `200` + `AuthenticatedAccount`, or `401` |
| GET | `/auth/me` | session cookie | — | `200` + `AuthenticatedAccount`, or `401` |

- `SignupRequest` — `accountType` (`applicant`\|`company`), `name`, `email`,
  `password`. Company accounts currently get `501`: `company_profiles` has
  two `NOT NULL` columns (`company_name`, `size_range`) nothing collects
  yet, and there's no `/onboarding/company` screen to send a new company
  account to (`backend/db/auth_methodology.md` §2 decision 4, open on
  purpose).
- `LoginRequest` — `accountType`, `email`, `password`. Works for either
  account type, since login only needs a row to already exist.
- `AuthenticatedAccount` — `id`, `email`, `full_name`, `account_type`,
  `onboarding_completed` (bool, not the raw timestamp), `company_id`
  (`null` for an applicant). **Never carries `password_hash`** — enforced by
  a runnable check in `app/schemas/auth.py` itself.
- The session token is never in a response body. It travels only as an
  httpOnly, `Secure`, `SameSite=lax` cookie (`session_token`), 30-day
  lifetime, hashed with SHA-256 before it touches the `sessions` table —
  the raw token exists only in the cookie and in the moment it's issued.
- `get_current_account` (`app/deps.py`) is the one place a cookie gets
  turned back into an identity: hash it, look up `sessions`, check
  `expires_at`, load the account it points at. Every protected route is
  meant to depend on this rather than trusting anything client-supplied.

### Data layer

Three states a table can be in right now: migrated and reachable through
`/auth` (real), modeled but not yet migrated (defined, dormant), or not
modeled at all (doesn't exist as code).

| Table | Model | Migrated? | Reachable via API? |
| --- | --- | --- | --- |
| `applicant_profiles` | `app/models/profiles.py` | Yes (`0fa8dcca3a06`) | Yes — signup, login, me |
| `company_profiles` | `app/models/profiles.py` | Yes | Only for an account that already exists (login) |
| `company_memberships` | `app/models/profiles.py` | Yes | Same as above |
| `sessions` | `app/models/sessions.py` | Yes | Written/read by every `/auth` route |
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
`name` → `full_name`, dropping `password_hash` entirely) happens by hand in
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
| **Dead** | `@supabase/ssr`, `@supabase/supabase-js` | Still installed, nothing calls them — see Auth flow |

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
Browser                Next server (:3000)              FastAPI (:8000)          Postgres
  │  submit /signup form   │                                  │                     │
  │────────────────────────▶ signup/actions.ts                │                     │
  │                        │  apiFetch("/auth/signup", …) ────▶ POST /auth/signup    │
  │                        │                                  │  hash_password()     │
  │                        │                                  │  INSERT profile ─────▶
  │                        │                                  │  INSERT session ─────▶
  │                        │                                  │◀── 201 + Set-Cookie ─│
  │                        │◀─ relaySessionCookie() re-sets   │                     │
  │                        │   token as Next's own cookie     │                     │
  │◀── redirect + cookie ──│                                  │                     │
```

- Applicant accounts only end to end. Company signup round-trips to the same
  endpoint and shows whatever the API says back (currently `501`).
- `signup-form.tsx` / `login-form.tsx` are Client Components (`useActionState`)
  so a rejected request (`409`/`401`/`422`/`501`) shows inline instead of
  failing silently — everything else on these two pages stays server-rendered.
- Nothing on the frontend calls `GET /auth/me` yet — no page currently needs
  to re-check "who is logged in" after the initial signup/login redirect.

## What's real vs. what's scaffolding, right now

- **Real, persisted, reachable:** applicant signup, applicant login,
  session verification (`/auth/me`), company login (for a row created some
  other way — there's no company signup path yet).
- **Modeled but dormant:** resumes, job postings, countries/states — tables
  and SQLAlchemy models exist, no migration, no endpoint, no UI wired to
  them.
- **Fixture-only:** every non-auth screen in the app — job search,
  applications board, company dashboard, profiles, onboarding. Real-looking
  UI over hand-written data, by design, until each screen's endpoint lands.
