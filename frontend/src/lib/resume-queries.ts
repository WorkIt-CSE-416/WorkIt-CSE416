import "server-only";

import { getResumeFileUrl, listResumes, type ResumeItem } from "@/lib/resume-actions";

/**
 * Reads of the applicant's uploads, for Server Components. Not in
 * ./resume-actions.ts on purpose: every export of a "use server" file becomes
 * a public POST endpoint, and these are only ever called during a render, so
 * they stay server-only and that file keeps the actions (./job-queries.ts is
 * the same split).
 */

// An uploaded resume's view page (KAN-366) in one read: the resume as the
// list has it and, for a PDF, the file's bytes, base64, which the page draws
// with the editor's pdf.js preview. The bytes are read here on the server
// from the short-lived link, so the browser never opens the Storage URL
// itself.
//
// The list and the link start together. The link never needed the list's
// answer, and waiting for the list first put one API call (about 110 to
// 150 ms) on every open's critical path. The Storage file is fetched only
// once the list has the resume and names a PDF, so a DOCX or a wrong id
// costs one wasted link call and never a download. `resume` is null when
// the list has no such id, which is the page's 404; the link's error is then
// ignored, since for an id the student does not own it is the API's refusal
// and not an outage. The list decides whether there is a resume at all, so
// the page shows `listError` ahead of `fileError`.
export async function readUploadedResume(resumeId: string): Promise<{
  resume: ResumeItem | null;
  pdf: string | null;
  listError: string | null;
  fileError: string | null;
}> {
  const [{ resumes, error: listError }, link] = await Promise.all([
    listResumes(),
    getResumeFileUrl(resumeId),
  ]);
  const resume = resumes.find((r) => r.id === resumeId) ?? null;
  if (!resume?.storage_path.endsWith(".pdf")) {
    return { resume, pdf: null, listError, fileError: null };
  }
  if (!link.url) {
    return { resume, pdf: null, listError, fileError: link.error ?? "Could not open the resume." };
  }
  const { data, error } = await readPdf(link.url);
  return { resume, pdf: data, listError, fileError: error };
}

// The file behind a link getResumeFileUrl just answered, base64. Not
// exported: a helper that fetched any URL it was handed must never become an
// endpoint a page script can call.
async function readPdf(url: string): Promise<{ data: string | null; error: string | null }> {
  try {
    const res = await fetch(url);
    if (!res.ok) return { data: null, error: "Could not read the resume's file." };
    return { data: Buffer.from(await res.arrayBuffer()).toString("base64"), error: null };
  } catch {
    return { data: null, error: "Could not reach the resume's file." };
  }
}
