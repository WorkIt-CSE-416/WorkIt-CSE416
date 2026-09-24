import "server-only";

import { cookies } from "next/headers";

/**
 * Talks to the Python API (backend/) from Server Actions only — never from a
 * Client Component. Everything here runs on the Next server, so this is a
 * server-to-server call the browser never sees directly: no CORS to
 * configure on the API side, and the session token never reaches client JS.
 * See backend/db/auth_implementation_log.md's Stage 7 note for why this
 * shape was chosen over a Client Component calling the API directly.
 */

const API_URL = process.env.API_URL ?? "http://localhost:8000";

/**
 * Name duplicated from backend/app/security.py's SESSION_COOKIE_NAME, and
 * the max-age from SESSION_TTL there. The two halves share no code, so this
 * pair is the wire contract, not a value either side can import — if one
 * changes, the other has to change with it.
 */
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

export function apiFetch(path: string, init: RequestInit): Promise<Response> {
  return fetch(`${API_URL}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...init.headers },
  });
}

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

/**
 * Pulls a human-readable message out of a failed API response. FastAPI's
 * HTTPException serializes `detail` as a string (signup/login's 409/401/501),
 * but Pydantic validation failures (422) serialize it as an array of error
 * objects instead — both are handled here so callers don't have to know
 * which shape they got.
 */
export async function extractErrorMessage(response: Response): Promise<string> {
  const body: unknown = await response.json().catch(() => null);
  const detail = (body as { detail?: unknown } | null)?.detail;

  if (typeof detail === "string") return detail;
  if (Array.isArray(detail) && typeof detail[0]?.msg === "string") return detail[0].msg;

  return "Something went wrong. Please try again.";
}
