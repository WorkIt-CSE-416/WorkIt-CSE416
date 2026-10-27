"use server";

import { redirect } from "next/navigation";

import { apiFetch, homePath, type AuthenticatedAccount } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type NewPasswordState = { error: string | null };

export async function updatePassword(
  _prev: NewPasswordState,
  formData: FormData,
): Promise<NewPasswordState> {
  const password = formData.get("password");
  if (typeof password !== "string" || !password) {
    return { error: "Please enter a new password." };
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.updateUser({ password });

  if (error) {
    return { error: error.message };
  }

  // Redirect to the account's home page, same as the login flow.
  const session = (await supabase.auth.getSession()).data.session;
  if (session) {
    const resp = await apiFetch("/auth/me", { method: "GET" }, session.access_token);
    const account: AuthenticatedAccount | null = resp.ok ? await resp.json() : null;
    if (account) redirect(homePath(account));
  }

  redirect("/dashboard");
}
