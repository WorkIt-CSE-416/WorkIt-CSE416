import type { Metadata } from "next";
import { connection } from "next/server";
import { redirect } from "next/navigation";

import { getSavedFilters } from "@/app/(seeker)/jobs/listings";
import { getAutofillAnswers } from "@/lib/autofill-answers-actions";
import { getProfile } from "@/lib/profile-actions";
import { getCurrentAccount, getSessionUser } from "@/lib/session";

import { OnboardingForm } from "./onboarding-form";
import { getRoleOptions } from "./role-options";
import { EXTENSION_STEP_PATH, startStep } from "./steps";

export const metadata: Metadata = {
  title: "Set Up Your Profile",
  description: "Tell us what you're looking for so we can match you with the right roles.",
};

/**
 * /onboarding/applicant — where sign-in sends a seeker until they finish it.
 * Its second step reads a resume and saves it once the seeker confirms
 * (KAN-372); the last opens /jobs.
 *
 * Outside both shells, like /login: a first-time user has no top bar to sit
 * under yet. The whole screen is ./onboarding-form: the question on the left,
 * the step rail and the fields on the right.
 *
 * Sign-in sends only an applicant who hasn't finished onboarding here
 * (docs/auth.md); signed out goes to sign-in. A finished applicant can still
 * come back by opening this page again: the form opens on their saved
 * answers, and Finish saves the edits. ?step=2 opens it on Profile, now
 * the third step (KAN-372); intake's "Back to Pay & Visa" linked there until
 * KAN-275 took intake out of onboarding. ?step=extension opens it on the
 * extension's install step: the tab the WorkIt extension opens when it is
 * added (KAN-471), signed out by way of sign-in. Each is honoured only with
 * saved answers (./steps' startStep), since the first step holds the
 * answers that must be given and Finish on the last saves without them.
 *
 * The Role step's pickers offer what the Jobs page's filters offer
 * (./role-options, shared with Settings' Job Preferences).
 */
export default async function ApplicantOnboardingPage({
  searchParams,
}: PageProps<"/onboarding/applicant">) {
  await connection();
  const user = await getSessionUser();
  if (!user) {
    // The extension's install tab (KAN-471) comes back to its step after a password sign-in.
    const { step } = await searchParams;
    redirect(
      step === "extension" ? `/login?next=${encodeURIComponent(EXTENSION_STEP_PATH)}` : "/login",
    );
  }
  const account = await getCurrentAccount();
  if (account?.account_type === "company") redirect("/onboarding/company");

  const [options, saved, savedAnswers, { profile }, params] = await Promise.all([
    getRoleOptions(),
    getSavedFilters(),
    getAutofillAnswers(),
    getProfile(),
    searchParams,
  ]);

  return (
    <OnboardingForm
      {...options}
      initial={saved ?? undefined}
      initialAnswers={savedAnswers.answers}
      initialContact={
        profile
          ? {
              location: profile.location,
              linkedin_url: profile.linkedin_url,
              github_url: profile.github_url,
              portfolio_url: profile.portfolio_url,
            }
          : undefined
      }
      email={user.email}
      startStep={startStep(params.step, saved != null)}
    />
  );
}
