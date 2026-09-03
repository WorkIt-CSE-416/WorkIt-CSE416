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
 * module under tsx, where that condition does not apply, so it would crash the
 * one command that verifies this setup works. The marker lives in
 * src/db/index.ts instead, and postgres.js importing node:net already stops
 * this module reaching a browser bundle.
 */
export const dbAdmin = drizzle(directClient(), { schema, casing: "snake_case" });
