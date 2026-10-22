/**
 * The list of roles the seeker last saw on /jobs or /search, in the order it
 * showed them, for the job posting page's rail of jobs (./jobs-rail.tsx,
 * KAN-297). ./feed-list writes it whenever its cards change (a first page, a
 * Load More, a job marked applied); the rail reads it, and writes it too when
 * it loads more or has to fetch the list again.
 *
 * Kept for the tab's session, so a reload of a job's page keeps its rail.
 * `query` and `source` are the ones the list's own Load More uses, so the
 * rail asks the API for exactly the same list. Not ./feed-pages, which keeps
 * only the Load More pages and drops them on a fresh visit to the list.
 */

import type { JobListing } from "./listings";

/** How long the kept roles are trusted: roles close, so after this the rail
 *  fetches the list's first page again rather than show stale ones. The same
 *  age as ./feed-pages' kept pages. */
const FRESH_FOR = 30 * 60 * 1000;

const KEY = "workit:shown-list";

export type ShownList = {
  /** The list's own query (feedQuery, plus `sort=match` for Best Match). */
  query: string;
  /** Which order drew it: the plain feed or Best Match's scored jobs. */
  source: "feed" | "recommended";
  jobs: JobListing[];
  /** The next Load More's offset, and whether the API has more. */
  offset: number;
  more: boolean;
  at: number;
};

/** Read once from sessionStorage, then held here so useSyncExternalStore
 *  gets the same object until the next write. */
let shown: ShownList | null | undefined;
const listeners = new Set<() => void>();

export function readShownList(): ShownList | null {
  if (shown === undefined) {
    try {
      shown = JSON.parse(sessionStorage.getItem(KEY) ?? "null") as ShownList | null;
    } catch {
      shown = null;
    }
  }
  return shown;
}

/** Whether the kept roles are young enough to show as they are. */
export function isFresh(list: ShownList): boolean {
  return Date.now() - list.at < FRESH_FOR;
}

export function rememberList(list: Omit<ShownList, "at">) {
  shown = { ...list, at: Date.now() };
  try {
    sessionStorage.setItem(KEY, JSON.stringify(shown));
  } catch {
    /* storage off or full: kept in memory for this visit */
  }
  for (const listener of listeners) listener();
}

export function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
