"use server";

import { redirect } from "next/navigation";

/**
 * Placeholder for the create-account mutation.
 *
 * KAN-114 covers the screen only — real account creation lands with the auth
 * ticket, and this must hash and persist credentials before it does anything.
 * The action exists now so the form POSTs (without it the browser falls back
 * to a GET submit, which would put the password in the URL and the history),
 * and so the one piece of real behaviour this ticket asked for — landing on
 * onboarding — already routes to the right half: an applicant to
 * /onboarding/applicant, a company to /onboarding/company. Wiring the fields
 * into a real submission later touches only this file.
 */
export async function createAccount(formData: FormData) {
  const accountType = formData.get("accountType");
  redirect(accountType === "company" ? "/onboarding/company" : "/onboarding/applicant");
}
