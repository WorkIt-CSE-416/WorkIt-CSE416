"use server"

import { apiUpload } from "@/lib/api";

// TODO: Get from session once /auth/me is wired
const APPLICANT_ID = "00000000-0000-0000-0000-000000000000";

export async function uploadResume(formData: FormData): Promise<{ error: string | null}> {
  try {
    const res = await apiUpload(
      `/applicants/${APPLICANT_ID}/resumes`,
      formData,
    );
    if (!res.ok){
      try {
        const body = await res.text();
        return { error: body || `Upload failed (${res.status})` };
      } catch {
        return { error: `Upload failed (${res.status})` };
      }
    }
    return { error: null }
  } catch {
    return { error: "Could not reach the server. Is the backend running?"};
  }
}

