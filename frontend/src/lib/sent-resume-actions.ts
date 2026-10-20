"use server";

import { applicantCall, type Result } from "@/lib/applicant-call";

/**
 * Sent resumes (backend/app/routers/sent_resumes.py), as server actions.
 * Types mirror backend/app/schemas/sent_resume.py. Every action returns
 * `error: string | null` and never throws. A file comes back as a 5-minute
 * Storage link that downloads it, not as bytes. Only Apply keeps a sent
 * resume: the editor's Download keeps nothing (KAN-267,
 * `built-resume-actions.ts`).
 */

export type SentResume = {
  id: string;
  name: string;
  built_resume_id: string | null;
  uploaded_resume_id: string | null;
  job_posting_id: string | null;
  created_at: string;
  /** The kept file's kind, "pdf" or "docx" (an uploaded resume's own, or a
   *  Word download kept before KAN-267). */
  format: string;
};

/** A kept sent resume, its download link, and the characters a fresh
 *  render's font could not draw. `created` is false for a repeat of
 *  content already sent from that built resume. */
export type SentDownload = SentResume & {
  url: string;
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
