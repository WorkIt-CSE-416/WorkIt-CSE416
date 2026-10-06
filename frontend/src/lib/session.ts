import "server-only";

import { cache } from "react";

import { apiFetch, type AuthenticatedAccount } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
supabase session and decode the token for user information 
 */
export async function getApplicantSession(): Promise<{ id: string; token: string }> {
  const supabase = await createSupabaseServerClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  if (!claimsData?.claims?.sub) throw new Error("Not signed in");

  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  if (!token) throw new Error("Not signed in");

  return { id: claimsData.claims.sub, token };
}

/** The signed-in account's access token, forwarded to the API as a Bearer
 *  header, or null when signed out. The API decides what it may do. */
export async function getAccessToken(): Promise<string | null> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

/** Who the session says is signed in, from verified token claims, or null
 *  when nobody is. getClaims() rather than getSession(), because a shell
 *  decides whether to render on it (see "The token travels server-side" in
 *  frontend/CLAUDE.md). It carries the email but not the name, which only
 *  the API's profile row holds, so it is also the bar's fallback when
 *  /auth/me cannot be reached. cache() so a shell asks once per render. */
export const getSessionUser = cache(
  async (): Promise<{ id: string; email: string | null } | null> => {
    const supabase = await createSupabaseServerClient();
    const { data } = await supabase.auth.getClaims();
    const claims = data?.claims;
    if (!claims?.sub) return null;
    return { id: claims.sub, email: typeof claims.email === "string" ? claims.email : null };
  },
);

/** The signed-in account as the API knows it (GET /auth/me): the real name
 *  the shell shows, rather than a fixture. Null when signed out or when the
 *  API can't be reached, so a caller renders a neutral bar instead of
 *  failing the page around it. cache() so the several pieces of a shell that
 *  each need it share one request per render. */
export const getCurrentAccount = cache(async (): Promise<AuthenticatedAccount | null> => {
  try {
    const token = await getAccessToken();
    if (!token) return null;
    const res = await apiFetch("/auth/me", { method: "GET" }, token);
    return res.ok ? ((await res.json()) as AuthenticatedAccount) : null;
  } catch {
    return null;
  }
});
