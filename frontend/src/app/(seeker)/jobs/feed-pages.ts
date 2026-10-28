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

import type { ApplicationStage } from "../auto-apply/actions";
import { LIST_FRESH_FOR, type ListSource } from "./list-pages";
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
 *  them, so Jobs, then Home, then Back still finds them. */
export function forgetFeedPages(path: string) {
  if (readKept()?.path === path) store.write(null);
}

/** The first page as last drawn, with what its cards need (KAN-287). */
type Snapshot = {
  query: string;
  jobs: JobListing[];
  stages: Record<string, ApplicationStage>;
  tailored: string[];
  canMarkApplied: boolean;
  source: ListSource;
  at: number;
};

/**
 * The feed's Suspense fallback (./feed-fallback) draws this while the
 * server fetches the fresh first page, which then replaces it, so a visit
 * to the list paints its cards at once instead of a skeleton. Kept apart
 * from the pages above, which a fresh arrival still drops: that visit shows
 * the first page alone, and a return the whole list.
 */
const snapshot = sessionStore<Snapshot>("workit:feed-snapshot");

export const subscribeSnapshot = snapshot.subscribe;

/** The snapshot while it is young enough to show (LIST_FRESH_FOR). */
export function readSnapshot(): Snapshot | null {
  const kept = snapshot.read();
  return kept && Date.now() - kept.at < LIST_FRESH_FOR ? kept : null;
}

/** Keeps the first page just drawn, dated now: the server fetched it fresh. */
export function keepSnapshot(next: Omit<Snapshot, "at">) {
  snapshot.write({ ...next, at: Date.now() });
}
