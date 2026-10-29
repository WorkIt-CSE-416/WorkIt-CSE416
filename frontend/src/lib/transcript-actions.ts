"use server";

import { apiUpload } from "@/lib/api";
import { applicantCall, OFFLINE } from "@/lib/applicant-call";
import { extractErrorMessage } from "@/lib/auth";
import { getApplicantSession } from "@/lib/session";

/**
 * The student's unofficial transcript (KAN-369's API, GET, PUT and DELETE
 * /applicants/{id}/documents/transcript, backend/app/routers/documents.py):
 * one file, kept beside the resumes, which the autofiller attaches to a
 * form's transcript upload. My Profile's Transcript section edits it.
 * Identity comes from the session, never an argument.
 */

export type Transcript = {
  kind: "transcript";
  original_filename: string;
  created_at: string | null;
};

/** The transcript, or null when there is none; `error` says why on a failed read. */
export async function getTranscript(): Promise<{
  transcript: Transcript | null;
  error: string | null;
}> {
  const { data, error } = await applicantCall<Transcript[]>("/documents");
  return { transcript: data?.find((d) => d.kind === "transcript") ?? null, error };
}

/** Uploads the file in `formData` ("file"), replacing the one there. */
export async function uploadTranscript(
  formData: FormData,
): Promise<{ transcript: Transcript | null; error: string | null }> {
  try {
    const { id, token } = await getApplicantSession();
    const res = await apiUpload(
      `/applicants/${encodeURIComponent(id)}/documents/transcript`,
      formData,
      token,
      "PUT",
    );
    if (!res.ok) return { transcript: null, error: await extractErrorMessage(res) };
    return { transcript: await res.json(), error: null };
  } catch {
    return { transcript: null, error: OFFLINE };
  }
}

export async function deleteTranscript(): Promise<{ error: string | null }> {
  const { error } = await applicantCall<null>("/documents/transcript", { method: "DELETE" });
  return { error };
}
