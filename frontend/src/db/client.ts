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
