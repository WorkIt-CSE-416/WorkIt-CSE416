"use server";

import { apiFetch, extractErrorMessage } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/** POST /company/jobs body. Keys and enum values are the API's, not the
 *  composer's display labels; see backend/app/schemas/jobs.py. */
export type JobPayload = {
  status: "draft" | "published";
  title: string;
  description: string;
  jobType: "full_time" | "part_time" | "contract";
  experienceLevel: "internship" | "new_grad" | "other";
  minYearsExperience: number | null;
  workStyle: "remote" | "hybrid" | "onsite";
  locationCountry: string;
  salary: number | null;
  salaryMin: number | null;
  salaryMax: number | null;
  currency: string;
  salaryPeriod: "year" | "hour";
  /** ISO 8601 with an offset; the API rejects a bare date. */
  closesAt: string | null;
};

/** A job as GET /company/jobs returns it (backend/app/schemas/jobs.py's
 *  JobPosting). Responses are snake_case, unlike the camelCase request. */
export type CompanyJob = {
  id: string;
  title: string;
  description: string;
  status: "draft" | "published" | "closed";
  job_type: JobPayload["jobType"];
  experience_level: JobPayload["experienceLevel"];
  min_years_experience: number | null;
  work_style: JobPayload["workStyle"];
  location_country: string;
  location_state: string | null;
  salary: number | null;
  salary_min: number | null;
  salary_max: number | null;
  salary_currency: string;
  salary_period: JobPayload["salaryPeriod"];
  closes_at: string | null;
  created_at: string;
  updated_at: string;
};

/** The company's access token, forwarded as a Bearer header. The API checks
 *  that it belongs to an active company member, so nothing is decided here. */
async function getAccessToken(): Promise<string | null> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

const SIGNED_OUT = "You're signed out. Sign in again to continue.";

/** Creates a job, or replaces an existing one's details when `jobId` is set. */
export async function saveJob(
  payload: JobPayload,
  jobId?: string,
): Promise<{ error: string | null }> {
  try {
    const token = await getAccessToken();
    if (!token) return { error: SIGNED_OUT };
    const res = await apiFetch(
      jobId ? `/company/jobs/${encodeURIComponent(jobId)}` : "/company/jobs",
      { method: jobId ? "PUT" : "POST", body: JSON.stringify(payload) },
      token,
    );
    if (!res.ok) return { error: await extractErrorMessage(res) };
    return { error: null };
  } catch {
    return { error: "Could not reach the server. Is the backend running?" };
  }
}

export async function listCompanyJobs(): Promise<{ jobs: CompanyJob[]; error: string | null }> {
  try {
    const token = await getAccessToken();
    if (!token) return { jobs: [], error: SIGNED_OUT };
    const res = await apiFetch("/company/jobs", { method: "GET" }, token);
    if (!res.ok) return { jobs: [], error: await extractErrorMessage(res) };
    return { jobs: await res.json(), error: null };
  } catch {
    return { jobs: [], error: "Could not reach the server. Is the backend running?" };
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
    return { job: null, error: "Could not reach the server. Is the backend running?" };
  }
}

/** Moves a job along its lifecycle. Only closing is offered today; the API
 *  rejects any move it doesn't allow, so nothing is checked here. */
export async function changeJobStatus(
  jobId: string,
  status: "closed",
): Promise<{ error: string | null }> {
  try {
    const token = await getAccessToken();
    if (!token) return { error: SIGNED_OUT };
    const res = await apiFetch(
      `/company/jobs/${encodeURIComponent(jobId)}/status`,
      { method: "POST", body: JSON.stringify({ status }) },
      token,
    );
    if (!res.ok) return { error: await extractErrorMessage(res) };
    return { error: null };
  } catch {
    return { error: "Could not reach the server. Is the backend running?" };
  }
}
