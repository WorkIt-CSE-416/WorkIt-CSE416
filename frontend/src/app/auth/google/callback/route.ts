import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";

import { GOOGLE_FLOW_COOKIE, googleRedirectUri, readGoogleFlow } from "@/lib/google-oauth";
import { googleClient } from "@/lib/google-oauth-start";
import { bounceToLogin, finishOAuthSignIn } from "@/lib/oauth-finish";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Where Google sends the browser back after a sign-in or a Settings link
 * started by lib/google-oauth-start.ts. Checks the state against the
 * cookie, trades the code for Google's ID token, and hands that token to
 * Supabase. A sign-in then finishes as /auth/callback does; a link returns
 * to Sign-In & Security. Why Google skips Supabase's callback:
 * lib/google-oauth.ts.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const origin = request.nextUrl.origin;

  const cookieStore = await cookies();
  const flow = readGoogleFlow(cookieStore.get(GOOGLE_FLOW_COOKIE)?.value);
  cookieStore.delete({ name: GOOGLE_FLOW_COOKIE, path: "/auth/google" });

  const linking = flow?.mode === "link";
  const fail = (reason: string, detail?: unknown) =>
    linking
      ? (console.error(`[oauth] ${reason}`, detail ?? ""),
        NextResponse.redirect(`${origin}/settings/security?notice=link-failed`))
      : bounceToLogin(origin, reason, detail);

  const code = params.get("code");
  if (!code) return fail("no_code", params.get("error_description") ?? params.get("error"));
  // A missing cookie (expired, another browser) fails here too.
  if (!flow || params.get("state") !== flow.state) return fail("bad_state");

  const client = googleClient();
  if (!client) return fail("google_not_configured");

  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: client.id,
      client_secret: client.secret,
      redirect_uri: googleRedirectUri(origin),
      grant_type: "authorization_code",
    }),
  });
  const tokens = (await tokenResponse.json().catch(() => ({}))) as {
    id_token?: string;
    access_token?: string;
    error?: string;
  };
  if (!tokenResponse.ok || !tokens.id_token) {
    return fail("google_token_failed", `${tokenResponse.status} ${tokens.error ?? ""}`.trim());
  }

  // Google's ID token carries an at_hash, which Supabase checks against the
  // access token, so both go.
  const credentials = {
    provider: "google",
    token: tokens.id_token,
    access_token: tokens.access_token,
    nonce: flow.nonce,
  };

  const supabase = await createSupabaseServerClient();

  if (linking) {
    const { error } = await supabase.auth.linkIdentity(credentials);
    if (error) return fail("link_failed", error.code ?? error.message);
    return NextResponse.redirect(`${origin}/settings/security?notice=linked`);
  }

  const { data, error } = await supabase.auth.signInWithIdToken(credentials);
  if (error || !data.session) return fail("id_token_failed", error?.code ?? error?.message);

  return finishOAuthSignIn(supabase, origin, data.session.access_token, null);
}
