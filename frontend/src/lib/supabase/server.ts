import "server-only";

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/**
 * A Supabase client scoped to the current request. Supabase Auth issues our
 * sessions (backend/CLAUDE.md's Auth section): this client signs in, signs
 * out, and reads the access token that `src/lib/auth.ts` forwards to the
 * Python API as a Bearer header.
 *
 * Auth only. It does not talk to Postgres and must not learn how — data
 * access belongs to the API. Signup goes through the API too, not
 * `auth.signUp()`, because only the API can set the account type.
 *
 * Call `getClaims()` rather than `getSession()` whenever the answer decides
 * anything. @supabase/auth-js states that a user object read from cookies
 * "must not be trusted", while getClaims() verifies the token's signature.
 *
 * Never cache the returned client. Supabase requires a fresh one per render.
 */
export async function createSupabaseServerClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY must both be set. Copy frontend/.env.example to frontend/.env.local.",
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
          // refreshing the session is src/proxy.ts's job, and Server Actions
          // (sign-in, sign-out) can write them. Swallowing this is the
          // documented Next.js pattern.
        }
      },
    },
  });
}
