"use server";

import { apiFetch, extractErrorMessage } from "@/lib/auth";
import { getAccessToken } from "@/lib/session";

/**
 * Mutations of the company's own jobs, called from the composer. Reads live
 * in ./job-queries.ts, which is server-only: every export here is a public
 * POST endpoint, so this file holds only what a client has to call.
 */

/** POST /company/jobs body. Keys and enum values are the API's, not the
 *  composer's display labels; see backend/app/schemas/company_jobs.py. */
export type JobPayload = {
  status: "draft" | "published";
  title: string;
  description: string;
  jobType: "full_time" | "part_time" | "contract";
  experienceLevel: "internship" | "new_grad" | "other";
  minYearsExperience: number | null;
  workStyle: "remote" | "hybrid" | "onsite";
  locationCountry: string;
  /** "US-NY". The composer can't pick a state yet; it only carries one
   *  through from a saved job, so a save doesn't wipe it. */
  locationState: string | null;
  salary: number | null;
  salaryMin: number | null;
  salaryMax: number | null;
  currency: string;
  salaryPeriod: "year" | "hour";
  /** ISO 8601 with an offset; the API rejects a bare date. */
  closesAt: string | null;
};

const SIGNED_OUT = "You're signed out. Sign in again to continue.";

/**
 * Creates a job, or replaces an existing one's details when `existing` is
 * set. `existing.updatedAt` is the job's `updated_at` as it was loaded; the
 * API refuses the save (409) if the job has changed since.
 */
export async function saveJob(
  payload: JobPayload,
  existing?: { id: string; updatedAt: string },
): Promise<{ error: string | null }> {
  try {
    const token = await getAccessToken();
    if (!token) return { error: SIGNED_OUT };
    const res = await apiFetch(
      existing ? `/company/jobs/${encodeURIComponent(existing.id)}` : "/company/jobs",
      {
        method: existing ? "PUT" : "POST",
        body: JSON.stringify(existing ? { ...payload, updatedAt: existing.updatedAt } : payload),
      },
      token,
    );
    if (!res.ok) return { error: await extractErrorMessage(res) };
    return { error: null };
  } catch {
    return { error: "Could not reach the server. Is the backend running?" };
  }
}

/**
 * Pauses ("paused"), resumes ("published") or closes ("closed") a job. The
 * API rejects any move it doesn't allow, so nothing is checked here.
 * `expectedUpdatedAt`, from a form open on the job, makes the API refuse
 * the change (409) if the job has changed since the form loaded it. The
 * returned `updatedAt` is the job's new one: a status change counts as a
 * change, so that form needs it for its next save.
 */
export async function changeJobStatus(
  jobId: string,
  status: "published" | "paused" | "closed",
  expectedUpdatedAt?: string,
): Promise<{ error: string | null; updatedAt: string | null }> {
  try {
    const token = await getAccessToken();
    if (!token) return { error: SIGNED_OUT, updatedAt: null };
    const res = await apiFetch(
      `/company/jobs/${encodeURIComponent(jobId)}/status`,
      {
        method: "POST",
        body: JSON.stringify(
          expectedUpdatedAt ? { status, updatedAt: expectedUpdatedAt } : { status },
        ),
      },
      token,
    );
    if (!res.ok) return { error: await extractErrorMessage(res), updatedAt: null };
    const job: { updated_at: string } = await res.json();
    return { error: null, updatedAt: job.updated_at };
  } catch {
    return { error: "Could not reach the server. Is the backend running?", updatedAt: null };
  }
}
