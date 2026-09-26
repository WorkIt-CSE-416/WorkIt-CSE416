import "server-only";

/**
 * Send authorization requests for login or sign up to backend
 */

const API_URL = process.env.API_URL ?? "http://localhost:8000";

export type AccountType = "applicant" | "company";


export type AuthenticatedAccount = {
  id: string;
  email: string;
  full_name: string;
  account_type: AccountType;
  onboarding_completed: boolean;
  company_id: string | null;
};

/**
 * `accessToken` is the Supabase session's access token
 */
export function apiFetch(path: string, init: RequestInit, accessToken?: string): Promise<Response> {
  return fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      // send accessToken to backend, otherwise the header is empty
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      ...init.headers,
    },
  });
}

/**
 * Pulls a human-readable message out of a failed API response. FastAPI's
 * HTTPException serializes `detail` as a string (signup's 409/501, /me's
 * 401), but Pydantic validation failures (422) serialize it as an array of
 * error objects instead — both are handled here so callers don't have to
 * know which shape they got.
 */
export async function extractErrorMessage(response: Response): Promise<string> {
  const body: unknown = await response.json().catch(() => null);
  const detail = (body as { detail?: unknown } | null)?.detail;

  if (typeof detail === "string") return detail;
  if (Array.isArray(detail) && typeof detail[0]?.msg === "string") return detail[0].msg;

  return "Something went wrong. Please try again.";
}
