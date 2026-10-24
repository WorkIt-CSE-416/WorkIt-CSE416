import type { Metadata } from "next";
import { connection } from "next/server";
import { redirect } from "next/navigation";

import { getSavedFilters } from "@/app/(seeker)/jobs/listings";
import { getAutofillAnswers } from "@/lib/autofill-answers-actions";
import { getCurrentAccount, getSessionUser } from "@/lib/session";

import { OnboardingForm } from "./onboarding-form";
import { getRoleOptions } from "./role-options";

export const metadata: Metadata = {
  title: "Set Up Your Profile",
  description: "Tell us what you're looking for so we can match you with the right roles.",
};

/**
 * /onboarding/applicant — where sign-in sends a seeker until they finish it.
 * Its last step uploads a resume (KAN-275), then opens /jobs.
 *
 * Outside both shells, like /login: a first-time user has no top bar to sit
 * under yet. The whole screen is ./onboarding-form: the question on the left,
 * the step rail and the fields on the right.
 *
 * Sign-in sends only an applicant who hasn't finished onboarding here
 * (docs/auth.md); signed out goes to sign-in. A finished applicant can still
 * come back by opening this page again: the form opens on their saved
 * answers, and Continue saves the edits. ?step=2 opens it on the second
 * step, Profile; intake's "Back to Pay & Visa" linked there until KAN-275
 * took intake out of onboarding. The second step is honoured only with saved answers,
 * since the first holds the answers that must be given and Continue on the
 * last saves without them.
 *
 * The Role step's pickers offer what the Jobs page's filters offer
 * (./role-options, shared with Settings' Job Preferences).
 */
export default async function ApplicantOnboardingPage({
  searchParams,
}: PageProps<"/onboarding/applicant">) {
  await connection();
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const account = await getCurrentAccount();
  if (account?.account_type === "company") redirect("/onboarding/company");

  const [options, saved, savedAnswers, params] = await Promise.all([
    getRoleOptions(),
    getSavedFilters(),
    getAutofillAnswers(),
    searchParams,
  ]);

  return (
    <OnboardingForm
      {...options}
      initial={saved ?? undefined}
      initialAnswers={savedAnswers.answers}
      email={user.email}
      startStep={params.step === "2" && saved ? 1 : 0}
    />
  );
}
