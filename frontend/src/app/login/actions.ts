"use server";

import { redirect } from "next/navigation";

import { apiFetch, extractErrorMessage, type AuthenticatedAccount } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// `email` round-trips the submitted value back into the form on failure.
// React resets a useActionState-bound form's uncontrolled fields once the
// action completes, wrong password included, so without this the email a
// user just typed would vanish along with the error telling them it failed.
// `password` deliberately isn't carried back — echoing a submitted password
// into a form field is the one field worth losing on a failed attempt.
export type LoginState = { error: string | null; email: string };

// Same message for a wrong password, an unknown email and the wrong account
// type — telling them apart lets anyone enumerate registered addresses.
const INVALID_CREDENTIALS = "Invalid email or password.";

/**
 * Real sign-in mutation. Signs in against Supabase Auth directly — the
 * password never reaches the Python API — which sets Supabase's session
 * cookies through src/lib/supabase/server.ts. Then asks GET /auth/me, with
 * the new access token, which account that is.
 *
 * The account type comes from /me, which reads it from app_metadata, never
 * from the submitted form field. The form field only has to agree with it:
 * an applicant signing in on the company tab is refused the same way a wrong
 * password is, which is how login behaved when each type had its own table.
 *
 * The guard that keeps each account type out of the other's screens still
 * belongs in src/proxy.ts, not here — that hasn't been written yet.
 */
export async function signIn(_prevState: LoginState, formData: FormData): Promise<LoginState> {
  const email = formData.get("email");
  const emailValue = typeof email === "string" ? email : "";
  const password = formData.get("password");

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.signInWithPassword({
    email: emailValue.trim().toLowerCase(),
    password: typeof password === "string" ? password : "",
  });

  if (error) {
    const message = error.code === "invalid_credentials" ? INVALID_CREDENTIALS : error.message;
    return { error: message, email: emailValue };
  }

  const response = await apiFetch("/auth/me", { method: "GET" }, data.session.access_token);
  const account: AuthenticatedAccount | null = response.ok ? await response.json() : null;

  if (account?.account_type !== formData.get("accountType")) {
    // The Supabase session is already set; don't leave the user signed in
    // to an account this screen just refused. "local" ends this browser's
    // session only, not the account's sessions elsewhere.
    await supabase.auth.signOut({ scope: "local" });
    // A 401 from /me after a good password means an auth user with no
    // profile behind it (one made in the Supabase dashboard, say) — to
    // this screen, not an account.
    const message =
      account || response.status === 401
        ? INVALID_CREDENTIALS
        : await extractErrorMessage(response);
    return { error: message, email: emailValue };
  }

  if (!account.onboarding_completed) {
    redirect(`/onboarding/${account.account_type}`);
  }
  redirect(account.account_type === "company" ? "/company" : "/jobs");
}
