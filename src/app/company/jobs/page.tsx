import type { Metadata } from "next";

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
      <header className="mb-5">
        <h1 className="text-heading text-ink">Job Postings</h1>
        <p className="text-body text-ink-meta mt-1">
          Every role you have open, and how far along each one is.
        </p>
      </header>

      <JobsTable />
    </div>
  );
}
