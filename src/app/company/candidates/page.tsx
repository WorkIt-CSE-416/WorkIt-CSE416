import type { Metadata } from "next";

import { CandidatesTable } from "./candidates-table";

export const metadata: Metadata = {
  title: "Candidates",
  description: "Everyone who has applied, across every role.",
};

/**
 * /company/candidates — people, cut across postings.
 *
 * The applicants for one role live under that role, at
 * /company/jobs/[jobId]/applicants. This screen is the other axis: someone who
 * applied to three postings is one person here and three applicants there.
 * Both views are wanted, which is why this is a sibling of /company/jobs and
 * not a tab inside it.
 */
export default function CompanyCandidatesPage() {
  return (
    <div className="max-w-app mx-auto w-full flex-1 px-6 py-6 sm:px-12">
      <header className="mb-5">
        <h1 className="text-heading text-ink">Candidates</h1>
        <p className="text-body text-ink-meta mt-1">
          Everyone who has applied to you, across every posting.
        </p>
      </header>

      <CandidatesTable />
    </div>
  );
}
