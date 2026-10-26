import { NextResponse, type NextRequest } from "next/server";

import { apiFetch, homePath, type OAuthStatus } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Where Google/LinkedIn send the browser back after `signInWithOAuth`
 * (src/lib/oauth-actions.ts). Trades the auth code for a session, then asks
 * the API whether this identity has already picked Applicant or Company —
 * a brand-new OAuth sign-in hasn't, since Supabase creates `auth.users`
 * itself and never goes through `POST /auth/signup` (backend/CLAUDE.md's
 * Auth section).
 */
// Logged server-side and echoed as ?reason= on the bounce-back to /login —
// error=oauth alone gave no way to tell a PKCE/redirect-URL misconfiguration
// in Supabase apart from the API being unreachable apart from reading this
// route's own source. Never put the Supabase/API error's own message in the
// query string — it can carry provider-specific detail that doesn't belong
// in a URL the browser's address bar and history keep.
function bounceToLogin(origin: string, reason: string, detail?: unknown): NextResponse {
  console.error(`[auth/callback] ${reason}`, detail ?? "");
  return NextResponse.redirect(`${origin}/login?error=oauth&reason=${reason}`);
}

/**
 * `?next=` sends a signed-in account back to Settings instead of its home:
 * linking Google or LinkedIn and confirming a new sign-in email both come
 * through here (KAN-326, lib/account-actions.ts). Only a path under
 * /settings/ is followed, so the parameter cannot send anyone off the site.
 */
function settingsPath(next: string | null): string | null {
  return next?.startsWith("/settings/") && !next.includes("//") ? next : null;
}

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const origin = request.nextUrl.origin;
  const next = settingsPath(request.nextUrl.searchParams.get("next"));

  if (!code && next && request.nextUrl.searchParams.get("message")) {
    // Supabase's secure email change: the first of the two confirm links
    // (one to each address) answers with a message and no code. The change
    // waits for the second link.
    return NextResponse.redirect(`${origin}/settings/security?notice=email-pending`);
  }

  if (!code) {
    // Google/LinkedIn append ?error=... instead of ?code=... when the user
    // denies consent or the provider itself rejects the request — surface
    // that instead of a bare "no code" if it's there.
    const providerError =
      request.nextUrl.searchParams.get("error_description") ??
      request.nextUrl.searchParams.get("error");
    return bounceToLogin(origin, "no_code", providerError);
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);

  if (error || !data.session) {
    // The most common cause here: the PKCE code_verifier cookie set by
    // signInWithOAuth (src/lib/oauth-actions.ts) wasn't present on this
    // request, or this exact callback URL isn't in the Supabase project's
    // Authentication -> URL Configuration -> Redirect URLs allow-list, so
    // Supabase itself refused to hand back a valid code.
    return bounceToLogin(origin, "exchange_failed", error?.message ?? error?.code);
  }

  const response = await apiFetch(
    "/auth/oauth/status",
    { method: "GET" },
    data.session.access_token,
  );
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
    return NextResponse.redirect(`${origin}/signup/choose-account-type`);
  }

  if (next && oauthStatus.account) return NextResponse.redirect(`${origin}${next}`);

  // A returning sign-in. A first sign-in went to choose-account-type above,
  // which starts an applicant on onboarding. With no account the API said
  // nothing useful, so the Dashboard's own sign-in check takes it from there.
  const destination = oauthStatus.account ? homePath(oauthStatus.account) : "/dashboard";
  return NextResponse.redirect(`${origin}${destination}`);
}
