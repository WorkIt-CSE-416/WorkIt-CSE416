"use server";

import { apiFetch, extractErrorMessage } from "@/lib/auth";
import { getApplicantSession } from "@/lib/session";

/**
 * Auto apply's writes, through the API's routes
 * (backend/app/routers/auto_apply.py). Every export of a "use server" file
 * is a public POST endpoint: these take only a job id or nothing, and the
 * applicant is always the session's own. Reads are in ./applications.
 */

/** Where one application stands: backend `dto.application_stage`. */
export type ApplicationStage = "queued" | "needs_you" | "skipped" | "applied";

const SIGNED_OUT = "You're signed out. Sign in again to continue.";
const UNREACHABLE = "Could not reach the server.";

/** A job's Auto Apply button: queues it (POST .../applications) and answers
 *  its stage. A job that already has an application keeps that stage. */
export async function queueJob(
  jobId: string,
): Promise<{ stage: ApplicationStage; error: null } | { stage: null; error: string }> {
  let session;
  try {
    session = await getApplicantSession();
  } catch {
    return { stage: null, error: SIGNED_OUT };
  }
  try {
    const res = await apiFetch(
      `/applicants/${session.id}/applications`,
      { method: "POST", body: JSON.stringify({ job_id: jobId }) },
      session.token,
    );
    if (!res.ok) return { stage: null, error: await extractErrorMessage(res) };
    return { stage: ((await res.json()) as { stage: ApplicationStage }).stage, error: null };
  } catch {
    return { stage: null, error: UNREACHABLE };
  }
}

/** Start Auto Apply: queues a batch of the seeker's best matches (POST
 *  .../auto-apply/batches, 10 by default) and answers how many it queued. */
export async function startBatch(): Promise<
  { queued: number; error: null } | { queued: null; error: string }
> {
  let session;
  try {
    session = await getApplicantSession();
  } catch {
    return { queued: null, error: SIGNED_OUT };
  }
  try {
    const res = await apiFetch(
      `/applicants/${session.id}/auto-apply/batches`,
      { method: "POST", body: JSON.stringify({}) },
      session.token,
    );
    if (!res.ok) return { queued: null, error: await extractErrorMessage(res) };
    return { queued: ((await res.json()) as { queued: string[] }).queued.length, error: null };
  } catch {
    return { queued: null, error: UNREACHABLE };
  }
}
