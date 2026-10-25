/**
 * The full feed state (initial page + Load More pages + metadata), kept for
 * the tab's session so a RETURN to the list finds it as it was, and
 * ../scroll-memory.tsx can put the seeker back where they were in it. One
 * list is kept, the last one loaded into, and only for its own query.
 *
 * The cache doubles as the Suspense fallback: ./feed-fallback.tsx reads it
 * and renders the cached cards while the server component resolves, so a
 * return to /jobs shows the feed instantly instead of a skeleton. The 30-min
 * TTL and the query match handle staleness; ../scroll-memory.tsx no longer
 * clears the cache on a fresh arrival.
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
  /** All jobs: initial server page merged with Load More pages. */
  jobs: JobListing[];
  offset: number;
  more: boolean;
  at: number;
  stages: Record<string, ApplicationStage>;
  tailored: string[];
  canMarkApplied: boolean;
  source: ListSource;
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
