"use server";

import { apiUpload } from "@/lib/api";
import { extractErrorMessage } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";

async function getApplicantId(): Promise<{ id: string, token: string }> {
  const supabase = await createSupabaseServerClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  if (!claimsData?.claims?.sub) throw new Error("Not signed in");

  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  if (!token) throw new Error("Not signed in");

  return { id: claimsData.claims.sub, token };
}

export async function uploadResume(formData: FormData): Promise<{ error: string | null }> {
  try {
    const { id, token }  = await getApplicantId();
    const res = await apiUpload(`/applicants/${id}/resumes`, formData, token);
    if (!res.ok) {
      const msg = await extractErrorMessage(res);
      return { error: msg };
    }
    return { error: null };
  } catch {
    return { error: "Could not reach the server. Is the backend running?" };
  }
}
