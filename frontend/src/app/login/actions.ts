"use server";

import { redirect } from "next/navigation";

import { apiFetch, extractErrorMessage, homePath, type AuthenticatedAccount } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const TURNSTILE_SECRET = process.env.TURNSTILE_SECRET_KEY;
const TURNSTILE_VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

/** Null when the token passes, else the message to show. Same 5s limit and
 *  messages as the API's _verify_turnstile, so a slow or down Cloudflare
 *  reads as a retry, not a crashed action. */
async function verifyTurnstile(token: string | null): Promise<string | null> {
  if (!TURNSTILE_SECRET) return null; // skip in local dev
  if (!token) return "CAPTCHA verification required.";
  try {
    const resp = await fetch(TURNSTILE_VERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ secret: TURNSTILE_SECRET, response: token }),
      signal: AbortSignal.timeout(5000),
    });
    const data = await resp.json();
    return data.success === true ? null : "CAPTCHA verification failed. Please try again.";
  } catch (error) {
    console.error("[login] Turnstile verification request failed:", error);
    return "CAPTCHA verification is temporarily unavailable. Please try again.";
  }
}

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

// login with supabase Auth
export async function signIn(_prevState: LoginState, formData: FormData): Promise<LoginState> {
  const email = formData.get("email");
  const emailValue = typeof email === "string" ? email : "";
  const password = formData.get("password");

  const turnstileToken = formData.get("cf-turnstile-response");
  const captchaError = await verifyTurnstile(
    typeof turnstileToken === "string" ? turnstileToken : null,
  );
  if (captchaError) return { error: captchaError, email: emailValue };

  const supabase = await createSupabaseServerClient();

  // attempt to login and get the cookie
  const { data, error } = await supabase.auth.signInWithPassword({
    email: emailValue.trim().toLowerCase(), // all email is saved with lowercase in db
    password: typeof password === "string" ? password : "",
  });

  if (error) {
    const message = error.code === "invalid_credentials" ? INVALID_CREDENTIALS : error.message;
    return { error: message, email: emailValue };
  }

  // get user information
  const response = await apiFetch("/auth/me", { method: "GET" }, data.session.access_token);
  const account: AuthenticatedAccount | null = response.ok ? await response.json() : null;

  if (account?.account_type !== formData.get("accountType")) {
    // user is logged into the wrong type with supabase already auth
    // remove current browser token to sign them out
    await supabase.auth.signOut({ scope: "local" });
    // display error message
    const message =
      account || response.status === 401
        ? INVALID_CREDENTIALS
        : await extractErrorMessage(response);
    return { error: message, email: emailValue };
  }

  redirect(nextPath(formData.get("next")) ?? homePath(account));
}

/** Where a sign-in started from another page goes back to (`/login?next=`):
 *  only the connector's consent page (KAN-377), so the link can't send a
 *  student anywhere else. */
function nextPath(next: FormDataEntryValue | null): string | null {
  return typeof next === "string" && next.startsWith("/connect/claude?") ? next : null;
}
