"use server";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requestOrigin } from "@/lib/request-origin";

export type ResetState = { sent: boolean; error: string | null };

export async function requestReset(_prev: ResetState, formData: FormData): Promise<ResetState> {
  const email = formData.get("email");
  if (typeof email !== "string" || !email.trim()) {
    return { sent: false, error: "Please enter your email address." };
  }

  const supabase = await createSupabaseServerClient();
  const origin = await requestOrigin();

  // Always show the success message — never reveal whether an account exists.
  const { error } = await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase(), {
    redirectTo: `${origin}/auth/confirm`,
  });

  if (error) {
    console.error("[reset-password] resetPasswordForEmail failed:", error.message);
  }

  return { sent: true, error: null };
}
