# Drizzle + Supabase integration

**Date:** 2026-09-01
**Status:** Approved, ready for implementation plan
**Scope:** Database plumbing only. No domain tables, no auth flow, no screen rewiring.

## Goal

Give WorkIt a typed, migration-backed path to Postgres so the first feature
ticket can add a table and query it without making any infrastructure
decisions. Every screen keeps rendering its `data.ts` fixture; this ticket
changes nothing a user can see.

## Non-goals

These are named because each is a plausible misreading of "integrate Drizzle":

- **No domain schema.** No profiles, jobs, applications, or companies tables.
  `src/db/schema/` ships as an empty barrel.
- **No RLS policies.** Policies are written per table, so they land with the
  tables. The mechanism that makes policies apply does ship (see `rls.ts`).
- **No sign-in.** `src/app/login/actions.ts` states that real authentication
  lands with the auth ticket, and that the seeker/company guard belongs in a
  root `middleware.ts`. This ticket honours that boundary: it reads whatever
  session exists, and creates none.
- **No test runner.** The repo has none. Adding one is its own ticket, so
  verification here is the type checker, the linter, the build, and a live
  connection check.

## Decisions

### Driver: postgres.js, not supabase-js

Queries go through Drizzle over a real Postgres connection. Routing them
through `@supabase/supabase-js` would reduce Drizzle to a migration generator
and give up joins, transactions, and the relational query API — which is most
of the reason to adopt an ORM.

`@supabase/supabase-js` and `@supabase/ssr` are still dependencies, but only to
read the session. They are not the data path.

### Two connection strings

| Variable       | Target                        | Used by                   | Why                                                                                                                                          |
| -------------- | ----------------------------- | ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL` | Transaction pooler, port 6543 | Next.js at runtime        | Serverless invocations need a pooler. Supavisor's transaction mode has no prepared statements, so the client is built with `prepare: false`. |
| `DIRECT_URL`   | Session pooler, port 5432     | `drizzle-kit`, `db:check` | DDL and migration locks need a session-scoped connection. Running migrations through the transaction pooler is unreliable.                   |

Collapsing these into one variable is the most likely future regression: it
appears to work until a migration hangs or a prepared-statement error surfaces
under load.

### Two handles, one of them privileged

```
db.rls(tx => ...)   Opens a transaction, sets the verified JWT claims,
                    switches to the `authenticated` role, runs the callback.
                    RLS applies. This is what application code uses.

dbAdmin             Connects as `postgres`. Owns the tables, so it bypasses
                    RLS. Migrations, seeds, and admin scripts only.
