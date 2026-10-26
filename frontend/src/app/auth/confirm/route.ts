import { NextResponse, type NextRequest } from "next/server";

import { createSupabaseServerClient } from "@/lib/supabase/server";

/** The `type`s an email link may carry here; anything else is refused. */
const EMAIL_TYPES = ["signup", "email", "recovery"] as const;
type EmailType = (typeof EMAIL_TYPES)[number];

function isEmailType(type: string | null): type is EmailType {
  return EMAIL_TYPES.includes(type as EmailType);
}

/**
 * Handles email links from Supabase Auth, in either of the two shapes they
 * arrive in:
 *
 * - `token_hash` and `type`: the email templates Supabase's SSR guide asks
 *   for (docs/auth.md, "Email templates"). Verified with verifyOtp.
 * - `code`: Supabase's default templates. The link goes through Supabase's
 *   own verify first, which comes back here with a PKCE code. Exchanged with
 *   exchangeCodeForSession; works only in the browser that asked for the
 *   email, which holds the code verifier cookie. A password reset says so
 *   through `redirectType`, from that cookie.
 *
 * A signup confirmation goes to /login (which sends a signed-in visitor
 * home); a password reset goes to /login/new-password with its session.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const tokenHash = params.get("token_hash");
  const type = params.get("type");
  const code = params.get("code");
  const origin = request.nextUrl.origin;

  const supabase = await createSupabaseServerClient();
  let recovery: boolean;
  if (tokenHash && isEmailType(type)) {
    const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
    if (error) {
      console.error("[auth/confirm] verifyOtp failed:", error.message);
      return NextResponse.redirect(`${origin}/login?error=confirm_failed`);
    }
    recovery = type === "recovery";
  } else if (code) {
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      console.error("[auth/confirm] exchangeCodeForSession failed:", error.message);
      return NextResponse.redirect(`${origin}/login?error=confirm_failed`);
    }
    // auth-js returns redirectType ("recovery" when resetPasswordForEmail
    // stored the code verifier) but its AuthTokenResponse type leaves it out.
    recovery = (data as { redirectType?: string | null }).redirectType === "recovery";
  } else {
    return NextResponse.redirect(`${origin}/login?error=invalid_link`);
  }

  if (recovery) {
    // The session is now active — send to the new-password page.
    return NextResponse.redirect(`${origin}/login/new-password`);
  }

  // Signup confirmation: send to login so the user signs in.
  return NextResponse.redirect(`${origin}/login?confirmed=true`);
}
