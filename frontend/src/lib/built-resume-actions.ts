"use server";

import { apiDelete, apiGet } from "@/lib/api";
import { apiFetch, extractErrorMessage } from "@/lib/auth";
import { getApplicantSession } from "@/lib/session";

/**
 * Built resumes (backend/app/routers/built_resumes.py), as server actions.
 * Types mirror backend/app/schemas/built_resume.py. Every action returns
 * `error: string | null` and never throws. Files come back as base64, which
 * the browser turns into a download: a resume is tens of KB, far under
 * Vercel's 4.5 MB response limit.
 */

export type BuiltResume = {
  id: string;
  name: string;
  template: string;
  job_posting_id: string | null;
  is_default: boolean;
  created_at: string;
};

/** The PDF, base64, and what the student is warned about before saving it. */
export type RenderedPdf = { pdf: string; page_count: number; missing_characters: string[] };

type Result<T> = { data: T | null; error: string | null };

const OFFLINE = "Could not reach the server.";

// Ids are encoded: any browser script can call an action with any argument.
const id = (value: string) => encodeURIComponent(value);

async function call<T>(
  path: string,
  init?: RequestInit,
  read: (res: Response) => Promise<T> = (res) => res.json() as Promise<T>,
): Promise<Result<T>> {
  try {
    const session = await getApplicantSession();
    const url = `/applicants/${id(session.id)}/built-resumes${path}`;
    const res =
      init == null
        ? await apiGet(url, session.token)
        : init.method === "DELETE"
          ? await apiDelete(url, session.token)
          : await apiFetch(url, init, session.token);
    if (!res.ok) return { data: null, error: await extractErrorMessage(res) };
    return { data: res.status === 204 ? null : await read(res), error: null };
  } catch {
    return { data: null, error: OFFLINE };
  }
}

export async function listBuiltResumes(): Promise<Result<BuiltResume[]>> {
  return call<BuiltResume[]>("");
}

/** Generate: a base resume with everything in the bank. Refused (the
 *  API's message in `error`) when the student already has 5 resumes. */
export async function generateResume(name?: string): Promise<Result<BuiltResume>> {
  return call<BuiltResume>("", { method: "POST", body: JSON.stringify(name ? { name } : {}) });
}

export async function deleteBuiltResume(resumeId: string): Promise<{ error: string | null }> {
  return call<null>(`/${id(resumeId)}`, { method: "DELETE" });
}

export async function setDefaultBuiltResume(resumeId: string): Promise<{ error: string | null }> {
  return call(`/${id(resumeId)}/default`, { method: "PUT" });
}

export async function renderResumePdf(resumeId: string): Promise<Result<RenderedPdf>> {
  return call<RenderedPdf>(`/${id(resumeId)}/render`);
}

/** The Word file as base64. */
export async function downloadResumeDocx(resumeId: string): Promise<Result<string>> {
  return call<string>(`/${id(resumeId)}/docx`, undefined, async (res) =>
    Buffer.from(await res.arrayBuffer()).toString("base64"),
  );
}
