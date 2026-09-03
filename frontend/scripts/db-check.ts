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

/**
 * Drizzle wraps a driver failure in its own error and puts the real reason —
 * bad host, wrong password, refused connection — on `cause`. Printing only the
 * top-level message would hide exactly what this script exists to report, so
 * walk the chain.
 */
function explain(error: unknown): string {
  const lines: string[] = [];

  for (let current = error; current instanceof Error; current = current.cause) {
    lines.push(current.message);
  }

  return lines.length > 0 ? lines.join("\n  caused by: ") : String(error);
}

main().catch((error: unknown) => {
  console.error(`db:check failed — ${explain(error)}`);
  process.exit(1);
});
