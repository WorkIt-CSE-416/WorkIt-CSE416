import type { Metadata } from "next";
import { connection } from "next/server";
import { redirect } from "next/navigation";

import { seasonLabel } from "@/app/(seeker)/jobs/filter-query";
import { getJobFacets, getJobLocations, getSavedFilters } from "@/app/(seeker)/jobs/listings";
import { getAutofillAnswers } from "@/lib/autofill-answers-actions";
import { getCurrentAccount, getSessionUser } from "@/lib/session";

import { OnboardingForm } from "./onboarding-form";

export const metadata: Metadata = {
  title: "Set Up Your Profile",
  description: "Tell us what you're looking for so we can match you with the right roles.",
};

/** The month each season starts, 0 for January. */
const SEASON_START: Record<string, number> = { winter: 0, spring: 2, summer: 5, fall: 8 };

/** Start Date offers only seasons still ahead (KAN-275): a bare year ("2027",
 *  postings that name no season) says nothing a student can plan by, and a
 *  season already under way (Fall 2026 in October) is too late to start. All
 *  Filters still offers both. A month is coarse enough that the server's UTC
 *  clock does not matter. */
function upcoming({ value }: { value: string }) {
  const [season, year] = value.split("-");
  return year != null && new Date(Number(year), SEASON_START[season]) > new Date();
}

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
 * The Role and Location pickers offer what the Jobs page's filters offer, from
 * the same cached API calls (../../(seeker)/jobs/listings). Either comes back
 * empty when the API is down, and its picker then says nothing matches.
 */
export default async function ApplicantOnboardingPage({
  searchParams,
}: PageProps<"/onboarding/applicant">) {
  await connection();
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const account = await getCurrentAccount();
  if (account?.account_type === "company") redirect("/onboarding/company");

  const [facets, locations, saved, savedAnswers, params] = await Promise.all([
    getJobFacets(),
    getJobLocations(),
    getSavedFilters(),
    getAutofillAnswers(),
    searchParams,
  ]);

  return (
    <OnboardingForm
      roles={facets.role.map((r) => ({ value: r.value, label: r.label, count: r.jobs }))}
      places={locations.map((p) => ({
        value: p.code,
        label: p.label,
        count: p.jobs,
        nested: p.code.includes("-"),
      }))}
      seasons={facets.start_term.filter(upcoming).map((t) => ({
        value: t.value,
        label: seasonLabel(t.value),
        count: t.jobs,
      }))}
      initial={saved ?? undefined}
      initialAnswers={savedAnswers.answers}
      email={user.email}
      startStep={params.step === "2" && saved ? 1 : 0}
    />
  );
}
