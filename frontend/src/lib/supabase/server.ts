import "server-only";

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/**
 * A Supabase client scoped to the current request, for READING the session.
 *
 * NOTHING CALLS THIS YET, and whether it survives is an open decision: the team
 * has not settled whether Supabase Auth issues our tokens or the Python API
 * does. If the API ends up owning identity, this file and the two
 * NEXT_PUBLIC_SUPABASE_* variables are deleted together. Do not build on it
 * without reading docs/backend-integration.md first.
 *
 * It does not talk to Postgres and must not learn how — data access belongs to
 * the API either way.
 *
 * If it is used: call `getClaims()` rather than `getSession()` whenever the
 * answer decides anything. @supabase/auth-js states that a user object read
 * from cookies "must not be trusted", while getClaims() verifies the token's
 * signature.
 *
 * Signing in, signing out and the seeker/company route guard belong to the
 * auth ticket; see the note in src/app/login/actions.ts.
 *
 * Never cache the returned client. Supabase requires a fresh one per render.
 */
export async function createSupabaseServerClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY must both be set. Copy .env.example to .env.local — see docs/backend-integration.md.",
    );
  }

  const cookieStore = await cookies();

  return createServerClient(url, key, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (cookiesToSet) => {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // A Server Component cannot write cookies. That is expected here:
          // refreshing the session is the job of the middleware the auth
          // ticket adds. Swallowing this is the documented Next.js pattern.
        }
      },
    },
  });
}