```

`dbAdmin` bypassing RLS is not incidental — in Postgres a table's owner is
exempt from its own row policies unless `FORCE ROW LEVEL SECURITY` is set. That
same rule is why `rls.ts` works: after `SET LOCAL ROLE authenticated` the
session is no longer the owner, so policies bind.

Because a single stray import of `dbAdmin` in a route silently disables every
policy, it is guarded twice:

1. An ESLint `no-restricted-imports` rule confining `@/db/admin` to `src/db/**`
   and `scripts/**`. This mirrors the existing rule in `eslint.config.mjs` that
   keeps `Button`, `Badge`, and `Card` on their canonical paths. It uses
   `patterns` rather than `paths` so a relative `../../db/admin` is caught too.
2. `import "server-only"` in `src/db/index.ts`, the module application code
   imports, so the RLS path can never be pulled into a client bundle.

To make the ESLint rule expressible as a path, `dbAdmin` lives in its own
module, `src/db/admin.ts`, rather than being a second export of
`src/db/index.ts`.

**`server-only` deliberately does not go in `admin.ts`.** The package resolves
to a throwing module under every export condition except `react-server`, so a
plain Node process importing it crashes on purpose. `scripts/db-check.ts` runs
under `tsx`, not under Next's bundler, and it imports `dbAdmin` — putting
`server-only` there would break the one command that verifies the pipeline. The
guard is not weakened by this: `postgres.js` imports `node:net` and `node:tls`,
so any attempt to bundle this module for the browser already fails, and the
threat that actually matters — a _server_ file reaching for `dbAdmin` and
silently bypassing every policy — is one that `server-only` never caught.
ESLint is what catches that, and it covers `scripts/**` correctly by not
applying there.

### Two corrections to Drizzle's documented Supabase pattern

The pattern at <https://orm.drizzle.team/docs/rls> is the right shape, but its
example code has two problems this implementation fixes.

**1. SQL injection via claims.** The published snippet interpolates the token
into the statement text, in substance:

    select set_config('request.jwt.claims', '<raw JSON spliced in>', TRUE);

A single quote anywhere in a claim — an apostrophe in a name written to
`user_metadata` — terminates the literal early. Since `user_metadata` is
user-controlled, this is reachable. The fix is to bind the JSON as a parameter
rather than splicing it, so the value can never be parsed as SQL:

    sql`select set_config('request.jwt.claims', ${JSON.stringify(claims)}, true)`

`SET LOCAL ROLE` cannot be parameterized, so the role is checked against the
allowlist `["anon", "authenticated"]` and anything else is rejected rather than
passed through. `service_role` is deliberately not on that list: reaching it
would mean an RLS-scoped call had silently escalated to a privileged one.

**2. Unverified claims.** The snippet accepts a token decoded from cookies.
`@supabase/auth-js` states that a user object read from cookies "must not be
trusted" and directs callers to `getClaims()`, which verifies the JWT against
the project's asymmetric signing keys. `rls.ts` uses `getClaims()`. Trusting
unverified cookie contents here would let a forged cookie choose which rows
Postgres returns, defeating the point of RLS.

When there is no session, `getClaims()` returns no claims and the transaction
runs as `anon`. That is the correct anonymous behaviour, not an error.

### Verifying a pipeline that has no tables

Cutting the schema removes the obvious proof that any of this works: with no
tables, `db:generate` correctly emits nothing, and there is nothing to query.

The resolution does not require inventing a placeholder table.
`drizzle-orm/supabase` exports `authUsers`, a typed handle on Supabase's own
`auth.users`, which exists in every Supabase project. `npm run db:check` runs a
real Drizzle query against it and prints the row count.

That single command exercises env loading, `postgres.js`, the connection
string, credentials, and Drizzle's query builder — the entire chain this ticket
delivers — while owning no schema at all.

## Deliverables

```
drizzle.config.ts            dialect postgresql, out ./drizzle, DIRECT_URL,
                             entities.roles.provider "supabase",
                             casing "snake_case"
drizzle/                     generated SQL migrations, committed. Empty until
                             the first table exists.
src/db/
  client.ts                  postgres.js connections. Pooled (prepare: false)
                             and direct. Cached on globalThis so dev HMR does
                             not leak connections.
  rls.ts                     the transaction wrapper described above
  admin.ts                   dbAdmin, RLS-bypassing, ESLint-guarded
  index.ts                   db.rls(), the import application code uses
  schema/index.ts            empty barrel, with a comment on where tables go
src/lib/supabase/server.ts   per-request server client via @supabase/ssr
.env.example                 the four variables, documented
scripts/db-check.ts          the live connection check
docs/drizzle.md              the two connection strings, the two handles, and
                             how to add the first table
```

`src/db/schema/index.ts` is intentionally empty rather than absent:
`drizzle.config.ts` points at it, so its absence would break `db:generate` for
whoever adds the first table.

### Package changes

Runtime: `drizzle-orm`, `postgres`, `@supabase/supabase-js`, `@supabase/ssr`,
`server-only`.
Dev: `drizzle-kit`, `tsx`, `dotenv`.

`server-only` is a standalone package rather than something Next.js bundles; it
is what makes the `src/db/admin.ts` build-time guard work.

Versions are pinned to the majors verified during design: `drizzle-orm` 0.45.x,
`drizzle-kit` 0.31.x, `postgres` 3.4.x, `@supabase/ssr` 0.12.x.

### Environment variables

```
NEXT_PUBLIC_SUPABASE_URL        project URL, browser-visible
NEXT_PUBLIC_SUPABASE_ANON_KEY   anon key, browser-visible
DATABASE_URL                    transaction pooler, 6543
DIRECT_URL                      session pooler, 5432
```

`.env*` is already gitignored. `.env.example` is committed and carries no real
values.

### npm scripts

```
db:generate   drizzle-kit generate
db:migrate    drizzle-kit migrate
db:studio     drizzle-kit studio
db:check      tsx scripts/db-check.ts
```

Every one is a single binary invocation with no shell operators, satisfying the
cross-platform rule in `CLAUDE.md`. `db:push` is deliberately omitted: the team
chose generated migration files, and having `push` sitting in `package.json` is
how a schema silently diverges from its migration history.

`scripts/db-check.ts` imports by relative path rather than the `@/` alias, so it
does not depend on `tsx` resolving `tsconfig` path mappings.

## Data flow

```
Server Component / Server Action
  └─ db.rls(tx => tx.select()...)
       ├─ src/lib/supabase/server.ts  → getClaims()  (verifies the JWT)
       └─ postgres.js transaction on DATABASE_URL
            ├─ set_config('request.jwt.claims', <bound param>, true)
            ├─ SET LOCAL ROLE authenticated | anon   (allowlisted)
            └─ callback runs; policies apply; COMMIT resets the role

drizzle-kit / scripts
  └─ DIRECT_URL as `postgres` — owns the tables, bypasses RLS
```

## Error handling

- **Missing env var.** `src/db/client.ts` throws on import with a message
  naming the variable and pointing at `.env.example`. Failing at import beats a
  connection error at request time, where the cause is unclear.
- **Unrecognized JWT role.** `rls.ts` throws rather than passing the value to
  `SET LOCAL ROLE`.
- **No session.** Not an error. Runs as `anon`.
- **`getClaims()` fails** (expired or malformed token). Treated as no session:
  run as `anon`. A failed verification must never fall through to
  `authenticated`.

## Verification

1. `npm run db:check` prints a row count from `auth.users`.
2. `npm run db:generate` completes and emits no migration — the expected state
   with an empty schema. `docs/drizzle.md` says so explicitly.
3. `npm run typecheck`, `npm run lint`, `npm run format:check`, `npm run build`
   all pass.
4. Importing `@/db/admin` from a file under `src/app/` fails `npm run lint`.

Steps 1 and 2 need a provisioned Supabase project and a populated `.env.local`.
If credentials are not available when this is implemented, steps 3 and 4 still
run, and 1–2 are reported as blocked rather than assumed to pass.

## Follow-on tickets

1. **Auth** — sign-in, `middleware.ts`, the seeker/company guard, the browser
   Supabase client. Already anticipated by `src/app/login/actions.ts`.
2. **Schema** — the domain tables and their RLS policies, modelled from the
   `data.ts` fixtures. Deliberately deferred out of this ticket.
3. **Rewiring** — screens move off fixtures, one at a time.
