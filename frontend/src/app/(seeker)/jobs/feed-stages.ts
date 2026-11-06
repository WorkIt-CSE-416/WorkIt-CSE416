/**
 * Which jobs the Jobs page shows, by their application's stage (KAN-217).
 * A saved job and an applied one (or any stage after applied) live on the
 * Tracker, so the feed, /search and the rail beside a job leave
 * them out, as `GET /jobs` does (`JobFilters.tracked_by`). A job auto apply
 * holds (queued, needs you, skipped) stays.
 *
 * The server's list is right as of its render. What the seeker changes after
 * it (a Save, its Undo, Did You Apply?, Auto Apply) is a `StageChange` the
 * browser keeps for the tab (`rememberStage` in ./shown-list), and every list
 * lays the changes made after its render over the stages it was drawn with
 * (`stagesNow`): a Back to a list Next kept shows a job saved since as gone,
 * and a fresh render, which already knows, ignores the older changes, so an
 * unsave on the tracker brings the job back.
 *
 * Pure, for `node --test` (./feed-stages.test.ts): relative `.ts` imports only.
 */

import type { ApplicationStage } from "../auto-apply/actions";
import { hasApplied } from "../applied.ts";

/** One stage the seeker set in this tab, and when (ms since the epoch). */
export type StageChange = { stage: ApplicationStage | null; at: number };

/** Whether a job with this stage is off the Jobs page: saved, or applied
 *  and after. */
export function leavesFeed(stage: ApplicationStage | null | undefined): boolean {
  return stage === "saved" || hasApplied(stage);
}

/** The stages a list drawn at `drawnAt` should show: what it was drawn with,
 *  with every change made since laid over it. */
export function stagesNow(
  drawn: Record<string, ApplicationStage | null>,
  changes: Record<string, StageChange> | null,
  drawnAt: number,
): Record<string, ApplicationStage | null> {
  const now = { ...drawn };
  for (const [jobId, change] of Object.entries(changes ?? {})) {
    if (change.at > drawnAt) now[jobId] = change.stage;
  }
  return now;
}

/** The jobs a list shows: every one not off the feed, and `keep` (the job
 *  open beside the list) whatever its stage. */
export function onFeed<T extends { id: string }>(
  jobs: T[],
  stages: Record<string, ApplicationStage | null> | undefined,
  keep?: string,
): T[] {
  return jobs.filter((job) => job.id === keep || !leavesFeed(stages?.[job.id]));
}

/** How many changes the tab keeps: the newest win. */
export const KEEP_CHANGES = 100;

/** `changes` with one more, trimmed to the newest KEEP_CHANGES. */
export function withChange(
  changes: Record<string, StageChange> | null,
  jobId: string,
  change: StageChange,
): Record<string, StageChange> {
  const rest = Object.entries(changes ?? {}).filter(([id]) => id !== jobId);
  const kept = rest.sort(([, a], [, b]) => a.at - b.at).slice(-(KEEP_CHANGES - 1));
  return Object.fromEntries([...kept, [jobId, change]]);
}
