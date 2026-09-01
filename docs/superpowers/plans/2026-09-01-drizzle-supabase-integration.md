# Drizzle + Supabase Integration Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire Drizzle ORM to Supabase Postgres so the next ticket can add a table and query it without making any infrastructure decisions.

**Architecture:** Two connection strings (transaction pooler for runtime, session pooler for migrations) feed two Drizzle handles: `db.rls()` runs inside a transaction that sets verified JWT claims and switches to the `authenticated` role so row-level security applies, and `dbAdmin` connects as the table owner and bypasses RLS for scripts. No domain tables ship — `src/db/schema/` is an empty barrel.

**Tech Stack:** Next.js 16 (App Router) · drizzle-orm 0.45 · drizzle-kit 0.31 · postgres.js 3.4 · @supabase/ssr 0.12 · tsx · dotenv 17

**Spec:** [2026-09-01-drizzle-supabase-integration-design.md](../specs/2026-09-01-drizzle-supabase-integration-design.md)

---

## A note on testing

**This plan has no TDD loop, and that is deliberate.** The repo has no test
runner, and the approved spec scopes adding one out of this ticket. More to the
point, nothing here is business logic — it is configuration, connection setup,
and one transaction wrapper. Its correctness is proven by connecting to a real
database, not by asserting against mocks.

So every task ends with a **runnable verification step and its expected
output** instead of a test. Do not skip them, and do not mark a task complete
on a step you did not actually run.

**Tasks 6 and 10 need real Supabase credentials.** If `.env.local` is not
populated when you reach them, stop and say so — report them blocked. Do not
claim they passed.

## File structure

| File                         | Responsibility                                                                                                       |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `drizzle.config.ts`          | drizzle-kit's entry point. Loads `.env.local`, points at the schema barrel, declares Supabase roles as pre-existing. |
| `src/db/client.ts`           | Owns both `postgres.js` connections and the env-var error messages. Nothing else opens a connection.                 |
| `src/db/schema/index.ts`     | The one file drizzle-kit reads for tables. Empty for now.                                                            |
| `src/db/admin.ts`            | `dbAdmin` — bypasses RLS. Isolated in its own module so ESLint can name it.                                          |
| `src/db/rls.ts`              | The transaction wrapper: verified claims in, role switched, callback run.                                            |
| `src/db/index.ts`            | The app-facing surface: `db.rls()`. Carries the `server-only` marker.                                                |
| `src/lib/supabase/server.ts` | Per-request Supabase client. Exists only to read the session.                                                        |
| `scripts/db-check.ts`        | Proves the whole chain against `auth.users`.                                                                         |
| `docs/drizzle.md`            | Why two connection strings, how to add the first table.                                                              |

---

### Task 1: Install dependencies

**Files:**

- Modify: `package.json`

- [ ] **Step 1: Install runtime dependencies**

```bash
npm install drizzle-orm postgres @supabase/supabase-js @supabase/ssr server-only
```

- [ ] **Step 2: Install dev dependencies**

```bash
npm install -D drizzle-kit tsx dotenv
```

- [ ] **Step 3: Verify the versions resolved as expected**

Run: `npm ls drizzle-orm drizzle-kit postgres @supabase/ssr`

Expected: `drizzle-orm@0.45.x`, `drizzle-kit@0.31.x`, `postgres@3.4.x`,
`@supabase/ssr@0.12.x`. If a major differs from these, stop — the code in this
plan was written against these majors and the APIs move between them.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add drizzle, postgres.js and supabase client dependencies"
```

---

### Task 2: Environment template

**Files:**

- Create: `.env.example`

`.env*` is already gitignored (`.gitignore` line: `.env*`), so `.env.local`
will not be committed. `.env.example` must be force-added past that rule.

- [ ] **Step 1: Create `.env.example`**

```bash
# Supabase project settings → API
NEXT_PUBLIC_SUPABASE_URL=https://your-project-ref.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key

# Supabase project settings → Database → Connection string
#
# DATABASE_URL is the TRANSACTION pooler (port 6543). Next.js uses it at
# runtime. Serverless invocations need a pooler, and Supavisor's transaction
# mode has no prepared statements, which is why src/db/client.ts sets
# `prepare: false`.
DATABASE_URL=postgresql://postgres.your-project-ref:PASSWORD@aws-0-region.pooler.supabase.com:6543/postgres

