import type { CookieOptions } from "@supabase/ssr";

/**
 * Seven days, counted from the last refresh. @supabase/ssr rewrites the
 * cookie each time the hour-long access token is refreshed, so this is an
 * idle limit: a week without a visit signs you out, regular use never does.
 */
const SESSION_MAX_AGE = 7 * 24 * 60 * 60;

/**
 * The options every sb-* cookie is written with. Both places that write them,
 * src/proxy.ts and supabase/server.ts, pass each cookie through this.
 *
 * httpOnly: nothing in the browser reads the session. Every Supabase call
 * runs on the server, so page scripts have no reason to see the tokens, and
 * an XSS bug can't steal them. A createBrowserClient() would need this off.
 *
 * maxAge is set here, not through createServerClient's `cookieOptions`:
 * @supabase/ssr 0.12 ignores that maxAge and writes its 400-day default.
 * A maxAge of 0 is a deletion (sign-out, a stale chunk) and is left alone.
 */
export function sessionCookieOptions(options: CookieOptions): CookieOptions {
  return {
    ...options,
    httpOnly: true,
    maxAge: options.maxAge === 0 ? 0 : SESSION_MAX_AGE,
  };
}
