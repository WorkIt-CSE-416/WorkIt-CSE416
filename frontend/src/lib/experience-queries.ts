import "server-only";

import { apiGet } from "@/lib/api";
import { extractErrorMessage } from "@/lib/auth";
import type { Bank } from "@/lib/experience-actions";
import { getApplicantSession } from "@/lib/session";

/** The signed-in applicant's Experience Bank, for the Server Component that
 *  draws it. A read only a page calls, so not an action (lib/job-queries.ts
 *  says why). */
export async function getBank(): Promise<{ bank: Bank | null; error: string | null }> {
  try {
    const { id, token } = await getApplicantSession();
    const res = await apiGet(`/applicants/${id}/experience`, token);
    if (!res.ok) return { bank: null, error: await extractErrorMessage(res) };
    return { bank: (await res.json()) as Bank, error: null };
  } catch {
    return { bank: null, error: "Could not reach the server." };
  }
}
