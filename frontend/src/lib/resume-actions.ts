"use server";

import { apiUpload, apiGet, apiDelete } from "@/lib/api";
import { extractErrorMessage } from "@/lib/auth";
import { getApplicantSession } from "@/lib/session";

export type ResumeItem = {
  id: string;
  original_filename: string | null;
  storage_path: string;
  status: string;
  created_at: string | null;
};

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
    const res = await apiDelete(`/applicants/${id}/resumes/${resumeId}`, token);
    if (!res.ok) {
      const msg = await extractErrorMessage(res);
      return { error: msg };
    }
    return { error: null };
  } catch {
    return { error: "Could not reach the server." };
  }
}


export async function uploadResume(formData: FormData): Promise<{ resume: ResumeItem | null; error: string | null }> {
  try {
    const { id, token }  = await getApplicantSession();
    const res = await apiUpload(`/applicants/${id}/resumes`, formData, token);
    if (!res.ok) {
      const msg = await extractErrorMessage(res);
      return { resume: null, error: msg };
    }
    const resume: ResumeItem = await res.json();
    return { resume, error: null};
  } catch {
    return { resume: null, error: "Could not reach the server. Is the backend running?" };
  }
}
