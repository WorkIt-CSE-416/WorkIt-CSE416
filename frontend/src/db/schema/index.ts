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
