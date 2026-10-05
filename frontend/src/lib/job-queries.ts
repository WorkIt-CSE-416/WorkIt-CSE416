import "server-only";

import { apiFetch, extractErrorMessage } from "@/lib/auth";
import type { JobPayload } from "@/lib/job-actions";
import { getAccessToken } from "@/lib/session";

/**
 * Reads of the company's own jobs, for Server Components. Not in
 * ./job-actions.ts on purpose: every export of a "use server" file becomes a
 * public POST endpoint, and these are only ever called during a render, so
 * they stay server-only and that file keeps the mutations.
 */

/** A job as GET /company/jobs/{id} returns it (backend/app/schemas/company_jobs.py's
 *  JobPosting). Responses are snake_case, unlike the camelCase request. */
export type CompanyJob = {
  id: string;
  title: string;
  description: string;
  status: "draft" | "published" | "paused" | "closed";
  job_type: JobPayload["jobType"];
  experience_level: JobPayload["experienceLevel"];
  min_years_experience: number | null;
  work_style: JobPayload["workStyle"];
  location_country: string | null;
  location_state: string | null;
  salary: number | null;
  salary_min: number | null;
  salary_max: number | null;
  salary_currency: string;
  salary_period: JobPayload["salaryPeriod"];
  closes_at: string | null;
  created_at: string;
  /** Sent back unchanged on save, so the API can refuse a save made over
   *  someone else's. Kept as the string the API sent: a Date would drop the
   *  microseconds and never match again. */
  updated_at: string;
};

/** A row of GET /company/jobs: JobPostingSummary, without the description. */
export type CompanyJobSummary = Pick<
  CompanyJob,
  | "id"
  | "title"
  | "status"
  | "work_style"
  | "location_country"
  | "location_state"
  | "closes_at"
  | "created_at"
  | "updated_at"
>;

const SIGNED_OUT = "You're signed out. Sign in again to continue.";
const UNREACHABLE = "Could not reach the server. Is the backend running?";

/** The API's largest page; a shorter page is the last one. */
const PAGE_SIZE = 200;

/** Every job the company has, newest first. The table filters and sorts on
 *  the client, so it needs them all; the API caps each request instead. */
export async function listCompanyJobs(): Promise<{
  jobs: CompanyJobSummary[];
  error: string | null;
}> {
  try {
    const token = await getAccessToken();
    if (!token) return { jobs: [], error: SIGNED_OUT };

    const jobs: CompanyJobSummary[] = [];
    // Offset paging shifts by one if a job is posted mid-way, which would
    // show the row at the page boundary twice. Skipping ids already seen
    // closes that; a job posted mid-way just waits for the next load.
    const seen = new Set<string>();
    for (let offset = 0; ; offset += PAGE_SIZE) {
      const res = await apiFetch(
        `/company/jobs?limit=${PAGE_SIZE}&offset=${offset}`,
        { method: "GET" },
        token,
      );
      if (!res.ok) return { jobs: [], error: await extractErrorMessage(res) };
      const page: CompanyJobSummary[] = await res.json();
      for (const job of page) {
        if (!seen.has(job.id)) jobs.push(job);
        seen.add(job.id);
      }
      if (page.length < PAGE_SIZE) return { jobs, error: null };
    }
  } catch {
    return { jobs: [], error: UNREACHABLE };
  }
}

/** One of the company's jobs. `job` is null with no error when it doesn't
 *  exist or belongs to another company, which the page shows as a 404. */
export async function getCompanyJob(
  jobId: string,
): Promise<{ job: CompanyJob | null; error: string | null }> {
  try {
    const token = await getAccessToken();
    if (!token) return { job: null, error: SIGNED_OUT };
    const res = await apiFetch(
      `/company/jobs/${encodeURIComponent(jobId)}`,
      { method: "GET" },
      token,
    );
    // 422 is a malformed id, which can't name a job either.
    if (res.status === 404 || res.status === 422) return { job: null, error: null };
    if (!res.ok) return { job: null, error: await extractErrorMessage(res) };
    return { job: await res.json(), error: null };
  } catch {
    return { job: null, error: UNREACHABLE };
  }
}
