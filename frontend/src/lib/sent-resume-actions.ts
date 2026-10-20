"use server";

import { applicantCall, type Result } from "@/lib/applicant-call";

/**
 * Sent resumes (backend/app/routers/sent_resumes.py), as server actions.
 * Types mirror backend/app/schemas/sent_resume.py. Every action returns
 * `error: string | null` and never throws. A file comes back one of two
 * ways (KAN-267): a 5-minute Storage link (`url`) for a stored file, or the
 * PDF in base64 (`data`) for a snapshot, rendered again; `saveSentFile`
 * (`lib/save-file.ts`) takes either. Only Apply keeps a sent resume: the
 * editor's Download keeps nothing (`built-resume-actions.ts`).
 */

export type SentResume = {
  id: string;
  name: string;
  built_resume_id: string | null;
  uploaded_resume_id: string | null;
  job_posting_id: string | null;
  created_at: string;
  /** The kept file's kind, "pdf" or "docx" (an uploaded resume's own, or a
   *  Word download kept before KAN-267). A snapshot is always a PDF. */
  format: string;
  /** Rebuilt from an uploaded file's text once that upload was replaced or
   *  deleted (KAN-267): its layout may differ from what was sent. */
  rebuilt: boolean;
};

/** A kept sent resume, its file, and the characters a fresh
 *  render's font could not draw. `created` is false for a repeat of
 *  content already sent from that built resume. */
export type SentDownload = SentResume & {
  file_name: string;
  content_type: string;
  /** A stored file's 5-minute link; null for a snapshot, which comes as `data`. */
  url: string | null;
  /** The PDF in base64, rendered from the snapshot; null for a stored file. */
  data: string | null;
  missing_characters: string[];
  created: boolean;
};

function call<T>(path: string, init?: RequestInit, read?: (res: Response) => Promise<T>) {
  return applicantCall<T>(`/sent-resumes${path}`, init, read);
}

/** Newest first. */
export async function listSentResumes(): Promise<Result<SentResume[]>> {
  return call<SentResume[]>("");
}

/** Apply (KAN-220): the resume the student picked, kept as a sent resume
 *  linked to the job posting. A built resume renders a new file (or repeats
 *  the last one with the same content for that posting); an uploaded resume
 *  makes no file, the sent resume points at the uploaded file. */
export async function applyWithResume(
  source: { builtResumeId: string } | { uploadedResumeId: string },
  jobPostingId: string,
): Promise<Result<SentDownload>> {
  const body =
    "builtResumeId" in source
      ? { built_resume_id: source.builtResumeId }
      : { uploaded_resume_id: source.uploadedResumeId };
  return call<SentDownload>(
    "",
    { method: "POST", body: JSON.stringify({ ...body, job_posting_id: jobPostingId }) },
    async (res) => ({ ...((await res.json()) as SentDownload), created: res.status === 201 }),
  );
}
