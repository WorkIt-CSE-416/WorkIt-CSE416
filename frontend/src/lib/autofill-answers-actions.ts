"use server";

import { applicantCall } from "@/lib/applicant-call";

import { NO_ANSWERS, type AutofillAnswers } from "./autofill-answers";

/**
 * The seeker's answer bank (KAN-283): what onboarding's Profile step and My
 * Profile's Application Questions read and save. Through applicantCall, as
 * every applicant action is: identity from the session, never an argument,
 * and the API checks each answer against its options.
 */

/** The saved answers, every one null when none are saved. On a failed read
 *  `answers` is all null too, and `error` says why: onboarding asks afresh,
 *  and My Profile says the page did not load. */
export async function getAutofillAnswers(): Promise<{
  answers: AutofillAnswers;
  error: string | null;
}> {
  const { data, error } = await applicantCall<Partial<AutofillAnswers>>("/autofill-answers");
  return { answers: { ...NO_ANSWERS, ...data }, error };
}

/** Saves `changed` alone (PATCH): a null clears that answer, and a key left
 *  out keeps its answer, since the API merges into what it holds. So an
 *  answer the screen never loaded is never erased. Answers the whole bank
 *  after the write. */
export async function saveAutofillAnswers(
  changed: Partial<AutofillAnswers>,
): Promise<{ answers: AutofillAnswers | null; error: string | null }> {
  if (Object.keys(changed).length === 0) return { answers: null, error: null };
  const { data, error } = await applicantCall<Partial<AutofillAnswers>>("/autofill-answers", {
    method: "PATCH",
    body: JSON.stringify(changed),
  });
  return { answers: data ? { ...NO_ANSWERS, ...data } : null, error };
}
