"use server";

import { createSupabaseServerClient } from "@/lib/supabase/server";

// password echoes back nothing — same reasoning as signup-form.tsx:
// confirmPassword never reaches here, and a password isn't worth echoing
// back into the field on failure either way.
export type SetPasswordState = { error: string | null; success: boolean };

// Matches signup/signup-form.tsx's PASSWORD_MIN_LENGTH and
// backend/app/schemas/auth.py's SignupRequest.password — a WorkIt password
// set here has to clear the same bar one set at signup would. Supabase's own
// project-level minimum (Authentication settings) is the floor underneath
// all three; see backend/CLAUDE.md's Auth section.
const PASSWORD_MIN_LENGTH = 8;

/**
 * Sets (or replaces) the signed-in account's WorkIt password — a separate
 * credential from whatever Google or LinkedIn account they may have signed
 * in with, not a way to "use" that provider's own password. This is what
 * lets a Google/LinkedIn-only sign-in also work through the ordinary
 * email+password login form afterward: Supabase's updateUser() sets a
 * password on auth.users regardless of which provider the session came
 * from, and signInWithPassword() only ever checks that column — it has no
 * notion of "this account signed up via Google" to refuse.
 *
 * Needs an active session (any provider) to find out whose password this
 * is; with none, Supabase's own error comes back and is shown as-is.
 */
export async function setPassword(
  _prevState: SetPasswordState,
  formData: FormData,
): Promise<SetPasswordState> {
  const password = formData.get("password");
  const value = typeof password === "string" ? password : "";

  if (value.length < PASSWORD_MIN_LENGTH) {
    return {
      error: `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`,
      success: false,
    };
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.updateUser({ password: value });

  if (error) {
    return { error: error.message, success: false };
  }

  return { error: null, success: true };
}
