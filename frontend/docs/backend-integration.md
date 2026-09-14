# Backend integration

How the Next.js app reaches data, what is settled, and what is still an open
decision. Read this before writing an API call, touching auth, or starting the
Python service.

## What is settled

**Postgres is hosted on Supabase.** That is not in question.

**`frontend/` does not query it.** No ORM, no connection pool, no connection
string, no schema, no migrations. Drizzle used to live in `src/db/` and was
removed when the API moved to Python. A query you are tempted to write in a
React component belongs in an endpoint.

**The Python service owns the database.** Connection string, schema and
migrations are all on that side. Nothing in `frontend/` depends on how it is
built.

**The backend stack is FastAPI + SQLAlchemy 2.0 (async) + Alembic**, connecting
to Postgres directly over asyncpg. Not `supabase-py`/PostgREST: the job search
needs ltree containment and trigram ranking, which PostgREST's filter syntax
expresses badly, and there is no reason to put an HTTP hop between two services
that already trust each other. See "Schema and migrations" below.

**A screen's `data.ts` is the seam.** It holds fixture data today and becomes
the fetch when the endpoint exists, so `page.tsx` is untouched either way.

## What is NOT settled

Auth has never been implemented here. `src/app/login/actions.ts` is a stub that
exists only so the form POSTs, and `src/lib/supabase/server.ts` — which can
build a request-scoped Supabase client — **is currently called by nothing.**
The seam is open, and the decisions below are genuinely open with it.

Do not read the presence of `@supabase/ssr` in `package.json` as a decision. It
is leftover scaffolding from the Drizzle layer, kept because it is cheap to
keep and expensive to rebuild if we want it.

### 1. Who issues the session token

Everything else hangs off this one.

**Option A — Supabase Auth issues it.** The browser holds a Supabase session;
the frontend forwards the access token to FastAPI, which validates it.

- You get OAuth providers, email verification, password reset and magic links
  without writing them. That is weeks of real work.
- FastAPI validates but never issues, so it needs no user table, no password
  hashing and no mail sender.
- Cost: two services in the auth path, and a Supabase outage is a sign-in
  outage.

**Option B — FastAPI issues it.** Supabase collapses to managed Postgres and
nothing else.

- One service owns identity end to end. Simpler to reason about, simpler to
  test, no JWKS fetch on the API side.
- Cost: you now own hashing, reset flows, verification mail and every OAuth
  callback. Budget for it honestly.
- `src/lib/supabase/server.ts`, both `NEXT_PUBLIC_SUPABASE_*` variables and
  both `@supabase/*` dependencies get deleted.

Neither is wrong. Pick deliberately and record the choice here.

### 2. Whether row-level security stays a boundary

Mostly decided by the stack choice, but ratify it rather than inheriting it.
SQLAlchemy connects with one privileged role, so **policies never fire** and
authorization lives in Python. That is the common arrangement and the one to
plan for.

The alternative is setting `request.jwt.claims` and `SET LOCAL ROLE` per
transaction so policies do apply. It works, it is what the deleted `rls.ts` did
in TypeScript, and it fights connection pooling: the settings are
transaction-scoped, so every pooled checkout has to re-establish them or leak
one request's identity into the next. Do not drift into this by half.

What is genuinely open: whether to write policies anyway as a backstop. They
cost little and catch a direct-connection mistake, but they are invisible to
Alembic autogenerate and have to be hand-written in migrations.

### 3. How the token travels

Three shapes, if there is a token at all:

- **Server Components hold it.** They call FastAPI server-side; the token never
  reaches browser JavaScript. Safest, and the reason `src/lib/supabase/server.ts`
  is a server module.
- **Client Components call FastAPI directly.** Needs the token in the browser
  and CORS configured on the API.
- **Next Route Handlers proxy.** Same-origin from the browser's view, token
  stays server-side, one extra hop.

Related: whether the two run on one origin or two. That drives CORS, cookie
`SameSite`, and whether a proxy is worth it.

## Schema and migrations

Alembic owns the schema. Once the first migration exists,
`backend/db/job_posting.md` is a design rationale doc, not a source of truth —
there must be exactly one of those.

