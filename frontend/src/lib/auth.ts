'Handles all communication between Next.js frontend and Python backend for auth-related items'

import "server-only";

import { cookies } from "next/headers";


const SESSION_COOKIE_NAME = "session_token";
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

export type AccountType = "applicant" | "company";

/** Mirrors backend/app/schemas/auth.py's AuthenticatedAccount field-for-field
 * (snake_case included) — that response has no alias layer, so there is
 * nothing to translate here. */
export type AuthenticatedAccount = {
  id: string;
  email: string;
  full_name: string;
  account_type: AccountType;
  onboarding_completed: boolean;
  company_id: string | null;
};



/**
 * Copies the session cookie /auth/signup or /auth/login set on `response`
 * onto this request's own outgoing cookies. A server-to-server fetch's
 * Set-Cookie header does not reach the browser on its own — Next has to
 * re-set it as its own cookie for the browser to ever see it.
 */
export async function relaySessionCookie(response: Response): Promise<void> {
  const setCookie = response.headers
    .getSetCookie()
    .find((cookie) => cookie.startsWith(`${SESSION_COOKIE_NAME}=`));
  if (!setCookie) return;

  const nameAndValue = setCookie.split(";")[0];
  const token = nameAndValue.slice(nameAndValue.indexOf("=") + 1);

  (await cookies()).set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: SESSION_MAX_AGE_SECONDS,
    path: "/",
  });
}

// Pulls a human-readable message out of a failed API response.
export async function extractErrorMessage(response: Response): Promise<string> {
  const body: unknown = await response.json().catch(() => null);
  const detail = (body as { detail?: unknown } | null)?.detail;

  if (typeof detail === "string") return detail;
  if (Array.isArray(detail) && typeof detail[0]?.msg === "string") return detail[0].msg;

  return "Something went wrong. Please try again.";
}
