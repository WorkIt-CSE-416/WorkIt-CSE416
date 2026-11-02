import { type NextRequest, NextResponse } from "next/server";

import { needsRotation } from "@/lib/session-refresh";
import { createSupabaseServerClient } from "@/lib/supabase/server";

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
 * No token is in the answer, only whether a session is signed in.
 */
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const force = request.nextUrl.searchParams.get("force") === "1";
  const supabase = await createSupabaseServerClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  let signedIn = Boolean(session);
  if (session && needsRotation(session.expires_at, Date.now(), { force })) {
    const { data, error } = await supabase.auth.refreshSession();
    signedIn = !error && Boolean(data.session);
  }

  return NextResponse.json(
    { signed_in: signedIn },
    { status: signedIn ? 200 : 401, headers: { "Cache-Control": "no-store" } },
  );
}
