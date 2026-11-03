import { NextResponse, type NextRequest } from "next/server";

import { bounceToLogin, finishOAuthSignIn } from "@/lib/oauth-finish";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Where Google/LinkedIn send the browser back after `signInWithOAuth`
 * (src/lib/oauth-actions.ts). Trades the auth code for a session, then asks
 * the API whether this identity has already picked Applicant or Company —
 * a brand-new OAuth sign-in hasn't, since Supabase creates `auth.users`
 * itself and never goes through `POST /auth/signup` (backend/CLAUDE.md's
 * Auth section).
 */
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

  return finishOAuthSignIn(supabase, origin, data.session.access_token, next);
}