**Schema changes through the Supabase dashboard are banned.** A UI edit bypasses
Alembic silently and surfaces weeks later as an unrelated failed migration.
Revoke dashboard write access if the plan allows it.

Four things that are much cheaper to set up now than to retrofit:

- **Filter Supabase's internal schemas in `env.py` before the first revision.**
  Autogenerate against a Supabase database will otherwise produce a migration
  dropping `auth.users`, `storage.objects`, and everything in `realtime`,
  `vault` and `graphql`. Set `include_schemas=False` plus an `include_object`
  hook that rejects anything outside `public`. This is the standard way teams
  break a Supabase project with Alembic.
- **Fail CI on multiple heads.** Two branches off one revision, each adding a
  migration, gives two heads and `alembic upgrade head` then fails for
  everyone. Run `alembic heads` and fail if it returns more than one. The
  `down_revision` git conflict this produces is a feature — resolve it by
  re-parenting the revision, never by picking a side.
- **Fail CI on model drift.** `alembic check` catches a model change with no
  matching migration, which is the defect that otherwise detonates in a
  teammate's environment rather than the author's.
- **Decide the session pattern once.** Session-per-request as a FastAPI
  dependency, written down. Async SQLAlchemy punishes improvisation: a
  relationship lazily loaded outside its session raises `MissingGreenlet`,
  intermittently.

Expect autogenerate to cover roughly two thirds of this schema. It does not
emit `CREATE EXTENSION`, new enum values, index operator classes like
`gin_trgm_ops`, or anything ltree — all of which this design uses. Hand-write
those with `op.execute()` and review every generated migration.

Note that enum values are a schema change: `ALTER TYPE ... ADD VALUE` does not
roll back cleanly. That is the right trade for fixed domains like `job_type`
and `work_style`. For anything expected to grow with the product, a lookup
table costs a join and saves a coordinated deploy.

## Constraints that hold either way

**No database credentials in `frontend/`.** No connection string, no
service-role key. A variable added here is one typo away from a `NEXT_PUBLIC_`
prefix and the client bundle. They belong to the Python service's environment.

**Whoever acts on a token verifies its signature.** Never trust a decoded
cookie. If Supabase issues the token, check which signing scheme your project
uses before writing the FastAPI dependency — newer projects sign
asymmetrically and publish a JWKS endpoint, legacy ones use a shared HS256
secret, and they are different code paths.

**Mind the pooler port.** Supabase's transaction pooler (6543) hands each
statement to whichever backend is free, so prepared statements break under
load — intermittently, not cleanly. The deleted `src/db/client.ts` set
`prepare: false` for exactly this; the asyncpg equivalent is
`statement_cache_size=0` in `connect_args`. Pair it with `NullPool` —
Supavisor is already the pool, and SQLAlchemy pooling on top of it causes its
own trouble. Point Alembic at the session pooler (5432) instead: DDL needs a
single serial conversation.

**The app must keep running without any of it.** Every screen renders the
fixture data in its `data.ts`, so a clone with no `.env.local` still boots.
Keep that true — it is what makes the frontend workable while the API is
half-built.

## Frontend setup today

Only needed once something reads a real session. Copy `.env.example` to
`.env.local` and fill in two values from the Supabase dashboard (Project
Settings → API):

| Variable                        | What it is               |
| ------------------------------- | ------------------------ |
| `NEXT_PUBLIC_SUPABASE_URL`      | The project URL          |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | The publishable anon key |

Both are `NEXT_PUBLIC_` deliberately: the anon key is designed to ship to the
browser.

If Option A is chosen, `src/lib/supabase/server.ts` builds the per-request
client and two rules apply to it:

- **`getClaims()`, never `getSession()`, when the answer decides anything.**
  `@supabase/auth-js` says a user object read from cookies "must not be
  trusted" — a cookie is client-controlled. `getClaims()` verifies the
  signature. `getSession()` is fine for "render the signed-out header" and
  wrong for anything that grants access.
- **Never cache the client.** Supabase requires a fresh one per render; the
  cookie jar it closes over belongs to one request.

If Option B is chosen, that file and this section go away together.
