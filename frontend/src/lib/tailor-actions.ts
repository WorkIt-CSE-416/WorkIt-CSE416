"use server";

import { applicantCall, type Result } from "@/lib/applicant-call";
import { listBuiltResumes, renderResumePdf, type BuiltResume } from "@/lib/built-resume-actions";
import { readUploadedResume } from "@/lib/resume-queries";

/**
 * Tailor (backend/app/routers/tailor.py, docs/tailor_resume.md), as server
 * actions. Types mirror backend/app/schemas/tailor.py. A run streams its
 * phases, so it goes through the route handler `/api/tailor`, not an action. Every action returns
 * `error: string | null` and never throws; `status` lets the screen tell an
 * empty bank or an already tailored posting (409) from the daily limit (429).
 */

export type Keyword = { keyword: string; kind: "required" | "preferred" };

/** The resume the student picked to tailor: a built resume, or an upload
 *  (read into the bank again and shown as its own entries; never saved). */
export type TailorSource = { built_resume_id: string } | { uploaded_resume_id: string };

/** The picked resume's keyword match before a run. `tailored_resume_id`:
 *  the posting's tailored resume, when it has one (a run is then refused). */
export type TailorMatch = {
  job_posting_id: string;
  tailored_resume_id: string | null;
  weak_match: boolean;
  matched: Keyword[];
  missing: Keyword[];
};

/** One change a run saved, with what it replaced, for the editor to mark
 *  and revert. `reword`: `bullet_id` shows `text`, and showed
 *  `before` (variant `before_variant_id`). `order`: `entry_id`'s bullets are
 *  `bullet_ids`, and were `before_ids`; the editor can restore one bullet's
 *  prior position at a time. `skill`: `skill_id`, named `label` in `group`,
 *  is this resume's own. */
export type TailorEdit = {
  kind: "reword" | "order" | "skill";
  bullet_id: string | null;
  entry_id: string | null;
  skill_id: string | null;
  label: string | null;
  text: string | null;
  variant_id: string | null;
  before: string | null;
  before_variant_id: string | null;
  bullet_ids: string[];
  before_ids: string[];
  group: string | null;
};

export type TailorRunResult = {
  resume: BuiltResume;
  weak_match: boolean;
  matched: Keyword[];
  missing: Keyword[];
  after_matched: Keyword[];
  after_missing: Keyword[];
  edits: TailorEdit[];
  dropped: number;
  uses_left: number;
};

/** One line of a streamed run (`/api/tailor`, the API's `POST
 *  .../tailor/stream`): `asking` as the prompt goes to the model,
 *  `generating` once its answer is back, then `done` or `error`. Mirrors
 *  `TailorPhase`, `TailorDone` and `TailorFailed` in
 *  backend/app/schemas/tailor.py; change both or neither. */
export type TailorStreamEvent =
  | { type: "phase"; phase: "asking" | "generating" }
  | { type: "done"; result: TailorRunResult }
  | { type: "error"; status: number; message: string };

function post<T>(path: string, body: unknown): Promise<Result<T>> {
  return applicantCall<T>(`/tailor${path}`, { method: "POST", body: JSON.stringify(body) });
}

/** The picked resume's matched and missing keywords. Saves nothing but the
 *  posting's keyword cache and what an upload's reading adds to the bank. */
export async function matchTailor(
  postingId: string,
  source: TailorSource,
): Promise<Result<TailorMatch>> {
  return post<TailorMatch>("/match", { job_posting_id: postingId, ...source });
}

/** The resume a run tailored, as it prints, for the review's Before
 *  (`tailor-compare.tsx`): its name and its PDF, base64. A built resume is
 *  rendered again, so it shows as it stands now; an upload is its own file.
 *  `pdf` is null with no error for an upload pdf.js cannot draw (a DOCX).
 *  It takes ids, never a URL, so it is no fetch proxy (KAN-368). */
export async function readTailorSource(
  source: TailorSource,
): Promise<{ name: string | null; pdf: string | null; error: string | null }> {
  if ("built_resume_id" in source) {
    const [list, rendered] = await Promise.all([
      listBuiltResumes(),
      renderResumePdf(source.built_resume_id),
    ]);
    const name = list.data?.find((r) => r.id === source.built_resume_id)?.name ?? null;
    return { name, pdf: rendered.data?.pdf ?? null, error: rendered.error };
  }
  const { resume, pdf, listError, fileError } = await readUploadedResume(source.uploaded_resume_id);
  const error = listError ?? fileError ?? (resume ? null : "That resume is no longer here.");
  return { name: resume?.original_filename ?? null, pdf, error };
}
