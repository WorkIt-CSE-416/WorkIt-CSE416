import type { Metadata } from "next";
import { connection } from "next/server";

import { ButtonLink } from "@/components/ui/button";
import { listCompanyJobs } from "@/lib/job-queries";

import { COMPANY_PAGE } from "../../frame";
import { toPosting } from "../data";
import { JobsTable } from "../jobs-table";
import { LoadError } from "../load-error";

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
export default async function CompanyJobsPage() {
  // The rows are this company's, so the page is per request. Without this a
  // build with no Supabase env prerenders it once, with the error baked in.
  await connection();
  const { jobs, error } = await listCompanyJobs();

  return (
    <div className={COMPANY_PAGE}>
      {/* The action sits with the list it adds to rather than in the shell's
          bar, at the top right of the page, where the page's heading was
          before the title moved into the bar (../bar-title.tsx). */}
      <div className="mb-5 flex justify-end">
        <ButtonLink href="/company/jobs/new" size="sm">
          Post a Job
        </ButtonLink>
      </div>

      {/* A failed load replaces the table rather than sitting above it: an
          empty table under the error said "0 total" and blamed the filters.
          An empty company and an empty filter result are different news too:
          the first needs a way forward, the second a hint to loosen up. */}
      {error ? (
        <LoadError
          error={error}
          title="Job Postings Aren't Loading Right Now"
          subject="your job postings"
          retryHref="/company/jobs"
        />
      ) : (
        <JobsTable
          postings={jobs.map(toPosting)}
          empty={
            jobs.length === 0
              ? "No job postings yet. Post your first role."
              : "No postings match those filters."
          }
        />
      )}
    </div>
  );
}
