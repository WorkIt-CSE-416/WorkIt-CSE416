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
