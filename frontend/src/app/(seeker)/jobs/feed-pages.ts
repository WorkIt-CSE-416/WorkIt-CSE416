/**
 * The Load More pages a feed list has loaded (./feed-list), kept for the
 * tab's session so a RETURN to the list finds it as long as it was, and
 * ../scroll-memory.tsx can put the seeker back where they were in it. One
 * list is kept, the last one loaded into, and only for its own query.
 *
 * Only a return keeps them. Any other arrival (a sidebar link, a fresh link,
 * a reload) starts at the first page: ../scroll-memory.tsx calls
 * forgetFeedPages as the list's page arrives, before it is drawn, so a fresh visit
 * neither flashes nor lists stale pages (asked for 2026-10-10; arriving from
 * the sidebar used to show every page loaded in the last half hour).
 *
 * Its own module, not ./feed-list's, because the scroll memory renders on
 * every seeker page and shouldn't carry the job card along.
 */

import { LIST_FRESH_FOR } from "./list-pages";
import type { JobListing } from "./listings";
import { sessionStore } from "./session-store";

type Kept = {
  /** The page the list is on (/jobs or /search), so only a fresh arrival
   *  there drops it: leaving for another page is not a fresh visit to it. */
  path: string;
  query: string;
  jobs: JobListing[];
  offset: number;
  more: boolean;
  at: number;
};

/** The kept pages, mirrored to sessionStorage so they survive a reload too
 *  (./session-store). A store rather than state, so a list reads them as it
 *  renders (useSyncExternalStore) with no flash of the first page alone. */
const store = sessionStore<Kept>("workit:feed-pages");

export const subscribe = store.subscribe;

/** The kept pages while they are young enough to show (LIST_FRESH_FOR). */
export function readKept(): Kept | null {
  const kept = store.read();
  return kept && Date.now() - kept.at < LIST_FRESH_FOR ? kept : null;
}

/** Keeps `next`, dated now unless it carries the date its pages were
 *  loaded (a job dropped from them doesn't make them any fresher). */
export function keep({ at = Date.now(), ...pages }: Omit<Kept, "at"> & { at?: number }) {
  store.write({ ...pages, at });
}

/** Drops the kept pages when `path` is the list's own page: a fresh arrival
 *  there starts the list at its first page. An arrival anywhere else leaves
 *  them, so Jobs, then the Dashboard, then Back still finds them. */
export function forgetFeedPages(path: string) {
  if (readKept()?.path === path) store.write(null);
}
