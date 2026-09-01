import type { Metadata } from "next";

import { Placeholder } from "../placeholder";

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
    <Placeholder
      title="Job Postings"
      description="Every role you have open, and how far along each one is."
    >
      One row per posting with its status, applicant count and close date, plus the filters to cut
      that list down. Each row opens the posting at /company/jobs/[jobId].
    </Placeholder>
  );
}
