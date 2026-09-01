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
 * deliberate — see docs/drizzle.md:
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
