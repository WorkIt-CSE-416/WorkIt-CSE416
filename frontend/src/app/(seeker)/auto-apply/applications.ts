import "server-only";

import { connection } from "next/server";

import { apiGet } from "@/lib/api";
import { extractErrorMessage } from "@/lib/auth";
import { getApplicantSession } from "@/lib/session";

import type { JobListing } from "../jobs/listings";
import type { ApplicationStage } from "./actions";

/**
 * The signed-in seeker's applications, from the API's auto apply routes
 * (backend/app/routers/auto_apply.py): the Auto Apply page's Live Activity
 * and the Auto Apply buttons' first state. Server-only, like ../jobs/listings:
 * every read forwards the session's token. Mutations are in ./actions.
 *
 * An application is one job_applications row, named by its job id: the job
 * posting's listing, where it stands, and when.
 */
export type Application = {
  job: JobListing;
  stage: ApplicationStage;
  /** When it was queued, or marked applied: an ISO instant. */
  added_at: string;
  applied_at: string | null;
  /** False once the job posting has closed; its page is gone. */
  open: boolean;
};

const UNREACHABLE = "Could not reach the server.";

/** Every application, newest first, for Live Activity. */
export async function getApplications(): Promise<
  { applications: Application[]; error: null } | { applications: null; error: string }
> {
  // Request time, not build time, as every live fetch (frontend/CLAUDE.md).
  await connection();
  try {
    const { id, token } = await getApplicantSession();
    const res = await apiGet(`/applicants/${id}/applications`, token);
    if (!res.ok) return { applications: null, error: await extractErrorMessage(res) };
    return { applications: (await res.json()) as Application[], error: null };
  } catch {
    return { applications: null, error: UNREACHABLE };
  }
}

/** Each job id's stage, for a list of Auto Apply buttons (the feed's cards).
 *  Empty when it can't be read: the buttons then start as Auto Apply, and a
 *  click still answers the real stage. */
export async function getApplicationStages(): Promise<Record<string, ApplicationStage>> {
  const { applications } = await getApplications();
  return Object.fromEntries((applications ?? []).map((a) => [a.job.id, a.stage]));
}

/** One job posting's stage (GET .../applications/{job_id}), for the Auto
 *  Apply button on its page: null when the seeker has no application for it,
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
