import type { Metadata } from "next";

import { ButtonLink } from "@/components/ui/button";

import { JobsTable } from "./jobs-table";

export const metadata: Metadata = {
  title: "Job Postings",
  description: "Every role this company has open.",
};

/**
 * /company/jobs — the roles a company has posted.
 *
 * Not to be confused with the seeker's /jobs, which is the browse-and-match
 * screen. Same word, opposite side of the same object: one lists roles you
 * could apply to, the other lists roles you are hiring for. The prefix is what
 * lets both keep the honest name.
 *
 * The per-role screens hang off this one — /company/jobs/[jobId] and its
 * applicants list — so this page is the index, not the detail.
 */
export default function CompanyJobsPage() {
  return (
    <div className="max-w-app mx-auto w-full flex-1 px-6 py-6 sm:px-12">
      {/* The action sits with the list it adds to rather than in the shell's
          bar. items-start keeps the button on the heading's line rather than
          centred against a two-line block, so it lines up with the title
          instead of drifting toward the description. */}
      <header className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-heading text-ink">Job Postings</h1>
          <p className="text-body text-ink-meta mt-1">
            Every role you have open, and how far along each one is.
          </p>
        </div>

        <ButtonLink href="/company/jobs/new" className="shrink-0">
          Post a Job
        </ButtonLink>
      </header>

      <JobsTable />
    </div>
  );
}