# DIRECT_URL is the SESSION pooler (port 5432). drizzle-kit and scripts use it.
# DDL and migration locks need a session-scoped connection; running migrations
# through the transaction pooler is unreliable.
DIRECT_URL=postgresql://postgres.your-project-ref:PASSWORD@aws-0-region.pooler.supabase.com:5432/postgres
```

- [ ] **Step 2: Create your own `.env.local`**

```bash
cp .env.example .env.local
```

Fill it in from the Supabase dashboard. Leave it empty if no project exists
yet — Tasks 3, 4, 5, 7, 8, and 9 all complete without it.

- [ ] **Step 3: Confirm `.env.local` is not tracked**

Run: `git status --porcelain .env.local`
Expected: no output. If it prints anything, stop and fix `.gitignore`.

- [ ] **Step 4: Commit**

```bash
git add -f .env.example
git commit -m "chore: document required database environment variables"
```

---

### Task 3: drizzle-kit config and the empty schema barrel

**Files:**

- Create: `drizzle.config.ts`
- Create: `src/db/schema/index.ts`
- Modify: `package.json`

- [ ] **Step 1: Create the schema barrel**

Create `src/db/schema/index.ts`:

```ts
/**
 * Every table WorkIt owns is exported from here.
 *
 * It is empty on purpose. The Drizzle integration deliberately shipped without
 * modelling any of the domain, so the first table lands with the ticket that
 * needs it. Until then `npm run db:generate` correctly produces no migration —
 * that is the expected output, not a broken setup.
 *
 * Add a table as its own file beside this one (`profiles.ts`, `jobs.ts`) and
 * re-export it here. drizzle.config.ts reads this file and nothing else, so a
 * table that is not exported from here is invisible to migrations.
 *
 * Row-level security policies belong on the table that they govern, declared
 * with `pgPolicy` in the same file. See docs/drizzle.md.
 */

export {};
```

- [ ] **Step 2: Create `drizzle.config.ts`**

```ts
import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";

// drizzle-kit runs outside Next.js, so nothing has loaded .env.local for us.
config({ path: ".env.local", quiet: true });

const url = process.env.DIRECT_URL;

if (!url) {
  throw new Error(
    "DIRECT_URL is not set. Copy .env.example to .env.local and fill it in — see docs/drizzle.md.",
  );
}

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema/index.ts",
  out: "./drizzle",
  // Write camelCase in TypeScript, get snake_case columns in Postgres.
  // src/db/*.ts pass the same option to drizzle() so both agree.
  casing: "snake_case",
  dbCredentials: { url },
  // anon, authenticated, service_role and postgres already exist in every
  // Supabase project. Without this, drizzle-kit would try to CREATE them.
  entities: { roles: { provider: "supabase" } },
  verbose: true,
  strict: true,
});
```

- [ ] **Step 3: Add the migration scripts to `package.json`**

Add to the `scripts` block, after `"clean"`:

```json
"db:generate": "drizzle-kit generate",
"db:migrate": "drizzle-kit migrate",
"db:studio": "drizzle-kit studio",
```

Do **not** add `db:push`. The team chose generated migration files; a `push`
script sitting in `package.json` is how a schema silently diverges from its
history.

- [ ] **Step 4: Verify the config parses**

Run: `npm run db:generate`

Expected with a populated `.env.local`: drizzle-kit reads the schema and
reports no tables — something like `No schema changes, nothing to migrate`.
No files appear in `drizzle/`. **This is correct.**

Expected with an empty `.env.local`: it throws the `DIRECT_URL is not set`
message above. That also proves the config loads; move on.

Anything else — a parse error, an unknown-option error — means the config is
wrong. Fix it before continuing.

- [ ] **Step 5: Commit**

```bash
git add drizzle.config.ts src/db/schema/index.ts package.json
git commit -m "feat: add drizzle-kit config and empty schema barrel"
```

---

### Task 4: The Postgres connections

**Files:**

- Create: `src/db/client.ts`

- [ ] **Step 1: Create `src/db/client.ts`**

```ts
import postgres from "postgres";

type Sql = ReturnType<typeof postgres>;

const HELP = "Copy .env.example to .env.local and fill it in — see docs/drizzle.md.";

function connectionString(name: "DATABASE_URL" | "DIRECT_URL"): string {
  const value = process.env[name];

  if (!value) {
    throw new Error(`${name} is not set. ${HELP}`);
  }

  return value;
}

