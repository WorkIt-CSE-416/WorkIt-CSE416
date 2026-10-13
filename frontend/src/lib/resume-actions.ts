"use server";

import { apiUpload, apiGet, apiDelete } from "@/lib/api";
import { apiFetch, extractErrorMessage } from "@/lib/auth";
import { getApplicantSession } from "@/lib/session";

export type ResumeItem = {
  id: string;
  original_filename: string | null;
  raw_text?: string | null;
  /** The parser's own reading, never edited (KAN-211); the bank holds the
   *  student's checked facts. */
  parsed_json?: unknown;
  storage_path: string;
  status: string;
  /** The applicant's primary resume — the one the profile shows. */
  is_default: boolean;
  created_at: string | null;
};

// A server action is an endpoint any page script can call with any argument.
// Encoding the id keeps a crafted one ("../avatar") from walking the request
// onto another API route, which fetch would otherwise resolve before sending.
function resumePath(applicantId: string, resumeId: string) {
  return `/applicants/${applicantId}/resumes/${encodeURIComponent(resumeId)}`;
}

export async function listResumes(): Promise<{ resumes: ResumeItem[]; error: string | null }> {
  try {
    const { id, token } = await getApplicantSession();
    const res = await apiGet(`/applicants/${id}/resumes`, token);
    if (!res.ok) {
      const msg = await extractErrorMessage(res);
      return { resumes: [], error: msg };
    }
    const resumes: ResumeItem[] = await res.json();
    return { resumes, error: null };
  } catch {
    return { resumes: [], error: "Could not reach the server." };
  }
}

export async function deleteResume(resumeId: string): Promise<{ error: string | null }> {
  try {
    const { id, token } = await getApplicantSession();
    const res = await apiDelete(resumePath(id, resumeId), token);
    if (!res.ok) {
      const msg = await extractErrorMessage(res);
      return { error: msg };
    }
    return { error: null };
  } catch {
    return { error: "Could not reach the server." };
  }
}

// Unused: replaced by getApplicantSession() from @/lib/session.
// async function getApplicantId(): Promise<{ id: string; token: string }> {
//   const supabase = await createSupabaseServerClient();
//   const { data: claimsData } = await supabase.auth.getClaims();
//   if (!claimsData?.claims?.sub) throw new Error("Not signed in");
//
//   const { data: sessionData } = await supabase.auth.getSession();
//   const token = sessionData.session?.access_token;
//   if (!token) throw new Error("Not signed in");
//
//   return { id: claimsData.claims.sub, token };
// }

// Makes this the applicant's primary resume.
export async function setPrimaryResume(resumeId: string): Promise<{ error: string | null }> {
  try {
    const { id, token } = await getApplicantSession();
    const res = await apiFetch(`${resumePath(id, resumeId)}/default`, { method: "PUT" }, token);
    if (!res.ok) return { error: await extractErrorMessage(res) };
    return { error: null };
  } catch {
    return { error: "Could not reach the server." };
  }
}

// A short-lived link to the uploaded file: a PDF opens in the browser's
// viewer, a DOCX downloads under its original name.
export async function getResumeFileUrl(
  resumeId: string,
): Promise<{ url: string | null; error: string | null }> {
  try {
    const { id, token } = await getApplicantSession();
    const res = await apiGet(`${resumePath(id, resumeId)}/file`, token);
    if (!res.ok) return { url: null, error: await extractErrorMessage(res) };
    const { url } = await res.json();
    return { url, error: null };
  } catch {
    return { url: null, error: "Could not reach the server." };
  }
}

// The API reads the file itself; the client never sends parsed content.
export async function uploadResume(
  formData: FormData,
): Promise<{ resume: ResumeItem | null; error: string | null }> {
  try {
    const { id, token } = await getApplicantSession();
    const res = await apiUpload(`/applicants/${id}/resumes`, formData, token);
    if (!res.ok) {
      const msg = await extractErrorMessage(res);
      return { resume: null, error: msg };
    }
    const resume: ResumeItem = await res.json();
    return { resume, error: null };
  } catch {
    return { resume: null, error: "Could not reach the server. Is the backend running?" };
  }
}
