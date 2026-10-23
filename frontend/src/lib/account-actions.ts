"use server";

import { redirect } from "next/navigation";

import { apiFetch, extractErrorMessage } from "@/lib/auth";
import type { OAuthProvider } from "@/lib/oauth-actions";
import { PASSWORD_MIN_LENGTH } from "@/lib/password-rules";
import { requestOrigin } from "@/lib/request-origin";
import { getAccessToken, getSignInProviders } from "@/lib/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Settings' account actions (KAN-326): the password, the sign-in email, the
 * Google and LinkedIn sign-ins, and Delete Account. Each goes to Supabase
 * Auth, which owns sign-in (backend/CLAUDE.md, Auth), except the delete,
 * which goes through the API so the account's files and rows go too.
 */

export type PasswordState = { error: string | null; changed: boolean };
export type EmailState = { error: string | null; sentTo: string | null };

/** Where Supabase sends the browser back after a link or a confirm email:
 *  the callback, then this Settings path (app/auth/callback/route.ts). */
async function backToSecurity(notice: string): Promise<string> {
  const next = encodeURIComponent(`/settings/security?notice=${notice}`);
  return `${await requestOrigin()}/auth/callback?next=${next}`;
}

function text(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

/**
 * Sets a new password through Supabase Auth. An account that signs in with
 * a password must give the current one first, checked by signing in with
 * it, so a session left open on a shared computer cannot change it and lock
 * the owner out; the fresh sign-in also meets Supabase's "recent sign-in"
 * rule when that is on. A Google- or LinkedIn-only account has no current
 * password, so it sets one without. The server decides which from the
 * account's identities, never from what the form sends.
 */
export async function changePassword(
  _prev: PasswordState,
  formData: FormData,
): Promise<PasswordState> {
  const next = text(formData, "newPassword");
  if (next.length < PASSWORD_MIN_LENGTH) {
    return { error: `Use at least ${PASSWORD_MIN_LENGTH} characters.`, changed: false };
  }
  if (next !== text(formData, "confirmPassword")) {
    return { error: "The new passwords don't match.", changed: false };
  }

  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getClaims();
  const email = data?.claims?.email;
  if (typeof email !== "string") redirect("/login");

  if ((await getSignInProviders()).includes("email")) {
    const signIn = await supabase.auth.signInWithPassword({
      email,
      password: text(formData, "currentPassword"),
    });
    if (signIn.error) {
      const wrong = signIn.error.code === "invalid_credentials";
      return {
        error: wrong ? "Your current password is wrong." : signIn.error.message,
        changed: false,
      };
    }
  }

  const { error } = await supabase.auth.updateUser({ password: next });
  if (error) {
    const same = error.code === "same_password";
    return { error: same ? "Choose a password you don't use now." : error.message, changed: false };
  }
  return { error: null, changed: true };
}

/**
 * Starts a sign-in email change. Supabase emails a confirm link, and the
 * email changes only once it is opened; with "Secure email change" on, a
 * link goes to the old address too and both must be opened. The link
 * returns through the callback to Sign-In & Security. The API copies the
 * new address onto the profile row on the account's next request
 * (backend/app/deps.py).
 */
export async function changeEmail(_prev: EmailState, formData: FormData): Promise<EmailState> {
  const email = text(formData, "email").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { error: "Enter an email address.", sentTo: null };
  }

  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getClaims();
  if (data?.claims?.email === email) {
    return { error: "That is already your sign-in email.", sentTo: null };
  }

  const { error } = await supabase.auth.updateUser(
    { email },
    { emailRedirectTo: await backToSecurity("email") },
  );
  if (error) {
    const taken = error.code === "email_exists";
    return { error: taken ? "Another account uses that email." : error.message, sentTo: null };
  }
  return { error: null, sentTo: email };
}

/**
 * Links a Google or LinkedIn sign-in to this account: off to the provider,
 * then back through the callback to Sign-In & Security. Needs "Manual
 * linking" on in the Supabase dashboard (Authentication, Sign In / Up);
 * without it Supabase refuses, and this says so.
 */
export async function connectProvider(provider: OAuthProvider): Promise<{ error: string }> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.linkIdentity({
    provider,
    options: { redirectTo: await backToSecurity("linked"), skipBrowserRedirect: true },
  });
  if (error || !data?.url) {
    const off = error?.code === "manual_linking_disabled";
    return {
      error: off
        ? "Connecting sign-in methods is turned off for WorkIt right now."
        : (error?.message ?? "Couldn't start connecting. Please try again."),
    };
  }
  redirect(data.url);
}

/** Unlinks a Google or LinkedIn sign-in. Refused when it is the account's
 *  only way to sign in, which would leave nobody able to get back in. */
export async function disconnectProvider(
  provider: OAuthProvider,
): Promise<{ error: string | null }> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getUserIdentities();
  if (error || !data) return { error: "Couldn't read your sign-in methods. Please try again." };

  const identity = data.identities.find((i) => i.provider === provider);
  if (!identity) return { error: null };
  if (data.identities.length < 2) {
    return { error: "This is your only way to sign in. Add another before you disconnect it." };
  }

  const unlinked = await supabase.auth.unlinkIdentity(identity);
  if (unlinked.error) return { error: unlinked.error.message };
  return { error: null };
}

/**
 * Deletes the account for good through DELETE /auth/me, which removes its
 * files and its auth user (and so every row). The session's cookies go
 * after, with local scope: the API already ended the sessions with the
 * user, so a global sign-out would only fail. Then the landing page. The
 * browser clears its local drafts before calling this (lib/local-drafts.ts).
 */
export async function deleteAccount(): Promise<{ error: string }> {
  const token = await getAccessToken();
  if (!token) redirect("/login");

  let res: Response;
  try {
    res = await apiFetch("/auth/me", { method: "DELETE" }, token);
  } catch {
    return { error: "Could not reach the server." };
  }
  if (!res.ok) return { error: await extractErrorMessage(res) };

  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut({ scope: "local" });
  redirect("/");
}
