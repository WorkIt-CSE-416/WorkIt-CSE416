import "server-only";

import { connection } from "next/server";

import { apiGet } from "@/lib/api";
import { extractErrorMessage } from "@/lib/auth";
import { getApplicantSession } from "@/lib/session";

import type { Highlight } from "../jobs/data";
import type { JobListing } from "../jobs/listings";
import type { SentResume } from "@/lib/sent-resume-actions";

import type { ApplicationStage, RunStage } from "./actions";

/**
 * The signed-in seeker's applications, from the API's auto apply routes
 * (backend/app/routers/auto_apply.py): the Auto Apply page's Live Activity
 * and the Auto Apply buttons' first state. Server-only, like ../jobs/listings:
 * every read forwards the session's token. Mutations are in ./actions.
 *
 * An application is one job_applications row, named by its job id: the job
 * posting's listing, where it stands, and when. The Applications board reads
 * the saved and applied ones through the same list
 * (../applications/tracked.ts).
 */
export type Application<Stage extends ApplicationStage = ApplicationStage> = {
  job: JobListing;
  stage: Stage;
  /** When it was queued, or marked applied: an ISO instant. */
  added_at: string;
  applied_at: string | null;
  /** False once the job posting has closed; its page is gone. */
  open: boolean;
  /** The Jobs page's match score (0-100), when read with `scored`: null for
   *  a closed posting and while the experience bank is empty. */
  match?: number | null;
  /** Up to 3 reasons behind `match`, as the Jobs page card lists them. */
  highlights?: Highlight[];
  /** The sent resume it went out with (KAN-267), or null: none was sent,
   *  or it was deleted since. */
  sent_resume?: SentResume | null;
};

const UNREACHABLE = "Could not reach the server.";

/** The applications in `stages` (every stage when empty), newest first.
 *  `scored` asks for each one's match score too (the Applications page,
 *  KAN-256, and Live Activity): it can embed the bank, so the buttons'
 *  stage reads leave it off. */
export async function getApplications<Stage extends ApplicationStage = ApplicationStage>(
  stages: readonly Stage[] = [],
  { scored = false }: { scored?: boolean } = {},
): Promise<
  { applications: Application<Stage>[]; error: null } | { applications: null; error: string }
> {
  // Request time, not build time, as every live fetch (frontend/CLAUDE.md).
  await connection();
  try {
    const { id, token } = await getApplicantSession();
    const params = new URLSearchParams(stages.map((stage) => ["stage", stage]));
    if (scored) params.set("scored", "true");
    const query = params.toString();
    const res = await apiGet(`/applicants/${id}/applications${query ? `?${query}` : ""}`, token);
    if (!res.ok) return { applications: null, error: await extractErrorMessage(res) };
    return { applications: (await res.json()) as Application<Stage>[], error: null };
  } catch {
    return { applications: null, error: UNREACHABLE };
  }
}

/** What auto apply has run or will run, for Live Activity: every stage but
 *  saved, which is only the Save button's. Scored, since its table has a
 *  Match column (KAN-285), as the Applications page's list does. */
export const RUN_STAGES: readonly RunStage[] = [
  "queued",
  "filling",
  "review",
  "approved",
  "submitting",
  "needs_you",
  "skipped",
  "applied",
];

export function getRunApplications() {
  return getApplications(RUN_STAGES, { scored: true });
}

/** Each job id's stage, for a list of Auto Apply and Save buttons (the
 *  feed's cards). Empty when it can't be read: the buttons then start as
 *  Auto Apply and unsaved, and a click still answers the real stage. */
export async function getApplicationStages(): Promise<Record<string, ApplicationStage>> {
  const { applications } = await getApplications();
  return Object.fromEntries((applications ?? []).map((a) => [a.job.id, a.stage]));
}

/** One job posting's stage (GET .../applications/{job_id}), for the Auto
 *  Apply and Save buttons on its page: null when the seeker has no
 *  application for it,
 *  or when it can't be read. */
export async function getApplicationStage(jobId: string): Promise<ApplicationStage | null> {
  try {
    const { id, token } = await getApplicantSession();
    const res = await apiGet(`/applicants/${id}/applications/${encodeURIComponent(jobId)}`, token);
    if (!res.ok) return null;
    return ((await res.json()) as Application).stage;
  } catch {
    return null;
  }
}