/**
 * Connections are cached on globalThis because Next's dev server re-evaluates
 * modules on every edit. Without this, a morning of hot reloads leaves dozens
 * of pools open and Supabase starts refusing connections.
 */
const cache = globalThis as unknown as {
  workitPooled?: Sql;
  workitDirect?: Sql;
};

/**
 * The runtime connection: Supabase's transaction pooler on port 6543.
 *
 * `prepare: false` is not optional. Supavisor's transaction mode hands each
 * statement to whichever backend is free, so a prepared statement created on
 * one connection is not there on the next, and queries fail intermittently
 * under load rather than immediately in development.
 */
export function pooledClient(): Sql {
  if (!cache.workitPooled) {
    cache.workitPooled = postgres(connectionString("DATABASE_URL"), { prepare: false });
  }

  return cache.workitPooled;
}

/**
 * The migration and script connection: the session pooler on port 5432.
 *
 * `max: 1` because DDL takes locks and a migration should be one serial
 * conversation with the database, not several racing ones.
 */
export function directClient(): Sql {
  if (!cache.workitDirect) {
    cache.workitDirect = postgres(connectionString("DIRECT_URL"), { max: 1 });
  }

  return cache.workitDirect;
}
```

Both are functions rather than module-level constants on purpose: a constant
would read `process.env` at import time, so importing this module for one
connection would throw when the _other_ connection's variable is missing.

- [ ] **Step 2: Verify it type-checks**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/db/client.ts
git commit -m "feat: add pooled and direct postgres.js connections"
```

---

### Task 5: The admin handle and its ESLint guard

**Files:**

- Create: `src/db/admin.ts`
- Modify: `eslint.config.mjs:25-39` (the `src/**/*.{ts,tsx}` block)

- [ ] **Step 1: Create `src/db/admin.ts`**

```ts
import { drizzle } from "drizzle-orm/postgres-js";

import { directClient } from "./client";
import * as schema from "./schema";

/**
 * Connects as `postgres`, which OWNS every table and therefore BYPASSES ROW
 * LEVEL SECURITY. In Postgres a table's owner is exempt from its own policies
 * unless FORCE ROW LEVEL SECURITY is set, so every policy in this codebase is
 * invisible to this handle.
 *
 * That is the point — migrations and scripts need it — and it is also why
 * application code must never import it. Use `db.rls()` from "@/db" instead;
 * an ESLint rule enforces this outside src/db and scripts.
 *
 * Deliberately no `import "server-only"` here: that package throws under every
 * export condition except react-server, and scripts/db-check.ts imports this
 * module under tsx. The marker lives in src/db/index.ts instead. See the spec.
 */
export const dbAdmin = drizzle(directClient(), { schema, casing: "snake_case" });
```

- [ ] **Step 2: Add the guard to `eslint.config.mjs`**

The rule must go in the **existing** `src/**/*.{ts,tsx}` block, not a new one.
ESLint merges flat-config blocks last-wins _per rule name_, so a second block
setting `no-restricted-imports` would silently disable the Button/Badge/Card
rule that block already carries.

Replace the block spanning `eslint.config.mjs:25-39` — it opens with `{` on
line 25 and closes with `},` on line 39 — with:

```js
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/components/shadcn/**", "src/db/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: DUPLICATED_PRIMITIVES.map((name) => ({
            name: `@/components/shadcn/${name.toLowerCase()}`,
            message: `Import { ${name} } from "@/components/ui/${name.toLowerCase()}" instead — that is the canonical path; the shadcn one exists for shadcn's own internal imports.`,
          })),
          patterns: [
            {
              // `patterns` rather than `paths` so a relative ../../db/admin is
              // caught as well as the aliased @/db/admin.
              group: ["@/db/admin", "**/db/admin"],
              message:
                "dbAdmin connects as the table owner and bypasses row level security. Application code must use `db.rls()` from \"@/db\". Only src/db and scripts may import it.",
            },
          ],
        },
      ],
    },
  },
