import { NextResponse, type NextRequest } from "next/server";

import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Handles email confirmation links from Supabase Auth. The link carries
 * `token_hash` and `type` as query params. Supabase sends these for both
 * signup confirmation and password recovery emails.
 *
 * - type=signup  → verify, then redirect to /login (user signs in manually)
 * - type=recovery → verify, then redirect to /login/new-password (user sets
 *   a new password while their session is active)
 */
export async function GET(request: NextRequest) {
  const tokenHash = request.nextUrl.searchParams.get("token_hash");
  const type = request.nextUrl.searchParams.get("type");
  const origin = request.nextUrl.origin;

  if (!tokenHash || !type) {
    return NextResponse.redirect(`${origin}/login?error=invalid_link`);
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.verifyOtp({
    token_hash: tokenHash,
    type: type as "signup" | "recovery" | "email",
  });

  if (error) {
    console.error("[auth/confirm] verifyOtp failed:", error.message);
    return NextResponse.redirect(`${origin}/login?error=confirm_failed`);
  }

  if (type === "recovery") {
    // The session is now active — send to the new-password page.
    return NextResponse.redirect(`${origin}/login/new-password`);
  }

  // Signup confirmation: send to login so the user signs in.
  return NextResponse.redirect(`${origin}/login?confirmed=true`);
}
