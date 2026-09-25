"use server";

import { redirect } from "next/navigation";

import { apiFetch, extractErrorMessage, type AuthenticatedAccount } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";

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
 * Sign up with 2 steps (for job_applicants)
 *
 * 1. POST /auth/signup (backend/app/routers/auth.py) creates the Supabase
 *    auth user and the profile row. It goes through the API rather than
 *    `supabase.auth.signUp()` because only the API can set the account type
 *    where the user can't edit it
 * 2. signInWithPassword() starts the session, setting Supabase's cookies.
 
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

  // clear the white spaces  
  const name = [firstName, middleName, lastName]
    .map((part) => part.trim())  
    .filter((part) => part.trim().length > 0)
    .join(" ");

  
  const password = fieldValue(formData, "password");

  // create the user in backend with supabase
  const response = await apiFetch("/auth/signup", {
    method: "POST",
    body: JSON.stringify({ accountType: formData.get("accountType"), name, email, password }),
  });

  if (!response.ok) {
    return { error: await extractErrorMessage(response), firstName, middleName, lastName, email };
  }

  const account: AuthenticatedAccount = await response.json();

  // user finishes sign up, logs in and issue token 
  const supabase = await createSupabaseServerClient();

  // sign in with the created user, supabase issues the token 
  const { error } = await supabase.auth.signInWithPassword({ email: account.email, password });
  if (error) {
    return {
      error: "Your account was created, but signing in failed. Please log in again.",
      firstName,
      middleName,
      lastName,
      email,
    };
  }

  // A brand-new account is never past onboarding — no onboarding_completed
  // branch to check here, unlike login's redirect below.
  redirect(`/onboarding/${account.account_type}`);
}
