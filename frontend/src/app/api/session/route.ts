import { NextResponse, type NextRequest } from "next/server";

/**
 * GET /api/session: whether this browser holds a session cookie, for the
 * marketing header's "Open WorkIt" swap (KAN-581, `(landing)/session-swap.tsx`).
 * The marketing pages are static and the sb-* cookies are httpOnly, so the
 * page cannot read them itself; it asks here after it loads.
 *
 * It checks only that an sb-*-auth-token cookie exists (chunked as `.0`,
 * `.1` when large), never its value: no Supabase call, no token in the
 * answer. src/proxy.ts runs first and clears a cookie it cannot refresh, so a
 * dead session answers false. A forged cookie gets an "Open WorkIt" link that
 * /go-home sends on to sign in.
 */
export const dynamic = "force-dynamic";

const SESSION_COOKIE = /^sb-.+-auth-token(\.\d+)?$/;

export function GET(request: NextRequest) {
  const signedIn = request.cookies
    .getAll()
    .some((cookie) => SESSION_COOKIE.test(cookie.name) && cookie.value !== "");
  return NextResponse.json({ signed_in: signedIn }, { headers: { "Cache-Control": "no-store" } });
}