```

Note `src/db/**` added to `ignores` — the db modules import each other legitimately.

- [ ] **Step 3: Prove the guard actually fires**

This is the only real test in the plan. Run it.

Create `src/app/guard-probe.ts` containing exactly:

```ts
import { dbAdmin } from "@/db/admin";

export const probe = dbAdmin;
```

Then run: `npm run lint`

Expected: an error on `src/app/guard-probe.ts` reading
`dbAdmin connects as the table owner and bypasses row level security...`

If lint passes, the guard is not working — fix it before continuing.

- [ ] **Step 4: Remove the probe**

Delete `src/app/guard-probe.ts`, then run: `npm run lint`

Expected: clean.

(Deleting is a file operation rather than a shell command on purpose — this
repo has macOS and Windows contributors, and `CLAUDE.md` bans shell-specific
incantations for exactly this reason.)

- [ ] **Step 5: Commit**

```bash
git add src/db/admin.ts eslint.config.mjs
git commit -m "feat: add RLS-bypassing admin handle behind an eslint guard"
```

---

### Task 6: The connection check

**Files:**

- Create: `scripts/db-check.ts`
- Modify: `package.json`

- [ ] **Step 1: Create `scripts/db-check.ts`**

```ts
import { config } from "dotenv";

// Load .env.local BEFORE anything reads process.env. Static ES imports are
// hoisted above this call, so the db modules are imported dynamically inside
// main() — a plain `import { dbAdmin } from "../src/db/admin"` would evaluate
// that module, and therefore read DIRECT_URL, before dotenv ever ran.
config({ path: ".env.local", quiet: true });

async function main(): Promise<void> {
  const { count } = await import("drizzle-orm");
  const { authUsers } = await import("drizzle-orm/supabase");
  const { dbAdmin } = await import("../src/db/admin");
  const { directClient } = await import("../src/db/client");

  // auth.users exists in every Supabase project, so this proves the whole
  // chain — env loading, postgres.js, the connection string, credentials and
  // Drizzle's query builder — while this repo still owns no tables of its own.
  const [row] = await dbAdmin.select({ users: count() }).from(authUsers);

  console.log(`Connected to Supabase. auth.users rows: ${row?.users ?? 0}`);

  await directClient().end();
}

main().catch((error: unknown) => {
  console.error(`db:check failed — ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
```

- [ ] **Step 2: Add the script to `package.json`**

Add after `"db:studio"`:

```json
"db:check": "tsx scripts/db-check.ts"
```

- [ ] **Step 3: Run it**

Run: `npm run db:check`

Expected with real credentials: `Connected to Supabase. auth.users rows: 0`
(any number is fine — the count is not the point, the connection is).

Expected with an empty `.env.local`:
`db:check failed — DIRECT_URL is not set. Copy .env.example to .env.local...`

**If you get the second output, this task is BLOCKED, not complete.** Record it
as blocked and continue to Task 7 — every remaining task except Task 10 runs
without credentials.

Any other error is a real failure. Common causes: wrong port in `DIRECT_URL`
(must be 5432, not 6543), or a password containing characters that need
percent-encoding in a URL.

- [ ] **Step 4: Verify it type-checks and lints**

Run: `npm run typecheck && npm run lint`
Expected: both clean. `scripts/` is inside `tsconfig.json`'s `include`, so this
file is type-checked; it is outside `src/`, so the admin ESLint guard correctly
does not apply to it.

- [ ] **Step 5: Commit**

```bash
git add scripts/db-check.ts package.json
git commit -m "feat: add db:check connection verification script"
```

---

### Task 7: The Supabase server client

**Files:**

- Create: `src/lib/supabase/server.ts`

- [ ] **Step 1: Create `src/lib/supabase/server.ts`**

```ts
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/**
 * A Supabase client scoped to the current request.
 *
 * This exists to READ the session — src/db/rls.ts needs verified JWT claims to
 * hand to Postgres. Signing in, signing out and the seeker/company route guard
 * belong to the auth ticket; see the note in src/app/login/actions.ts.
 *
 * Never cache the returned client. Supabase requires a fresh one per render.
 */
export async function createSupabaseServerClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY must both be set. Copy .env.example to .env.local — see docs/drizzle.md.",
    );
  }

  const cookieStore = await cookies();

  return createServerClient(url, key, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (cookiesToSet) => {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // A Server Component cannot write cookies. That is expected here:
          // refreshing the session is the job of the middleware the auth
          // ticket adds. Swallowing this is the documented Next.js pattern.
        }
      },
    },
  });
}
```

`getAll`/`setAll` are required — `@supabase/ssr` deprecated `get`/`set`/`remove`
and warns that using them "will cause significant and difficult to debug
authentication issues."

- [ ] **Step 2: Verify it type-checks**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/supabase/server.ts
git commit -m "feat: add per-request supabase server client"
```

