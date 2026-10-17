"use server";

import { preferencesBody, type FeedFilters } from "@/app/(seeker)/jobs/filter-query";
import { apiFetch, extractErrorMessage } from "@/lib/auth";
import { getApplicantSession } from "@/lib/session";

/**
 * Saves onboarding's answers as the seeker's job preferences (PUT
 * /applicants/{id}/preferences), which also marks onboarding complete
 * (KAN-231). Like every server action this is a public endpoint, so the
 * identity comes from the session, never an argument, and the API validates
 * the body as strictly as it validates GET /jobs' query.
 */
export async function savePreferences(filters: FeedFilters): Promise<{ error: string | null }> {
  try {
    const { id, token } = await getApplicantSession();
    const res = await apiFetch(
      `/applicants/${id}/preferences`,
      { method: "PUT", body: JSON.stringify(preferencesBody(filters)) },
      token,
    );
    return { error: res.ok ? null : await extractErrorMessage(res) };
  } catch {
    return { error: "Could not reach the server. Is the backend running?" };
  }
}
