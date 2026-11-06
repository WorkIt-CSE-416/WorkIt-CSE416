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

import type { ApplicationStage } from "../auto-apply/actions";
import { withChange, type StageChange } from "./feed-stages";
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
  /** Each job's application, for the Save button on a compact card. A job
   *  saved and then taken out is null. Lists kept by an older build have none. */
  stages?: Record<string, ApplicationStage | null>;
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

/** The stages the seeker set in this tab, each with when (./feed-stages):
 *  every list lays the ones made after its render over its own. */
const changes = sessionStore<Record<string, StageChange>>("workit:stage-changes");

export const readStageChanges = changes.read;
export const subscribeStageChanges = changes.subscribe;

/** One job's new application, so its other buttons and every list follow: a
 *  job saved on its page fills the bookmark on its compact card and leaves
 *  the feed and the rail (KAN-217), and the reverse. Save, its Undo, Did You
 *  Apply? and Auto Apply all call it. */
export function rememberStage(jobId: string, stage: ApplicationStage | null) {
  const list = readShownList();
  if (list) store.write({ ...list, stages: { ...list.stages, [jobId]: stage } });
  changes.write(withChange(changes.read(), jobId, { stage, at: Date.now() }));
}
