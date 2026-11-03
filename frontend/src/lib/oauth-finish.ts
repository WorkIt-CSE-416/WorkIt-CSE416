import "server-only";

import { NextResponse } from "next/server";

import { apiFetch, homePath, type OAuthStatus } from "@/lib/auth";
import type { createSupabaseServerClient } from "@/lib/supabase/server";

// Logged server-side and echoed as ?reason= on the bounce-back to /login —
// error=oauth alone gave no way to tell a PKCE/redirect-URL misconfiguration
// in Supabase apart from the API being unreachable apart from reading this
// route's own source. Never put the Supabase/API error's own message in the
// query string — it can carry provider-specific detail that doesn't belong
// in a URL the browser's address bar and history keep.
export function bounceToLogin(origin: string, reason: string, detail?: unknown): NextResponse {
  console.error(`[oauth] ${reason}`, detail ?? "");
  return NextResponse.redirect(`${origin}/login?error=oauth&reason=${reason}`);
}

/**
 * The rest of an OAuth sign-in once Supabase has a session: asks the API
 * whether this identity has picked Applicant or Company yet, finishes a new
 * one as an applicant, and redirects. Shared by /auth/callback (Supabase's
 * OAuth, LinkedIn) and /auth/google/callback (Google, through WorkIt's own
 * callback so Google's account chooser names workitjobs.ai).
 */
export async function finishOAuthSignIn(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  origin: string,
  accessToken: string,
  next: string | null,
): Promise<NextResponse> {
  const response = await apiFetch("/auth/oauth/status", { method: "GET" }, accessToken);
  const oauthStatus: OAuthStatus | null = response.ok ? await response.json() : null;

  if (!oauthStatus) {
    // The session exchange worked; the API call after it didn't — check
    // that the backend is running and reachable at API_URL, and that its
    // SUPABASE_URL/SUPABASE_SERVICE_KEY are set (backend/CLAUDE.md's Auth
    // section).
    const body = await response.text().catch(() => "");
    return bounceToLogin(origin, "status_failed", `${response.status} ${body}`.trim());
  }

  if (oauthStatus.needs_account_type) {
    // While the business side is hidden (KAN-239) there is nothing to choose,
    // so the callback finishes the account as an applicant itself (KAN-573)
    // instead of sending it to /signup/choose-account-type, which asked a
    // question with no answer. To bring the choice back, redirect there again.
    const finished = await apiFetch(
      "/auth/oauth/account-type",
      { method: "POST", body: JSON.stringify({ accountType: "applicant" }) },
      accessToken,
    );
    if (!finished.ok) {
      const body = await finished.text().catch(() => "");
      return bounceToLogin(origin, "account_type_failed", `${finished.status} ${body}`.trim());
    }
    // The token was issued before the account type existed: refresh it so it
    // carries the claim, as chooseAccountType does.
    await supabase.auth.refreshSession();
    // A first OAuth sign-in is a new account: onboarding first, as signup.
    return NextResponse.redirect(`${origin}/onboarding/applicant`);
  }

  if (next && oauthStatus.account) return NextResponse.redirect(`${origin}${next}`);

  // A returning sign-in. A first sign-in was finished above and starts on
  // onboarding. With no account the API said
  // nothing useful, so Home's own sign-in check takes it from there.
  const destination = oauthStatus.account ? homePath(oauthStatus.account) : "/home";
  return NextResponse.redirect(`${origin}${destination}`);
}
