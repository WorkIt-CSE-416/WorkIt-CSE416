"use server";

import { redirect } from "next/navigation";

import {
  apiFetch,
  extractErrorMessage,
  relaySessionCookie,
  type AuthenticatedAccount,
} from "@/lib/auth";

export type SignupState = { error: string | null };

/**
 * Real signup mutation, applicant accounts only. Calls POST /auth/signup
 * (backend/app/routers/auth.py) and relays the session cookie it sets.
 *
 * Company accounts still hit this same call — the API returns 501 for
 * `accountType: "company"` (no screen collects a company name yet, see
 * backend/db/auth_methodology.md §2 decision 4) and that response's own
 * message is what reaches the user via extractErrorMessage(), so this file
 * doesn't special-case company at all.
 */
export async function createAccount(
  _prevState: SignupState,
  formData: FormData,
): Promise<SignupState> {
  // The form collects three name parts (see page.tsx); the API's
  // SignupRequest takes one `name` field aliased onto full_name.
  const name = [formData.get("firstName"), formData.get("middleName"), formData.get("lastName")]
    .filter((part): part is string => typeof part === "string" && part.trim().length > 0)
    .join(" ");

  const response = await apiFetch("/auth/signup", {
    method: "POST",
    body: JSON.stringify({
      accountType: formData.get("accountType"),
      name,
      email: formData.get("email"),
      password: formData.get("password"),
    }),
  });

  if (!response.ok) {
    return { error: await extractErrorMessage(response) };
  }

  await relaySessionCookie(response);
  const account: AuthenticatedAccount = await response.json();

  // A brand-new account is never past onboarding — no onboarding_completed
  // branch to check here, unlike login's redirect below.
  redirect(`/onboarding/${account.account_type}`);
}
