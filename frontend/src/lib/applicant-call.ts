import "server-only";

import { apiFetch, extractErrorMessage } from "@/lib/auth";
import { getApplicantSession } from "@/lib/session";

/**
 * One call to an `/applicants/{id}/...` route as the signed-in applicant,
 * answered as `{ data, error }` rather than thrown, so a screen can show what
 * went wrong in place. Shared by the server actions that need it
 * (experience-actions.ts, latex-actions.ts); a "use server" file can export
 * only actions, so it lives here.
 */
export type Result<T> = { data: T; error: null } | { data: null; error: string };

const OFFLINE = "Could not reach the server. Is the backend running?";

export async function call<T>(path: string, init: RequestInit): Promise<Result<T>> {
  try {
    const { id, token } = await getApplicantSession();
    const res = await apiFetch(`/applicants/${id}${path}`, init, token);
    if (!res.ok) return { data: null, error: await extractErrorMessage(res) };
    return { data: res.status === 204 ? (null as T) : ((await res.json()) as T), error: null };
  } catch {
    return { data: null, error: OFFLINE };
  }
}
