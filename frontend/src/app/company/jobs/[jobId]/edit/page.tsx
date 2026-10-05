import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { getCompanyJob } from "@/lib/job-queries";

import { Composer } from "../../new/composer";

export const metadata: Metadata = {
  title: "Edit Job",
  description: "Change a job posting's details.",
};

/**
 * /company/jobs/[jobId]/edit — the post-a-job composer, filled in from a
 * saved job. Another company's job, or one that doesn't exist, is a 404:
 * the API answers both the same way on purpose.
 */
export default async function EditJobPage({ params }: PageProps<"/company/jobs/[jobId]/edit">) {
  const { jobId } = await params;
  const { job, error } = await getCompanyJob(jobId);

  if (error) {
    return (
      <div className="max-w-app mx-auto w-full flex-1 px-6 py-6 sm:px-12">
        <p className="text-meta text-danger">{error}</p>
      </div>
    );
  }
  if (!job) notFound();

  // The raw job, not a draft built here: the closing date has to become a
  // calendar day in the recruiter's timezone, which only the browser knows.
  // See the `editing` state in <Composer>.
  return <Composer job={job} />;
}
