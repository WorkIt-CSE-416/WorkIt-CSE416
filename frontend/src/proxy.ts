import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Keeps the Supabase session fresh. Access tokens are short-lived (an hour by
 * default); `getClaims()` notices an expired one and trades the refresh token
 * for a new pair, and the cookies it writes land on both the request — so
 * this render sees the new token — and the response, so the browser keeps it.
 * @supabase/ssr requires this step: a Server Component cannot write cookies,
 * so without it a session silently dies an hour after sign-in.
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
          response.cookies.set(name, value, options);
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

export const config = {
  // Everything except build output and static images, which carry no session.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
