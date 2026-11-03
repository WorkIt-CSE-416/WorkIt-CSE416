/**
 * Google sign-in through WorkIt's own callback instead of Supabase's.
 *
 * Through Supabase's OAuth, Google sends the browser back to
 * `<ref>.supabase.co/auth/v1/callback`, so Google's account chooser reads
 * "to continue to zhdrvdrojipkluhzgsea.supabase.co". Google names the
 * redirect's domain until the app's brand is verified, and a brand can only
 * be verified on a domain WorkIt owns. So Google sends the browser to
 * `<origin>/auth/google/callback` instead, the server trades the code for
 * Google's ID token, and `supabase.auth.signInWithIdToken()` (or
 * `linkIdentity()` from Settings) turns that into the same Supabase session.
 *
 * Pure helpers only, so `google-oauth.test.ts` runs under `node --test`: the
 * server action is in `oauth-actions.ts`, the callback in
 * `app/auth/google/callback/route.ts`.
 */

/** The httpOnly cookie that carries a sign-in's state and nonce to the callback. */
export const GOOGLE_FLOW_COOKIE = "workit-google-oauth";

/** What the cookie holds. `mode` "link" connects Google from Settings. */
export type GoogleFlow = {
  state: string;
  nonce: string;
  mode: "sign-in" | "link";
};

export function googleRedirectUri(origin: string): string {
  return `${origin}/auth/google/callback`;
}

/** 32 random bytes as hex: the CSRF state, and the raw nonce. */
export function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Google gets the nonce's SHA-256 in hex and Supabase gets the raw nonce:
 * Supabase hashes what it is given and compares it with the ID token's
 * `nonce` claim (Supabase's "Sign in with Google" guide, ID token flow).
 */
export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

export function googleAuthUrl(params: {
  clientId: string;
  redirectUri: string;
  state: string;
  hashedNonce: string;
}): string {
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.search = new URLSearchParams({
    client_id: params.clientId,
    redirect_uri: params.redirectUri,
    response_type: "code",
    scope: "openid email profile",
    state: params.state,
    nonce: params.hashedNonce,
    // Opens Google's account chooser every time, so an account Google blocks
    // can be retried with another one (docs/auth.md, prompt: select_account).
    prompt: "select_account",
  }).toString();
  return url.toString();
}

/** The cookie's flow, or null when it is missing, unreadable or the wrong shape. */
export function readGoogleFlow(cookie: string | undefined): GoogleFlow | null {
  if (!cookie) return null;
  try {
    const flow = JSON.parse(cookie) as Partial<GoogleFlow>;
    if (typeof flow.state !== "string" || typeof flow.nonce !== "string") return null;
    if (flow.mode !== "sign-in" && flow.mode !== "link") return null;
    return { state: flow.state, nonce: flow.nonce, mode: flow.mode };
  } catch {
    return null;
  }
}