---

### Task 8: The RLS wrapper

**Files:**

- Create: `src/db/rls.ts`
- Create: `src/db/index.ts`

- [ ] **Step 1: Create `src/db/rls.ts`**

```ts
import { sql } from "drizzle-orm";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";

import { createSupabaseServerClient } from "@/lib/supabase/server";

import { pooledClient } from "./client";
import * as schema from "./schema";

type Schema = typeof schema;

/** The transaction handle handed to an `rls()` callback. */
export type Tx = Parameters<Parameters<PostgresJsDatabase<Schema>["transaction"]>[0]>[0];

/**
 * The only roles a request may run as.
 *
 * `service_role` is deliberately absent: reaching it here would mean an
 * RLS-scoped call had silently escalated to one that ignores every policy.
 */
const RLS_ROLES = ["anon", "authenticated"] as const;

type RlsRole = (typeof RLS_ROLES)[number];

function assertRlsRole(role: unknown): RlsRole {
  if (typeof role === "string" && (RLS_ROLES as readonly string[]).includes(role)) {
    return role as RlsRole;
  }

  throw new Error(
    `Refusing to run a query as role ${JSON.stringify(role)}. Allowed: ${RLS_ROLES.join(", ")}.`,
  );
}

/**
 * The current user's VERIFIED JWT claims, or null when nobody is signed in.
 *
 * getClaims() rather than getSession(): @supabase/auth-js states that a user
 * object read from cookies "must not be trusted". These claims decide which
 * rows Postgres returns, so a forged cookie must not be able to choose them.
 *
 * Any failure — expired token, malformed cookie, no session — returns null and
 * the query runs as `anon`. Falling through to `authenticated` on a failed
 * verification would be the whole bug this function exists to prevent.
 */
async function verifiedClaims(): Promise<Record<string, unknown> | null> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.auth.getClaims();

    if (error) {
      return null;
    }

    return data?.claims ?? null;
  } catch {
    return null;
  }
}

const database = drizzle(pooledClient(), { schema, casing: "snake_case" });

/**
 * Run a query with row-level security applied.
 *
 * Everything happens in one transaction because `set_config(..., true)` and
 * `SET LOCAL` are transaction-scoped: they revert on COMMIT, so a pooled
 * connection can never be handed to the next request still wearing the last
 * request's identity.
 *
 * This differs from Drizzle's published Supabase example in two ways, both
 * deliberate — see the spec:
 *   1. the claims are bound as a parameter, not spliced into the SQL text;
 *   2. the claims are verified rather than read from a cookie.
 */
export async function rls<T>(run: (tx: Tx) => Promise<T>): Promise<T> {
  const claims = await verifiedClaims();
  const role = assertRlsRole(claims?.role ?? "anon");
  const payload = JSON.stringify(claims ?? {});
  const subject = typeof claims?.sub === "string" ? claims.sub : "";

  return database.transaction(async (tx) => {
    await tx.execute(sql`select set_config('request.jwt.claims', ${payload}, true)`);
    await tx.execute(sql`select set_config('request.jwt.claim.sub', ${subject}, true)`);

    // SET LOCAL ROLE cannot take a bound parameter, which is exactly why
    // assertRlsRole exists — `role` is one of two literals by this point.
    await tx.execute(sql.raw(`set local role ${role}`));

    return run(tx);
  });
}
```

- [ ] **Step 2: Create `src/db/index.ts`**

```ts
import "server-only";

import { rls } from "./rls";

export type { Tx } from "./rls";

/**
 * The database, as application code sees it.
 *
 * There is one method, and it is the RLS-scoped one:
 *
 *   const jobs = await db.rls((tx) => tx.select().from(jobsTable));
 *
 * The unrestricted handle lives in ./admin and is not re-exported here on
 * purpose — reaching it should require importing a different module and
 * arguing with ESLint about it.
 */
export const db = { rls };
```

- [ ] **Step 3: Verify it type-checks and lints**

Run: `npm run typecheck && npm run lint`
Expected: both clean.

If `Tx` produces a type error, it is because `PostgresJsDatabase` needs the
schema generic — check the `Schema` type alias is passed as written above.

- [ ] **Step 4: Verify a production build still succeeds**

Run: `npm run build`
Expected: success. This is the step that catches a `server-only` marker placed
in the wrong module — if `next build` fails complaining that a server-only
module was imported from a client component, the import chain is wrong.

