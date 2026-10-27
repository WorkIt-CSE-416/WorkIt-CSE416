import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { sessionCookieOptions } from "@/lib/supabase/cookies";

/**
 * Keeps the Supabase session fresh. Access tokens are short-lived (an hour by
 * default); `getClaims()` notices an expired one and trades the refresh token
 * for a new pair, and the cookies it writes land on both the request — so
 * this render sees the new token — and the response, so the browser keeps it.
 * @supabase/ssr requires this step: a Server Component cannot write cookies,
 * so without it a session silently dies an hour after sign-in.
 *
 * It runs on every request that renders session-dependent content, not on
 * every request: `config.matcher` below leaves out the static marketing
 * pages. Time spent only on those pages no longer extends the 7-day idle
 * cookie (lib/supabase/cookies.ts); the next app request refreshes it.
 *
 * Not a security boundary. The Python API verifies every token it is handed
 * and is reachable without going through Next at all. A redirect for
 * signed-out users or the seeker/company split can go here as a convenience,
 * but never in place of the API's own check.
 *
 * With no Supabase variables set this does nothing, so a clone with no env
 * file still boots and renders its fixtures.
 */
export async function proxy(request: NextRequest) {
  // The business side is hidden until it ships (KAN-239): every business
  // path lands on /coming-soon. It runs before the env check so a clone with
  // no env file is gated too. Delete this block to bring the business side
  // back, and uncomment the switcher in components/account-type-switcher.tsx.
  if (isBusinessPath(request.nextUrl.pathname)) {
    return NextResponse.redirect(new URL("/coming-soon", request.url));
  }

  // The seeker's Dashboard became Home at /home (2026-10-27). Old links,
  // bookmarks and the browser's own history still name /dashboard, so it
  // moves them on, its query (?range=) kept.
  if (request.nextUrl.pathname === "/dashboard") {
    const home = request.nextUrl.clone();
    home.pathname = "/home";
    return NextResponse.redirect(home, 308);
  }

  let response = NextResponse.next({ request });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return response;

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (cookiesToSet, headers) => {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, sessionCookieOptions(options));
        }
        // No-cache headers, so a CDN never serves one user's fresh session
        // cookie to another.
        for (const [header, value] of Object.entries(headers)) {
          response.headers.set(header, value);
        }
      },
    },
  });

  // Nothing may run between creating the client and this call; it is what
  // triggers the refresh. The result is unused until a route guard lands.
  await supabase.auth.getClaims();

  return response;
}

function isBusinessPath(pathname: string) {
  return isPathUnder(pathname, ["/company", "/onboarding/company"]);
}

/** Whether `pathname` is one of `prefixes` or anything under one. */
function isPathUnder(pathname: string, prefixes: string[]) {
  return prefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

export const config = {
  // Every request that renders session-dependent content: everything except
  // build output and static images, which carry no session, and the static
  // marketing pages. Those are prerendered (app/not-found.tsx says why) and
  // read no session, so the proxy would only add a function call, one that
  // can start cold on Vercel, in front of a page the CDN could serve alone.
  // The pattern ends in `.+` rather than `.*` so the bare "/" (the landing
  // page) is left out too, and each marketing name must be followed by "/"
  // or the end, so /docs/mcp is left out but a seeker path that merely
  // starts with one of the names is not. /login, /signup, /auth/*,
  // /onboarding/*, /company*, /go-home, /dashboard and every seeker path stay
  // matched: they read the session, and the redirects above live here. A
  // new marketing page needs its name added below; one left out still works,
  // with one proxy call more.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|(?:pricing|terms|privacy|features|blog|help-center|docs|coming-soon)(?:/|$)|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).+)",
  ],
};
