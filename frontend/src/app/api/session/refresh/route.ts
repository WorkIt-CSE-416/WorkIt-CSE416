import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";

import { sessionCookieOptions } from "@/lib/supabase/cookies";
import { needsRotation } from "@/lib/session-refresh";

/**
 * GET /api/session/refresh: rotates the signed-in session's tokens and sets
 * the new cookie, for the WorkIt extension (KAN-465). The extension reads
 * the session from this site's sb-* cookie and must never refresh it
 * itself: Supabase rotates the refresh token on each use, and two parties
 * refreshing would race (autofiller_extension/CLAUDE.md's Auth section).
 * So when its access token is near expiry, or the API refuses it, the
 * extension's background calls this route with the cookie and reads the
 * cookie again. This site stays the only party that rotates the token.
 *
 * src/proxy.ts runs first, as on every app request, and refreshes an
 * expired token itself. This route also rotates one inside
 * ROTATE_WITHIN_S, the extension's window, and always with `?force=1`,
 * which the extension sends on its retry after the API answered 401 (a
 * token refused before its expiry would otherwise come back unchanged).
 * With no valid refresh token,
 * Supabase clears the cookie and this answers 401: the extension then
 * shows its signed-out state.
 *
 * **Builds its own Supabase client, never `lib/supabase/server.ts`'s
 * `createSupabaseServerClient()`.** That one's `setAll` silently swallows
 * every cookie write -- correct for the Server Components it's meant for,
 * which truly cannot write cookies, but wrong here: a Route Handler *can*
 * write cookies, and this route's entire job is writing the rotated one.
 * Reusing it meant a rotation that succeeded in Supabase never reached the
 * browser -- this route answered `signed_in: true` while silently sending
 * no new cookie, so the extension re-read the same stale one and stayed
 * signed out. Mirrors src/proxy.ts's own pattern instead: collect the
 * cookie writes and apply them to the response this route actually
 * returns, the same way `NextResponse.next()` does there.
 *
 * No token is in the answer, only whether a session is signed in.
 */
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const force = request.nextUrl.searchParams.get("force") === "1";
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    return NextResponse.json(
      { signed_in: false },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }

  let pendingCookies: { name: string; value: string; options: CookieOptions }[] = [];
  const supabase = createServerClient(url, key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (cookiesToSet) => {
        pendingCookies = cookiesToSet;
      },
    },
  });

  const {
    data: { session },
  } = await supabase.auth.getSession();

  let signedIn = Boolean(session);
  if (session && needsRotation(session.expires_at, Date.now(), { force })) {
    const { data, error } = await supabase.auth.refreshSession();
    signedIn = !error && Boolean(data.session);
  }

  const response = NextResponse.json(
    { signed_in: signedIn },
    { status: signedIn ? 200 : 401, headers: { "Cache-Control": "no-store" } },
  );
  for (const { name, value, options } of pendingCookies) {
    response.cookies.set(name, value, sessionCookieOptions(options));
  }
  return response;
}