- [ ] **Step 5: Commit**

```bash
git add src/db/rls.ts src/db/index.ts
git commit -m "feat: add RLS-scoped query wrapper with verified JWT claims"
```

---

### Task 9: Documentation

**Files:**

- Create: `docs/drizzle.md`
- Modify: `README.md` — the Scripts table and the Project layout block
- Modify: `CLAUDE.md` — the Commands block and the Architecture tree

- [ ] **Step 1: Create `docs/drizzle.md`**

````markdown
# Drizzle and Supabase

Drizzle is the data layer. Queries go through it over a real Postgres
connection — not through `@supabase/supabase-js`, which is a dependency here
only so we can read the session.

## Two connection strings

| Variable       | Port                     | Used by                           | Why                                                                                                                              |
| -------------- | ------------------------ | --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL` | 6543, transaction pooler | Next.js at runtime                | Serverless needs a pooler. Supavisor's transaction mode has no prepared statements, so `src/db/client.ts` sets `prepare: false`. |
| `DIRECT_URL`   | 5432, session pooler     | `drizzle-kit`, `npm run db:check` | DDL takes locks and needs one session-scoped conversation.                                                                       |

Do not collapse these into one variable. It appears to work until a migration
hangs or a prepared-statement error shows up under load.

## Two handles

```ts
import { db } from "@/db";

