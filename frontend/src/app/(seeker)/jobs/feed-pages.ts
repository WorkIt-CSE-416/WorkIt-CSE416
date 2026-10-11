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

import type { JobListing } from "./listings";

/** How long loaded pages are kept for a return to their list. */
const KEPT_FOR = 30 * 60 * 1000;

const PAGES = "workit:feed-pages";

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

/** The kept pages, in memory and mirrored to sessionStorage so they survive a
 *  reload too. `undefined` until first read. A store rather than state, so a
 *  list reads them as it renders (useSyncExternalStore) with no flash of the
 *  first page alone. */
let kept: Kept | null | undefined;
const listeners = new Set<() => void>();

export function readKept(): Kept | null {
  if (kept === undefined) {
    try {
      kept = JSON.parse(sessionStorage.getItem(PAGES) ?? "null") as Kept | null;
    } catch {
      kept = null;
    }
  }
  return kept && Date.now() - kept.at < KEPT_FOR ? kept : null;
}

export function keep(next: Kept) {
  kept = next;
  try {
    sessionStorage.setItem(PAGES, JSON.stringify(next));
  } catch {
    /* storage off or full: kept in memory for this visit */
  }
  for (const listener of listeners) listener();
}

export function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Drops the kept pages when `path` is the list's own page: a fresh arrival
 *  there starts the list at its first page. An arrival anywhere else leaves
 *  them, so Jobs, then the Dashboard, then Back still finds them. */
export function forgetFeedPages(path: string) {
  if (readKept()?.path !== path) return;
  kept = null;
  try {
    sessionStorage.removeItem(PAGES);
  } catch {
    /* storage off: memory alone held them */
  }
  for (const listener of listeners) listener();
}
