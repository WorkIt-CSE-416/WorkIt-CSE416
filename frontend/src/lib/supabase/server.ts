import "server-only";

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/**
 * A Supabase client scoped to the current request.
 *
 * This exists to READ the session. Nothing in this app talks to Postgres —
 * data access belongs to the Python API, which does its own authorization; the
 * frontend's job is to know who is signed in and to forward that identity. Use
 * `getClaims()` rather than `getSession()` when the answer decides anything:
 * @supabase/auth-js states that a user object read from cookies "must not be
 * trusted", while getClaims() verifies the token's signature.
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
      "NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY must both be set. Copy .env.example to .env.local — see docs/supabase.md.",
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
