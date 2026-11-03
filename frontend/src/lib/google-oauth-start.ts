import "server-only";

import { cookies } from "next/headers";

import {
  GOOGLE_FLOW_COOKIE,
  googleAuthUrl,
  googleRedirectUri,
  randomToken,
  sha256Hex,
  type GoogleFlow,
} from "@/lib/google-oauth";
import { requestOrigin } from "@/lib/request-origin";

/**
 * The Google OAuth client, the same one set on Supabase's Google provider:
 * Supabase accepts an ID token only when its audience is that client ID.
 * Server-only, never NEXT_PUBLIC_*. Null when either is unset, and the
 * caller falls back to Supabase's own OAuth (a local clone with no Google
 * secret still signs in, through the supabase.co callback).
 */
export function googleClient(): { id: string; secret: string } | null {
  const id = process.env.GOOGLE_CLIENT_ID;
  const secret = process.env.GOOGLE_CLIENT_SECRET;
  return id && secret ? { id, secret } : null;
}

/**
 * Starts a Google sign-in (or a Settings link) through WorkIt's own
 * callback: stores a fresh state and nonce in a short-lived httpOnly cookie
 * and returns Google's consent URL to redirect to. Null when the Google
 * client isn't configured. See lib/google-oauth.ts for why.
 */
export async function startGoogleFlow(mode: GoogleFlow["mode"]): Promise<string | null> {
  const client = googleClient();
  if (!client) return null;

  const flow: GoogleFlow = { state: randomToken(), nonce: randomToken(), mode };
  const cookieStore = await cookies();
  cookieStore.set(GOOGLE_FLOW_COOKIE, JSON.stringify(flow), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    // Lax still sends it on Google's top-level redirect back to the callback.
    sameSite: "lax",
    path: "/auth/google",
    maxAge: 10 * 60,
  });

  return googleAuthUrl({
    clientId: client.id,
    redirectUri: googleRedirectUri(await requestOrigin()),
    state: flow.state,
    hashedNonce: await sha256Hex(flow.nonce),
  });
}
