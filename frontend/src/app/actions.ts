"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { SESSION_COOKIE_NAME } from "@/lib/auth";

/**
 * Ends the signed-in session. Access tokens are self-contained JWTs with no
 * server-side row to revoke (backend/app/security.py's docstring: "a JWT
 * can't be revoked early... logout can only clear the cookie client-side"),
 * so signing out is just deleting the cookie that carries one — there is no
 * Supabase Auth session or other server-side state to end. Login re-sets it
 * (relaySessionCookie in src/lib/auth.ts) and redirects the same account back
 * to its dashboard, so signing back in works exactly as before.
 *
 * Shared under src/app rather than a per-shell actions.ts: this is called from
 * the seeker shell today and is the same call the company shell will pass to
 * AccountMenu once its own sign-out lands.
 */
export async function signOut(): Promise<void> {
  (await cookies()).delete(SESSION_COOKIE_NAME);
  redirect("/login");
}
