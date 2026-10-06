"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Supabase's provider ids — "linkedin_oidc" rather than "linkedin" because
 * Supabase deprecated the old scope-based LinkedIn provider in favor of
 * LinkedIn's own "Sign In with LinkedIn using OpenID Connect" product.
 */
export type OAuthProvider = "google" | "linkedin_oidc";

/**
 * Starts a Google or LinkedIn sign-in from /login or /signup. Shared by
 * both screens' buttons rather than living beside either — same reasoning
 * as src/lib/resume-actions.ts and src/lib/job-actions.ts.
 *
 * signInWithOAuth() normally navigates the browser itself, which a Server
 * Action can't do — skipBrowserRedirect keeps it from trying, and this
 * action redirects to the provider's own URL instead. The provider then
 * sends the browser back to /auth/callback (route.ts), which exchanges the
 * code for a session and decides where to send the user next.
 */
export async function signInWithOAuth(provider: OAuthProvider): Promise<void> {
  const headersList = await headers();
  const host = headersList.get("x-forwarded-host") ?? headersList.get("host");
  const protocol = headersList.get("x-forwarded-proto") ?? "http";
  const origin = `${protocol}://${host}`;

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider,
    options: {
      redirectTo: `${origin}/auth/callback`,
      skipBrowserRedirect: true,
      // Without this, Google silently reuses the last account picked in
      // this browser on every retry. That's invisible when it works, but
      // when that account hits Google's "Access blocked" screen (an
      // unverified-app or not-a-test-user rejection, decided entirely on
      // Google's side before anything redirects back here), pressing the
      // button again reopens the *same* account and the *same* block —
      // it looks like retrying does nothing. prompt: "select_account"
      // forces Google's account chooser open every time, so a blocked
      // attempt can be retried with a different account instead of
      // repeating the same dead end. LinkedIn's OIDC prompt support isn't
      // the same, so this stays Google-only rather than guessed at.
      ...(provider === "google" && { queryParams: { prompt: "select_account" } }),
    },
  });

  if (error || !data.url) {
    redirect("/login?error=oauth");
  }

  redirect(data.url);
}
