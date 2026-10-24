/**
 * The list of roles the seeker last saw on /jobs or /search, in the order it
 * showed them, for the job posting page's rail of jobs (./jobs-rail.tsx,
 * KAN-297). ./feed-list writes it whenever its cards change (a first page, a
 * Load More, a job marked applied); the rail reads it, and writes it too when
 * it loads more or has to fetch the list again.
 *
 * Kept for the tab's session (./session-store), so a reload of a job's page
 * keeps its rail. `query` and `source` are the ones the list's own Load More
 * uses, so the rail asks the API for exactly the same list (./list-pages).
 * Not ./feed-pages, which keeps only the Load More pages and drops them on a
 * fresh visit to the list: one record of the whole list there would bring
 * back, on a return, roles that have since left the server's first page.
 */

import { LIST_FRESH_FOR, type ListSource } from "./list-pages";
import type { JobListing } from "./listings";
import { sessionStore } from "./session-store";

export type ShownList = {
  /** The list's own query (feedQuery, plus `sort=match` for Best Match). */
  query: string;
  source: ListSource;
  jobs: JobListing[];
  /** The next Load More's offset, and whether the API has more. */
  offset: number;
  more: boolean;
  at: number;
};

const store = sessionStore<ShownList>("workit:shown-list");

export const readShownList = store.read;
export const subscribe = store.subscribe;

/** Whether the kept roles are young enough to show as they are. */
export function isFresh(list: ShownList): boolean {
  return Date.now() - list.at < LIST_FRESH_FOR;
}

export function rememberList(list: Omit<ShownList, "at">) {
  store.write({ ...list, at: Date.now() });
}
