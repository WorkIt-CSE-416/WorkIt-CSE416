"use server";

import { apiFetch, extractErrorMessage } from "@/lib/auth";
import { getApplicantSession } from "@/lib/session";

/**
 * Auto apply's writes, through the API's routes
 * (backend/app/routers/auto_apply.py). Every export of a "use server" file
 * is a public POST endpoint: these take only a job id or nothing, and the
 * applicant is always the session's own. Reads are in ./applications.
 */

/** Where one application stands: backend `dto.application_stage`. Saved
 *  (KAN-261) is a job's Save button, not a run: it counts as no application
 *  yet, so queueing a saved job queues it. Filling, review, approved and
 *  submitting are WorkIt Desktop's (KAN-323, auto-apply/desktop.md): a
 *  Worker claimed it, it waits for the seeker's review, the seeker approved
 *  it, a Desktop took it to submit (never twice). */
export type ApplicationStage =
  "saved" | "queued" | "filling" | "review" | "approved" | "submitting" | "needs_you" | "skipped" | "applied";

/** The stages auto apply itself writes: Live Activity's rows. */
export type RunStage = Exclude<ApplicationStage, "saved">;

const SIGNED_OUT = "You're signed out. Sign in again to continue.";
const UNREACHABLE = "Could not reach the server.";

/** A job's Auto Apply button: queues it (POST .../applications) and answers
 *  its stage. A saved job is queued; one that already has an application
 *  keeps that stage, so the answer is never saved. */
export async function queueJob(
  jobId: string,
): Promise<{ stage: RunStage; error: null } | { stage: null; error: string }> {
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
    return { stage: ((await res.json()) as { stage: RunStage }).stage, error: null };
  } catch {
    return { stage: null, error: UNREACHABLE };
  }
}

/** Takes a queued job out of the queue (DELETE .../applications/{job_id}):
 *  the Auto Apply button's second click and Live Activity's cross. The job
 *  then has no application, as before it was queued. One past queued
 *  (needs you, skipped, applied) stays, and the API's 409 says why. */
export async function dequeueJob(jobId: string): Promise<{ error: string | null }> {
  let session;
  try {
    session = await getApplicantSession();
  } catch {
    return { error: SIGNED_OUT };
  }
  try {
    const res = await apiFetch(
      `/applicants/${session.id}/applications/${encodeURIComponent(jobId)}`,
      { method: "DELETE" },
      session.token,
    );
    // Already gone (another tab took it out): what was asked for is true.
    if (res.ok || res.status === 404) return { error: null };
    return { error: await extractErrorMessage(res) };
  } catch {
    return { error: UNREACHABLE };
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
