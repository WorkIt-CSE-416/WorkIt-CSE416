import "server-only";

import { apiGet } from "@/lib/api";
import { getApplicantSession } from "@/lib/session";

import { NO_ANSWERS, type AutofillAnswers } from "./answers";

/** The seeker's saved answers (GET /applicants/{id}/autofill-answers), so
 *  coming back from intake shows what they picked. Every one unanswered when
 *  the API can't say: the step then asks afresh, and Continue sends only the
 *  answers picked, so nothing saved is cleared. */
export async function getAutofillAnswers(): Promise<AutofillAnswers> {
  try {
    const { id, token } = await getApplicantSession();
    const res = await apiGet(`/applicants/${id}/autofill-answers`, token);
    if (!res.ok) return NO_ANSWERS;
    return { ...NO_ANSWERS, ...((await res.json()) as Partial<AutofillAnswers>) };
  } catch {
    return NO_ANSWERS;
  }
}
