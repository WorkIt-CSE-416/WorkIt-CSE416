import "server-only";

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
