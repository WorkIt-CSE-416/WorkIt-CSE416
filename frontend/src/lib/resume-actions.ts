"use server";

import { apiUpload, apiGet, apiDelete } from "@/lib/api";
import { apiFetch, errorMessage, extractErrorMessage } from "@/lib/auth";
import type { EntryFields, ImportResult } from "@/lib/bank-actions";
import { getApplicantSession } from "@/lib/session";

export type ResumeItem = {
  id: string;
  original_filename: string | null;
  raw_text?: string | null;
  storage_path: string;
  status: string;
  /** The applicant's primary resume — the one the profile shows. */
  is_default: boolean;
  created_at: string | null;
  /** Upload and Import Updated Resume only: what the reading wrote into the
   *  experience bank (ADR 0003). */
  bank?: ImportResult;
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

// A new name for the upload (KAN-268). The API keeps the file's extension
// on it, so a DOCX still downloads as one.
export async function renameResume(
  resumeId: string,
  name: string,
): Promise<{ resume: ResumeItem | null; error: string | null }> {
  try {
    const { id, token } = await getApplicantSession();
    const res = await apiFetch(
      resumePath(id, resumeId),
      { method: "PATCH", body: JSON.stringify({ name }) },
      token,
    );
    if (!res.ok) return { resume: null, error: await extractErrorMessage(res) };
    const resume: ResumeItem = await res.json();
    return { resume, error: null };
  } catch {
    return { resume: null, error: "Could not reach the server." };
  }
}

// A short-lived link to the uploaded file: a PDF opens in the browser's
// viewer, a DOCX downloads under its name. With `download`, a PDF downloads
// too (the row's Download button, KAN-268).
export async function getResumeFileUrl(
  resumeId: string,
  download = false,
): Promise<{ url: string | null; error: string | null }> {
  try {
    const { id, token } = await getApplicantSession();
    const query = download ? "?download=true" : "";
    const res = await apiGet(`${resumePath(id, resumeId)}/file${query}`, token);
    if (!res.ok) return { url: null, error: await extractErrorMessage(res) };
    const { url } = await res.json();
    return { url, error: null };
  } catch {
    return { url: null, error: "Could not reach the server." };
  }
}

// An uploaded PDF's bytes, base64, for its view page (KAN-366), which draws
// it with the editor's pdf.js preview: read on the server from the
// short-lived link, so the browser never opens the Storage URL itself.
export async function readResumePdf(
  resumeId: string,
): Promise<{ data: string | null; error: string | null }> {
  const { url, error } = await getResumeFileUrl(resumeId);
  if (!url) return { data: null, error: error ?? "Could not open the resume." };
  try {
    const res = await fetch(url);
    if (!res.ok) return { data: null, error: "Could not read the resume's file." };
    return { data: Buffer.from(await res.arrayBuffer()).toString("base64"), error: null };
  } catch {
    return { data: null, error: "Could not reach the resume's file." };
  }
}

/** One entry of a parse preview: the entry fields, its bullets' text, and
 *  the ids of the other uploads' entries a confirm replaces (ADR 0006). */
export type PreviewEntry = EntryFields & { bullets: string[]; replaces: string[] };
export type PreviewSkill = { name: string; group: string | null; replaces: string[] };
/** POST .../resumes/preview (KAN-372): what the parser reads in a file,
 *  with nothing saved. `duplicate_of` names an upload with the same text. */
export type ResumePreview = {
  entries: PreviewEntry[];
  skills: PreviewSkill[];
  duplicate_of: { resume_id: string; name: string } | null;
};

// The parse preview (KAN-372, ADR 0006): the API reads the file as an upload
// does and saves nothing. The student confirms by uploading the same file
// with `replaceMatching`.
export async function previewResume(
  formData: FormData,
): Promise<{ preview: ResumePreview | null; error: string | null }> {
  try {
    const { id, token } = await getApplicantSession();
    const res = await apiUpload(`/applicants/${id}/resumes/preview`, formData, token);
    if (!res.ok) return { preview: null, error: await extractErrorMessage(res) };
    return { preview: await res.json(), error: null };
  } catch {
    return { preview: null, error: "Could not reach the server. Is the backend running?" };
  }
}

// The API reads the file itself and writes what it read into the experience
// bank; the client never sends parsed content. A file whose text the student
// has already uploaded is refused (KAN-267): `error` is "Duplicate Resume
// found: <name>" and `duplicateOf` that resume's id. `replaceMatching`
// confirms a parse preview: the other uploads' matching entries and skills
// are replaced, not copied (ADR 0006).
export async function uploadResume(
  formData: FormData,
  { replaceMatching = false }: { replaceMatching?: boolean } = {},
): Promise<{ resume: ResumeItem | null; error: string | null; duplicateOf?: string }> {
  try {
    const { id, token } = await getApplicantSession();
    const query = replaceMatching ? "?replace=matching" : "";
    const res = await apiUpload(`/applicants/${id}/resumes${query}`, formData, token);
    if (!res.ok) return await refused(res);
    const resume: ResumeItem = await res.json();
    return { resume, error: null };
  } catch {
    return { resume: null, error: "Could not reach the server. Is the backend running?" };
  }
}

/** A refused upload or Import Updated Resume: the API's message, and for a
 *  duplicate (409, KAN-267) the id of the resume it matched. */
async function refused(
  res: Response,
): Promise<{ resume: null; error: string; duplicateOf?: string }> {
  const body: unknown = await res.json().catch(() => null);
  const duplicateOf = (body as { detail?: { resume_id?: unknown } } | null)?.detail?.resume_id;
  return {
    resume: null,
    error: errorMessage(body),
    ...(res.status === 409 && typeof duplicateOf === "string" ? { duplicateOf } : {}),
  };
}

// Import Updated Resume: a newer version of the file on this row. The row
// keeps its id and primary star, and the API reads the new file into the
// experience bank as it reads an upload. The text of another upload is a
// duplicate, as for an upload; this row's own text in a new file is not.
export async function replaceResume(
  resumeId: string,
  formData: FormData,
): Promise<{ resume: ResumeItem | null; error: string | null; duplicateOf?: string }> {
  try {
    const { id, token } = await getApplicantSession();
    const res = await apiUpload(resumePath(id, resumeId), formData, token, "PUT");
    if (!res.ok) return await refused(res);
    const resume: ResumeItem = await res.json();
    return { resume, error: null };
  } catch {
    return { resume: null, error: "Could not reach the server. Is the backend running?" };
  }
}
