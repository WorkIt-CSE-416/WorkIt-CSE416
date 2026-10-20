import "server-only";

import { applicantCall } from "@/lib/applicant-call";

import { NO_ANSWERS, type AutofillAnswers } from "./answers";

/** The seeker's saved answers (GET /applicants/{id}/autofill-answers), so a
 *  finished seeker who comes back sees what they picked. Every one unanswered
 *  when the API can't say: the step then asks afresh, and Continue sends only
 *  the answers picked, so nothing saved is cleared. */
export async function getAutofillAnswers(): Promise<AutofillAnswers> {
  const { data } = await applicantCall<Partial<AutofillAnswers>>("/autofill-answers");
  return { ...NO_ANSWERS, ...data };
}
