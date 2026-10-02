import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { getCompanyJob } from "@/lib/job-actions";

import { Composer } from "../../new/composer";
import { fromCompanyJob } from "../../new/payload";

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

  const { draft, location } = fromCompanyJob(job);

  return <Composer editing={{ id: job.id, status: job.status, draft, location }} />;
}
