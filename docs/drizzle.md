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
empty until someone adds the first table. It reports `0 tables` and
`No schema changes, nothing to migrate` — that is success, not failure.

`db:generate` does not need a database connection; it diffs the schema against
the migration journal. Only `db:migrate`, `db:studio` and `db:check` connect.

## Why our RLS code differs from Drizzle's docs

<https://orm.drizzle.team/docs/rls> has the right shape but two problems we
fixed in `src/db/rls.ts`:

- It splices the JWT into the SQL string with `sql.raw`. An apostrophe in
  `user_metadata` — user-controlled — breaks out of the literal. We bind it.
- It trusts a token read from cookies. `@supabase/auth-js` says such a token
  "must not be trusted"; we use `getClaims()`, which verifies the signature.
  These claims choose which rows Postgres returns.
