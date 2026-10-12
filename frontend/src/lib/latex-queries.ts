import "server-only";

import { apiGet } from "@/lib/api";
import { extractErrorMessage } from "@/lib/auth";
import type { LatexDoc } from "@/lib/latex-actions";
import { getApplicantSession } from "@/lib/session";

/** One of the applicant's own LaTeX resumes, its source and fields, for the
 *  editor's Server Component. A read only a page calls, so not an action
 *  (lib/job-queries.ts says why). `missing` is a 404: not theirs, or not a
 *  LaTeX resume. */
export async function getLatex(
  resumeId: string,
): Promise<{ doc: LatexDoc | null; error: string | null; missing: boolean }> {
  try {
    const { id, token } = await getApplicantSession();
    const res = await apiGet(
      `/applicants/${id}/resumes/${encodeURIComponent(resumeId)}/latex`,
      token,
    );
    if (res.status === 404) return { doc: null, error: null, missing: true };
    if (!res.ok) return { doc: null, error: await extractErrorMessage(res), missing: false };
    return { doc: (await res.json()) as LatexDoc, error: null, missing: false };
  } catch {
    return { doc: null, error: "Could not reach the server.", missing: false };
  }
}
