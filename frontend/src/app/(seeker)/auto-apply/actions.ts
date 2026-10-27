"use server";

import { apiFetch, extractErrorMessage } from "@/lib/auth";
import type { SentResume } from "@/lib/sent-resume-actions";
import { getApplicantSession } from "@/lib/session";

/**
 * Auto apply's writes, through the API's routes
 * (backend/app/routers/auto_apply.py). Every export of a "use server" file
 * is a public POST endpoint: these take only a job id or nothing, and the
 * applicant is always the session's own. Reads are in ./applications.
 */

/** Where one application stands: backend `dto.application_stage`. Saved
 *  (KAN-261) is a job's Save button, not a run: it counts as no application
 *  yet, so queueing a saved job queues it. Interviewing, offer and rejected
 *  (KAN-413) come after applied, set on the Applications Tracker. */
export type ApplicationStage =
  "saved" | "queued" | "needs_you" | "skipped" | "applied" | AfterApplied;

/** The stages after applied (KAN-413): the student sets them on the
 *  Applications Tracker. Each still counts as applied. */
export type AfterApplied = "interviewing" | "offer" | "rejected";

/** The stages auto apply itself writes: Live Activity's rows. */
export type RunStage = Exclude<ApplicationStage, "saved" | AfterApplied>;

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

/** Up Next's resume picker (KAN-359): the resume one queued job goes out
 *  with, in place of the rule's pick (PUT .../applications/{job_id}/resume).
 *  The API keeps it as a sent resume the application names, which the run's
 *  resume step sends. */
export async function chooseResume(
  jobId: string,
  source: { builtResumeId: string } | { uploadedResumeId: string },
): Promise<{ sent: SentResume; error: null } | { sent: null; error: string }> {
  let session;
  try {
    session = await getApplicantSession();
  } catch {
    return { sent: null, error: SIGNED_OUT };
  }
  try {
    const res = await apiFetch(
      `/applicants/${session.id}/applications/${encodeURIComponent(jobId)}/resume`,
      {
        method: "PUT",
        body: JSON.stringify(
          "builtResumeId" in source
            ? { built_resume_id: source.builtResumeId }
            : { uploaded_resume_id: source.uploadedResumeId },
        ),
      },
      session.token,
    );
    if (!res.ok) return { sent: null, error: await extractErrorMessage(res) };
    return { sent: (await res.json()) as SentResume, error: null };
  } catch {
    return { sent: null, error: UNREACHABLE };
  }
}
