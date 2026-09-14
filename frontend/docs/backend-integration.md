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
migrations are all on that side. The working assumption is FastAPI; nothing in
`frontend/` depends on that choice.

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

Worth deciding explicitly, because the default is to decide it by accident.

If FastAPI connects with one privileged role — the normal SQLAlchemy or asyncpg
setup — **policies never fire** and authorization lives in Python. That is a
coherent choice and the common one.

The alternative is setting `request.jwt.claims` and `SET LOCAL ROLE` per
transaction so policies do apply. It works, it is what the deleted `rls.ts` did
in TypeScript, and it fights connection pooling: the settings are
transaction-scoped, so every pooled checkout has to re-establish them or leak
one request's identity into the next. Do not drift into this by half.

### 3. How FastAPI reaches Postgres

Direct connection (SQLAlchemy/asyncpg) or Supabase's PostgREST layer via
`supabase-py`. Direct is the usual FastAPI answer and needs no service-role
key. PostgREST needs one, and it is the option that makes RLS load-bearing
again — so this decision and the one above are the same decision wearing a
different hat.

### 4. How the token travels

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
`statement_cache_size=0`. The session pooler (5432) is the one for migrations
and DDL, which need a single serial conversation.

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
