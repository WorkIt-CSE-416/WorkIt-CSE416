"use server";

import { preferencesBody, type FeedFilters } from "@/app/(seeker)/jobs/filter-query";
import { apiFetch, extractErrorMessage } from "@/lib/auth";
import { getApplicantSession } from "@/lib/session";

import type { AutofillAnswers } from "./answers";

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

/**
 * Saves the Profile step's answers to the seeker's answer bank (PATCH
 * /applicants/{id}/autofill-answers, KAN-283). Only the keys in `changed` are
 * written, and a null clears one: the API merges them into what it holds, so
 * an answer this page never loaded is never erased. Identity from the
 * session, as above; the API checks each answer against its options.
 */
export async function saveAutofillAnswers(
  changed: Partial<AutofillAnswers>,
): Promise<{ error: string | null }> {
  if (Object.keys(changed).length === 0) return { error: null };
  try {
    const { id, token } = await getApplicantSession();
    const res = await apiFetch(
      `/applicants/${id}/autofill-answers`,
      { method: "PATCH", body: JSON.stringify(changed) },
      token,
    );
    return { error: res.ok ? null : await extractErrorMessage(res) };
  } catch {
    return { error: "Could not reach the server. Is the backend running?" };
  }
}
