# Supabase

Supabase is still the database and still the identity provider. What changed is
who talks to it.

**The frontend does not query the database.** It opens no Postgres connection,
owns no schema and runs no migrations. It reads the signed-in user's session
from Supabase Auth and calls the Python API for everything else. That API owns
the connection string, the schema and the migrations.

This replaces the Drizzle data layer that used to live in `src/db/`. If you are
looking for `db.rls()`, `dbAdmin`, `npm run db:generate` or `drizzle.config.ts`,
they are gone — the query you were about to write belongs in an API endpoint.

## Setup

Copy `.env.example` to `.env.local` and fill in two values from the Supabase
dashboard (Project Settings → API):

| Variable                        | What it is               |
| ------------------------------- | ------------------------ |
| `NEXT_PUBLIC_SUPABASE_URL`      | The project URL          |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | The publishable anon key |

Both are `NEXT_PUBLIC_` deliberately. The anon key is designed to ship to the
browser; row-level security, not secrecy, is what keeps data safe behind it.

**No connection string and no service-role key belongs in this folder.** A
`SUPABASE_SERVICE_ROLE_KEY` or a `DATABASE_URL` added here is one typo away
from a `NEXT_PUBLIC_` prefix and the client bundle. They belong to the Python
service's environment.

The app runs without `.env.local` — every screen renders the fixture data in
its `data.ts`. You only need the file once a screen reads a real session.

## Reading the session

`src/lib/supabase/server.ts` builds a per-request client:

```ts
import { createSupabaseServerClient } from "@/lib/supabase/server";

const supabase = await createSupabaseServerClient();
const { data } = await supabase.auth.getClaims();
```

Two rules:

- **`getClaims()`, never `getSession()`, when the answer decides anything.**
  `@supabase/auth-js` says a user object read from cookies "must not be
  trusted" — a cookie is client-controlled. `getClaims()` verifies the token's
  signature. `getSession()` is fine for "should I render the signed-out
  header", and wrong for anything that grants access.
- **Never cache the client.** Supabase requires a fresh one per render; the
  cookie jar it closes over belongs to one request.

## Calling the API

Forward the access token; do not re-implement authorization in the frontend.
The API verifies the JWT against Supabase's JWKS and enforces the rules
itself, so a request that skips the header should be rejected there rather than
quietly succeeding.

Server Components and Server Actions are where those calls belong, so the token
never reaches the browser. A screen's `data.ts` is the seam: it holds fixture
data today and becomes the fetch when the endpoint exists, which keeps
`page.tsx` untouched either way.

## Schema and migrations

Not here. `backend/db/` holds the schema design notes; the Python service owns
the migrations that implement them. Nothing in `frontend/` should describe a
table, and a schema change never needs a frontend commit.
