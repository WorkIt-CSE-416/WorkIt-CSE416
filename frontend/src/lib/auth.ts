// Handles all communication between Next.js frontend and Python backend for auth-related items

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

/** Where a signed-in account lands: the business side for a company,
 *  onboarding for an applicant who hasn't finished it, the Dashboard after.
 *  Password sign-in, the OAuth callback, and /login and /signup for someone
 *  already signed in all send them here. */
export function homePath(account: AuthenticatedAccount): string {
  if (account.account_type === "company") return "/company";
  return account.onboarding_completed ? "/dashboard" : "/onboarding/applicant";
}

/** GET /auth/oauth/status's shape — what /auth/callback checks after a
 *  Google/LinkedIn redirect to decide between Choose Account Type and the
 *  same destination a password sign-in would land on. */
export type OAuthStatus = {
  needs_account_type: boolean;
  account: AuthenticatedAccount | null;
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
 * error objects instead, and a refusal that also names a row sends an object
 * with its `message` (the duplicate resume 409s, KAN-267). All three are
 * handled here so callers don't have to know which shape they got.
 */
export async function extractErrorMessage(response: Response): Promise<string> {
  return errorMessage(await response.json().catch(() => null));
}

/** `extractErrorMessage` for a body already read, by a caller that needs
 *  more of it than the message. */
export function errorMessage(body: unknown): string {
  const detail = (body as { detail?: unknown } | null)?.detail;

  if (typeof detail === "string") return detail;
  if (Array.isArray(detail) && typeof detail[0]?.msg === "string") return detail[0].msg;
  const message = (detail as { message?: unknown } | null)?.message;
  if (typeof message === "string") return message;

  return "Something went wrong. Please try again.";
}
