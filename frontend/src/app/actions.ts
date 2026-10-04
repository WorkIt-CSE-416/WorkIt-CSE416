"use server";

import { redirect } from "next/navigation";

import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Ends the signed-in session. Supabase Auth owns sessions now
 * (backend/CLAUDE.md's Auth section) — the browser holds only Supabase's
 * `sb-*` cookies, so signing out means invalidating the session with
 * Supabase, not clearing a cookie of our own. Default (global) scope so the
 * refresh token is revoked server-side, not just forgotten in this browser.
 * Login re-signs in and redirects the same account back to its dashboard
 * (login/actions.ts), so signing back in works exactly as before.
 *
 * Shared under src/app rather than a per-shell actions.ts: this is called from
 * the seeker shell today and is the same call the company shell will pass to
 * AccountMenu once its own sign-out lands.
 */
export async function signOut(): Promise<void> {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  redirect("/login");
}
