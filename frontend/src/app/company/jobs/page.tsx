import type { Metadata } from "next";
import { connection } from "next/server";

import { ButtonLink } from "@/components/ui/button";
import { listCompanyJobs } from "@/lib/job-queries";

import { toPosting } from "./data";
import { JobsTable } from "./jobs-table";
import { LoadError } from "./load-error";

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
    <div className="max-w-app mx-auto w-full flex-1 px-4 py-6 sm:px-8 lg:px-12">
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
