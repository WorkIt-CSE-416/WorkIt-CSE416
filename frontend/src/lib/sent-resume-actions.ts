"use server";

import { apiDelete, apiGet } from "@/lib/api";
import { apiFetch, extractErrorMessage } from "@/lib/auth";
import { getApplicantSession } from "@/lib/session";

/**
 * Sent resumes (backend/app/routers/sent_resumes.py), as server actions.
 * Types mirror backend/app/schemas/sent_resume.py. Every action returns
 * `error: string | null` and never throws. A file comes back as a 5-minute
 * Storage link that downloads it, not as bytes.
 */

export type SentResume = {
  id: string;
  name: string;
  built_resume_id: string | null;
  uploaded_resume_id: string | null;
  job_posting_id: string | null;
  created_at: string;
};

/** A kept sent resume, its download link, and the characters a fresh
 *  render's font could not draw. `created` is false for a repeat of
 *  content already sent from that built resume. */
export type SentDownload = SentResume & {
  url: string;
  missing_characters: string[];
  created: boolean;
};

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
    const url = `/applicants/${id(session.id)}/sent-resumes${path}`;
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

/** Newest first. */
export async function listSentResumes(): Promise<Result<SentResume[]>> {
  return call<SentResume[]>("");
}

/** A PDF download of a built resume, kept as a sent resume. */
export async function sendBuiltResume(builtResumeId: string): Promise<Result<SentDownload>> {
  return call<SentDownload>(
    "",
    { method: "POST", body: JSON.stringify({ built_resume_id: builtResumeId }) },
    async (res) => ({ ...((await res.json()) as SentDownload), created: res.status === 201 }),
  );
}

export async function sentResumeFileUrl(sentId: string): Promise<Result<{ url: string }>> {
  return call<{ url: string }>(`/${id(sentId)}/file`);
}

export async function deleteSentResume(sentId: string): Promise<{ error: string | null }> {
  return call<null>(`/${id(sentId)}`, { method: "DELETE" });
}
