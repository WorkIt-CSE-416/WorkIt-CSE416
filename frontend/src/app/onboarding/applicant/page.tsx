import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { seasonLabel } from "@/app/(seeker)/jobs/filter-query";
import { getJobFacets, getJobLocations, getSavedFilters } from "@/app/(seeker)/jobs/listings";
import { getCurrentAccount, getSessionUser } from "@/lib/session";

import { OnboardingForm } from "./onboarding-form";

export const metadata: Metadata = {
  title: "Set Up Your Profile",
  description: "Tell us what you're looking for so we can match you with the right roles.",
};

/**
 * /onboarding/applicant — where sign-in sends a seeker until they finish it.
 * Continue leads to intake (./bank, KAN-214), whose Finish opens /jobs.
 *
 * Outside both shells, like /login: a first-time user has no top bar to sit
 * under yet. The whole screen is ./onboarding-form, a split like /login's:
 * Scout's question on the left, the fields on the right.
 *
 * Sign-in sends only an applicant who hasn't finished onboarding here
 * (docs/auth.md); signed out goes to sign-in. A finished applicant can still
 * come back, from intake's "Back to Profile": the form opens on their saved
 * answers, and Continue saves the edits.
 *
 * The Role and Location pickers offer what the Jobs page's filters offer, from
 * the same cached API calls (../../(seeker)/jobs/listings). Either comes back
 * empty when the API is down, and its picker then says nothing matches.
 */
export default async function ApplicantOnboardingPage() {
  if (!(await getSessionUser())) redirect("/login");
  const account = await getCurrentAccount();
  if (account?.account_type === "company") redirect("/onboarding/company");

  const [facets, locations, saved] = await Promise.all([
    getJobFacets(),
    getJobLocations(),
    getSavedFilters(),
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
      seasons={facets.start_term.map((t) => ({
        value: t.value,
        label: seasonLabel(t.value),
        count: t.jobs,
      }))}
      initial={saved ?? undefined}
    />
  );
}
