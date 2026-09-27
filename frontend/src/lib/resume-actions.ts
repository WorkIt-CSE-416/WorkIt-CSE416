"use server";

import { apiUpload } from "@/lib/api";
import { apiFetch, extractErrorMessage } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";

async function getApplicantId(): Promise<string> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Not signed in");

  const res = await apiFetch("/auth/me", { method: "GET" }, token);
  if (!res.ok) throw new Error("Could not fetch account");

  const account: { id: string } = await res.json();
  return account.id;
}

export async function uploadResume(formData: FormData): Promise<{ error: string | null }> {
  try {
    const applicantId = await getApplicantId();
    const res = await apiUpload(`/applicants/${applicantId}/resumes`, formData);
    if (!res.ok) {
      const msg = await extractErrorMessage(res);
      return { error: msg };
    }
    return { error: null };
  } catch {
    return { error: "Could not reach the server. Is the backend running?" };
  }
}
