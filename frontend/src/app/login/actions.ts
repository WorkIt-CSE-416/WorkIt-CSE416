"use server";

import { redirect } from "next/navigation";

import { apiFetch } from "@/lib/api";
import { extractErrorMessage, relaySessionCookie, type AuthenticatedAccount } from "@/lib/auth";

// `email` round-trips the submitted value back into the form on failure.
// React resets a useActionState-bound form's uncontrolled fields once the
// action completes, wrong password included, so without this the email a
// user just typed would vanish along with the error telling them it failed.
// `password` deliberately isn't carried back — echoing a submitted password
// into a form field is the one field worth losing on a failed attempt.
export type LoginState = { error: string | null; email: string };

/**
 * Real sign-in mutation. Calls POST /auth/login (backend/app/routers/auth.py)
 * and relays the session cookie it sets — see src/lib/auth.ts for why that's
 * a manual step rather than something fetch does on its own.
 *
 * The redirect below is what the docblock in the original stub described:
 * a seeker goes to /jobs and a company to /company, except now it reads
 * account_type and onboarding_completed off the API's response instead of
 * trusting the submitted form field — a client can lie about accountType,
 * but not about which row the API found by email.
 *
 * The guard that keeps each account type out of the other's screens still
 * belongs in a root middleware.ts, not here — that hasn't been written yet.
 */
export async function signIn(_prevState: LoginState, formData: FormData): Promise<LoginState> {
  const email = formData.get("email");
  const emailValue = typeof email === "string" ? email : "";

  const response = await apiFetch("/auth/login", {
    method: "POST",
    body: JSON.stringify({
      accountType: formData.get("accountType"),
      email,
      password: formData.get("password"),
    }),
  });

  if (!response.ok) {
    return { error: await extractErrorMessage(response), email: emailValue };
  }

  await relaySessionCookie(response);
  const account: AuthenticatedAccount = await response.json();

  if (!account.onboarding_completed) {
    redirect(`/onboarding/${account.account_type}`);
  }
  redirect(account.account_type === "company" ? "/company" : "/jobs");
}
