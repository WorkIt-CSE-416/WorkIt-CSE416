"use server";

import { apiUpload, apiGet, apiDelete } from "@/lib/api";
import { apiFetch, extractErrorMessage } from "@/lib/auth";
import { getApplicantSession } from "@/lib/session";

// Mirrors ParsedResume in backend/app/models/dto.py. Dates are ISO
// "YYYY-MM-DD"; a key the API does not declare is dropped silently.
type Dated = { start_date: string | null; end_date: string | null };
export type ParsedResume = {
  education: ({
    institution: string;
    degree: string | null;
    field_of_study: string | null;
    gpa: number | null;
    description: string | null;
  } & Dated)[];
  experience: ({
    company_name: string;
    title: string;
    location: string | null;
    description: string | null;
  } & Dated)[];
  skills: { skill_name: string; category: string | null }[];
  projects: ({ project_name: string; url: string | null; description: string | null } & Dated)[];
  certifications: { cert_name: string; issuer: string | null }[];
};

export type ResumeItem = {
  id: string;
  original_filename: string | null;
  raw_text?: string | null;
  parsed_json?: ParsedResume | null;
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

// One resume's parsed content; the list endpoint leaves it out.
export async function getParsedResume(
  resumeId: string,
): Promise<{ parsed: ParsedResume | null; error: string | null }> {
  try {
    const { id, token } = await getApplicantSession();
    const res = await apiGet(resumePath(id, resumeId), token);
    if (!res.ok) return { parsed: null, error: await extractErrorMessage(res) };
    const { parsed_json } = await res.json();
    return { parsed: parsed_json, error: null };
  } catch {
    return { parsed: null, error: "Could not reach the server." };
  }
}

// Replaces a saved resume's parsed content — every edit made on the profile.
export async function updateParsedResume(
  resumeId: string,
  parsed: ParsedResume,
): Promise<{ error: string | null }> {
  try {
    const { id, token } = await getApplicantSession();
    const res = await apiFetch(
      resumePath(id, resumeId),
      { method: "PUT", body: JSON.stringify(parsed) },
      token,
    );
    if (!res.ok) return { error: await extractErrorMessage(res) };
    return { error: null };
  } catch {
    return { error: "Could not reach the server." };
  }
}

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

// Parses without saving, so the applicant can review the result first.
// parsed is null when the file had no readable text or no recognisable sections.
export async function parseResume(
  formData: FormData,
): Promise<{ parsed: ParsedResume | null; error: string | null }> {
  try {
    const { id, token } = await getApplicantSession();
    const res = await apiUpload(`/applicants/${id}/resumes/parse`, formData, token);
    if (!res.ok) {
      const msg = await extractErrorMessage(res);
      return { parsed: null, error: msg };
    }
    const { parsed_json } = await res.json();
    return { parsed: parsed_json, error: null };
  } catch {
    return { parsed: null, error: "Could not reach the server. Is the backend running?" };
  }
}

// formData may carry `parsed_json` (the reviewed parse, stringified); without
// it the API parses the file itself, which is what onboarding relies on.
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
