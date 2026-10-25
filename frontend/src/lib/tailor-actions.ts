"use server";

import { applicantCall, type Result } from "@/lib/applicant-call";
import type { BuiltResume } from "@/lib/built-resume-actions";

/**
 * Tailor (backend/app/routers/tailor.py), as server actions. Types mirror
 * backend/app/schemas/tailor.py. Every action returns `error: string | null`
 * and never throws; `status` lets the screen tell an empty bank (409) from
 * the daily limit (429).
 */

export type Keyword = { keyword: string; kind: "required" | "preferred" };

export type TailorChange = {
  kind: "reword" | "show_skill" | "order";
  bullet_id: string | null;
  entry_id: string | null;
  skill_id: string | null;
  bullet_ids: string[];
  text: string | null;
  original: string | null;
  label: string | null;
};

/** The resume the student picked to tailor: a built resume, or an upload
 *  (read into the bank again and shown as its own entries; never saved). */
export type TailorSource = { built_resume_id: string } | { uploaded_resume_id: string };

export type TailorProposal = {
  job_posting_id: string;
  /** The source the run was given, one of the two; Done sends it back. */
  built_resume_id: string | null;
  uploaded_resume_id: string | null;
  tailored_resume_id: string | null;
  weak_match: boolean;
  matched: Keyword[];
  missing: Keyword[];
  /** Every missing keyword: "Have you used X?". A run proposes no skill. */
  questions: Keyword[];
  changes: TailorChange[];
  dropped: number;
  uses_left: number;
};

export type TailorResult = { resume: BuiltResume; matched: Keyword[]; missing: Keyword[] };

function post<T>(path: string, body: unknown): Promise<Result<T>> {
  return applicantCall<T>(`/tailor${path}`, { method: "POST", body: JSON.stringify(body) });
}

/** One Tailor run from the picked resume: spends one of today's Tailor
 *  runs. Saves nothing but what an upload's reading adds to the bank. */
export async function runTailor(
  postingId: string,
  source: TailorSource,
): Promise<Result<TailorProposal>> {
  return post<TailorProposal>("", { job_posting_id: postingId, ...source });
}

/** The source a run names, as Done takes it back. */
function sourceOf(proposal: TailorProposal): TailorSource {
  return proposal.built_resume_id
    ? { built_resume_id: proposal.built_resume_id }
    : { uploaded_resume_id: proposal.uploaded_resume_id as string };
}

/** Done: saves the accepted changes on the posting's one tailored resume. Free. */
export async function finishTailor(
  proposal: TailorProposal,
  changes: TailorChange[],
): Promise<Result<TailorResult>> {
  return post<TailorResult>("/done", {
    job_posting_id: proposal.job_posting_id,
    ...sourceOf(proposal),
    changes,
  });
}
