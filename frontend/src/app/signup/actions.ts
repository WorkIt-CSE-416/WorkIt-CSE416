"use server";

import { redirect } from "next/navigation";

import {
  apiFetch,
  extractErrorMessage,
  relaySessionCookie,
  type AuthenticatedAccount,
} from "@/lib/auth";

// firstName/middleName/lastName/email round-trip the submitted values back
// into the form on failure. React resets a useActionState-bound form's
// uncontrolled fields once the action completes, so without this an error
// (a taken email, say) would wipe every field the user just typed along with
// it. password/confirmPassword don't need this — signup-form.tsx already
// keeps them in local state, and echoing a password back isn't good practice
// regardless.
export type SignupState = {
  error: string | null;
  firstName: string;
  middleName: string;
  lastName: string;
  email: string;
};

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
function fieldValue(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

export async function createAccount(
  _prevState: SignupState,
  formData: FormData,
): Promise<SignupState> {
  const firstName = fieldValue(formData, "firstName");
  const middleName = fieldValue(formData, "middleName");
  const lastName = fieldValue(formData, "lastName");
  const email = fieldValue(formData, "email");

  // The form collects three name parts (see page.tsx); the API's
  // SignupRequest takes one `name` field aliased onto full_name.
  const name = [firstName, middleName, lastName]
    .filter((part) => part.trim().length > 0)
    .map((part) => part.trim())
    .join(" ");

  const response = await apiFetch("/auth/signup", {
    method: "POST",
    body: JSON.stringify({
      accountType: formData.get("accountType"),
      name,
      email,
      password: formData.get("password"),
    }),
  });

  if (!response.ok) {
    return { error: await extractErrorMessage(response), firstName, middleName, lastName, email };
  }

  await relaySessionCookie(response);
  const account: AuthenticatedAccount = await response.json();

  // A brand-new account is never past onboarding — no onboarding_completed
  // branch to check here, unlike login's redirect below.
  redirect(`/onboarding/${account.account_type}`);
}
