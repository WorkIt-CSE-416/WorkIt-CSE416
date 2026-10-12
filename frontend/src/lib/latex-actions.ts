"use server";

import { call } from "@/lib/applicant-call";

/**
 * Server actions for an applicant's own LaTeX resume (KAN-176):
 * backend/app/routers/latex_resumes.py. The API reads the LaTeX; this side
 * never parses it. Every call sends the whole source it was made against,
 * with edits to it by field id, and gets the new source and fields back, so
 * nothing about a resume being edited is kept on the server between calls.
 * The PDF preview is a route handler (app/api/latex/preview), since its
 * answer is a file, and the editor's first read is latex-queries.ts.
 */

// Mirrors backend/app/schemas/latex.py.
export type LatexField = {
  id: string;
  kind: "heading" | "bullet" | "text";
  /** Plain text (**bold**, *italic*) when editable, else the raw LaTeX */
  text: string;
  editable: boolean;
  /** Which \section it falls under; -1 before the first (the name block) */
  section: number;
  line: number;
};

export type LatexOp =
  { edit: string; text: string } | { after: string; text: string } | { delete: string };

export type LatexDoc = { source: string; fields: LatexField[] };

export type LatexSuggestion = { field_id: string; original: string; suggested: string };

type Saved = { id: string; original_filename: string; pages: number };

const seg = encodeURIComponent;

/** The source with `ops` applied, and its fields. Saves nothing. */
export async function latexFields(source: string, ops: LatexOp[] = []) {
  return call<LatexDoc>("/latex/fields", { method: "POST", body: JSON.stringify({ source, ops }) });
}

/** Saves a new LaTeX resume: one pasted in, or (with `targetJobId`) a copy
 *  tailored to a job posting, made by `ops` on its source. */
export async function importLatex(
  source: string,
  name: string,
  { ops = [], targetJobId }: { ops?: LatexOp[]; targetJobId?: string } = {},
) {
  return call<Saved>("/latex", {
    method: "POST",
    body: JSON.stringify({ source, ops, name, target_job_id: targetJobId ?? null }),
  });
}

export async function saveLatex(resumeId: string, source: string, ops: LatexOp[] = []) {
  return call<LatexDoc & { pages: number }>(`/resumes/${seg(resumeId)}/latex`, {
    method: "PUT",
    body: JSON.stringify({ source, ops }),
  });
}

/** Rewordings of the bullets this posting talks about most; saves nothing. */
export async function tailorLatex(resumeId: string, jobId: string) {
  return call<{ source: string; suggestions: LatexSuggestion[]; notice: string | null }>(
    `/resumes/${seg(resumeId)}/latex/tailor`,
    { method: "POST", body: JSON.stringify({ job_id: jobId }) },
  );
}