const rows = await db.rls((tx) => tx.select().from(someTable));
```

`db.rls()` opens a transaction, sets the signed-in user's verified JWT claims,
switches to the `authenticated` role, and runs your callback. Row-level
security applies. **This is what application code uses.**

`dbAdmin` in `src/db/admin.ts` connects as `postgres`, which owns the tables and
so bypasses every policy. Migrations and scripts only — an ESLint rule blocks
it everywhere under `src/` except `src/db/`.

With no session, `db.rls()` runs as `anon`. Until the auth ticket ships there
is no way to sign in, so RLS-scoped queries return nothing. That is correct
behaviour, not a broken setup.

## Adding your first table

1. Write `src/db/schema/<thing>.ts` with a `pgTable` and its `pgPolicy`
   declarations. Policies live with the table they govern.
2. Re-export it from `src/db/schema/index.ts`. drizzle-kit reads that file and
   nothing else — a table missing from the barrel is invisible to migrations.
3. `npm run db:generate` — writes SQL into `drizzle/`. **Read the SQL.**
4. `npm run db:migrate` — applies it.
5. Commit the generated files alongside the schema change.

Policies need `authenticatedRole` and `authUid` from `drizzle-orm/supabase`:

```ts
import { sql } from "drizzle-orm";
import { pgPolicy, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { authenticatedRole, authUid, authUsers } from "drizzle-orm/supabase";

export const profiles = pgTable(
  "profiles",
  {
    id: uuid()
      .primaryKey()
      .references(() => authUsers.id, { onDelete: "cascade" }),
    fullName: text().notNull(),
  },
  (table) => [
    pgPolicy("profiles are viewable by their owner", {
      for: "select",
      to: authenticatedRole,
      using: sql`${table.id} = ${authUid}`,
    }),
  ],
);
```

`drizzle.config.ts` declares `entities.roles.provider: "supabase"`, so
drizzle-kit knows `anon`, `authenticated`, `service_role` and `postgres`
already exist and will not try to create them.

## Commands

| Command               | What it does                                       |
| --------------------- | -------------------------------------------------- |
| `npm run db:generate` | Diff the schema, write a migration into `drizzle/` |
| `npm run db:migrate`  | Apply pending migrations                           |
| `npm run db:studio`   | Browse the database                                |
| `npm run db:check`    | Prove the connection works                         |

There is no `db:push`. We commit migration files; `push` is how a schema
silently diverges from its history.

**`db:generate` producing nothing is expected right now.** The schema barrel is
empty until someone adds the first table.

## Why our RLS code differs from Drizzle's docs

<https://orm.drizzle.team/docs/rls> has the right shape but two problems we
fixed in `src/db/rls.ts`:

- It splices the JWT into the SQL string with `sql.raw`. An apostrophe in
  `user_metadata` — user-controlled — breaks out of the literal. We bind it.
- It trusts a token read from cookies. `@supabase/auth-js` says such a token
  "must not be trusted"; we use `getClaims()`, which verifies the signature.
  These claims choose which rows Postgres returns.
````

- [ ] **Step 2: Add the commands to `README.md`**

In the Scripts table, after the `npm run clean` row:

```markdown
| `npm run db:generate` | Generate a SQL migration from the Drizzle schema |
| `npm run db:migrate` | Apply pending migrations |
| `npm run db:studio` | Browse the database in Drizzle Studio |
| `npm run db:check` | Verify the database connection works |
```

In the Project layout block, after the `scripts/` line:

```
src/db/          Drizzle schema, connections, and the RLS query wrapper
docs/drizzle.md  How the database is wired — read before adding a table
```

Then, after the "Getting started" code block, add:

```markdown
Database work additionally needs `.env.local` — copy `.env.example` and fill it
in from the Supabase dashboard. The app runs without it; every screen still
renders fixture data.
```

- [ ] **Step 3: Add the commands to `CLAUDE.md`**

In the Commands block, after the `clean` line:

```
npm run db:generate  # write a migration from the schema
npm run db:migrate   # apply pending migrations
npm run db:studio    # browse the database
npm run db:check     # verify the connection
```

In the Architecture tree, after the `src/lib/` section:

```
src/db/           Drizzle data layer — read docs/drizzle.md first
  client.ts       Both postgres.js connections; nothing else opens one
  index.ts        `db.rls()` — the only handle app code may import
  admin.ts        Bypasses RLS. Scripts only; an ESLint rule enforces it
  rls.ts          Transaction wrapper: verified claims, role switch
  schema/         Tables. Empty until the first one is modelled
src/lib/supabase/
  server.ts       Per-request client, used only to read the session
```

And after the paragraph about `@/*` mapping to `src/*`, add:

```markdown
There are two database handles and they are not interchangeable. `db.rls()`
from `@/db` runs inside a transaction as the `authenticated` role, so row-level
security applies; it is what screens and server actions use. `dbAdmin` from
`@/db/admin` connects as the table owner and bypasses every policy — scripts
and migrations only, and an ESLint rule blocks it elsewhere under `src/`.

**Read `docs/drizzle.md` before adding a table or changing the schema.**
```

- [ ] **Step 4: Verify formatting**

Run: `npm run format:check`

Expected: clean. If Prettier objects, run `npm run format`. Note that
`.prettierignore` already excludes `CLAUDE.md` and `README.md`, so only
`docs/drizzle.md` is subject to it.

- [ ] **Step 5: Commit**

```bash
git add docs/drizzle.md README.md CLAUDE.md
git commit -m "docs: document the drizzle and supabase setup"
```

---

### Task 10: Full verification sweep

**Files:** none — this task only runs things.

- [ ] **Step 1: Clean install check**

```bash
npm run clean
npm run typecheck
```

Expected: no errors. `typecheck` runs `next typegen` first, which regenerates
the route types `clean` just deleted.

- [ ] **Step 2: Lint and format**

```bash
npm run lint
npm run format:check
```

Expected: both clean.

- [ ] **Step 3: Production build**

```bash
npm run build
```

Expected: success. Every route still renders its fixture; nothing user-visible
changed.

- [ ] **Step 4: Connection check**

```bash
npm run db:check
```

Expected: `Connected to Supabase. auth.users rows: N`

**Blocked without credentials.** Report it as blocked; do not report it passed.

- [ ] **Step 5: Confirm the schema pipeline is idle-but-working**

```bash
npm run db:generate
```

Expected: completes, reports no changes, writes nothing to `drizzle/`. Also
blocked without credentials.

- [ ] **Step 6: Confirm no secrets are staged**

```bash
git status --porcelain
git diff --cached --stat
```

Expected: `.env.local` appears nowhere.

- [ ] **Step 7: Report**

State plainly which of steps 1–6 ran and passed, and which were blocked on
missing credentials. If anything failed, say what and show the output.

---

## Definition of done

- [ ] `npm run typecheck`, `npm run lint`, `npm run format:check` and `npm run build` all pass
- [ ] Importing `@/db/admin` from `src/app/` fails lint (proved in Task 5, Step 3)
- [ ] `npm run db:check` connects — or is explicitly reported blocked
- [ ] `npm run db:generate` runs and correctly emits nothing — or is explicitly reported blocked
- [ ] `.env.local` is untracked; `.env.example` is committed
- [ ] No screen changed. Every `data.ts` fixture is still what renders.
