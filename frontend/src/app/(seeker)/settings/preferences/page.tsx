import type { Metadata } from "next";

import { getRoleOptions } from "@/app/onboarding/applicant/role-options";
import { Card } from "@/components/ui/card";
import { SectionHeading } from "@/components/ui/section-heading";

import { getSavedFilters } from "../../jobs/listings";
import { PreferencesForm } from "./preferences-form";

export const metadata: Metadata = { title: "Job Preferences" };

/**
 * The job preferences onboarding saved, edited here with onboarding's own
 * fields (KAN-326, ./preferences-form). No other screen edits them: the
 * Jobs page reads them for a bare /jobs, then keeps its filters in the URL.
 * A failed read shows a notice, never an empty form whose Save would
 * replace what is saved.
 */
export default async function PreferencesPage() {
  const [saved, options] = await Promise.all([getSavedFilters(), getRoleOptions()]);

  return (
    <Card as="section" aria-labelledby="job-preferences" className="flex flex-col gap-4">
      <SectionHeading id="job-preferences">Job Preferences</SectionHeading>
      <p className="text-body text-ink-meta">
        What you&apos;re looking for. The Jobs page starts filtered by these each time you open it.
      </p>
      {saved ? (
        <PreferencesForm initial={saved} {...options} />
      ) : (
        <p role="status" className="text-body text-ink-meta">
          Your job preferences didn&apos;t load. Refresh the page to try again.
        </p>
      )}
    </Card>
  );
}
