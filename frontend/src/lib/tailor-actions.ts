"use server";

import { apiFetch, extractErrorMessage } from "@/lib/auth";
import type { BuiltResume } from "@/lib/built-resume-actions";
import { getApplicantSession } from "@/lib/session";

/**
 * Tailor (backend/app/routers/tailor.py), as server actions. Types mirror
 * backend/app/schemas/tailor.py. Every action returns `error: string | null`
 * and never throws; `status` lets the screen tell an empty bank (409) from
 * the daily limit (429).
 */

export type Keyword = { keyword: string; kind: "required" | "preferred" };

export type TailorChange = {
  kind: "reword" | "show_entry" | "show_skill" | "order";
  bullet_id: string | null;
  entry_id: string | null;
  skill_id: string | null;
  bullet_ids: string[];
  text: string | null;
  original: string | null;
  label: string | null;
  /** The posting's keywords this change alone adds to the match. */
  keywords: string[];
};

export type TailorProposal = {
  job_posting_id: string;
  source_resume_id: string;
  tailored_resume_id: string | null;
  weak_match: boolean;
  matched: Keyword[];
  missing: Keyword[];
  /** Missing keywords that are nowhere in the bank: "Have you used X?". */
  questions: Keyword[];
  changes: TailorChange[];
  dropped: number;
  uses_left: number;
};

export type TailorResult = { resume: BuiltResume; matched: Keyword[]; missing: Keyword[] };

type Result<T> = { data: T | null; error: string | null; status: number | null };

async function post<T>(path: string, body: unknown): Promise<Result<T>> {
  try {
    const session = await getApplicantSession();
    const url = `/applicants/${encodeURIComponent(session.id)}/tailor${path}`;
    const res = await apiFetch(url, { method: "POST", body: JSON.stringify(body) }, session.token);
    if (!res.ok) return { data: null, error: await extractErrorMessage(res), status: res.status };
    return { data: (await res.json()) as T, error: null, status: res.status };
  } catch {
    return { data: null, error: "Could not reach the server.", status: null };
  }
}

/** One Tailor run: spends one of today's Tailor runs. Saves nothing. */
export async function runTailor(postingId: string): Promise<Result<TailorProposal>> {
  return post<TailorProposal>("", { job_posting_id: postingId });
}

/** Done: saves the accepted changes on the posting's one tailored resume. Free. */
export async function finishTailor(
  postingId: string,
  sourceResumeId: string,
  changes: TailorChange[],
): Promise<Result<TailorResult>> {
  return post<TailorResult>("/done", {
    job_posting_id: postingId,
    source_resume_id: sourceResumeId,
    changes,
  });
}
