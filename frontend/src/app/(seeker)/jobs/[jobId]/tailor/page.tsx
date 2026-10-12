import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { cn } from "@/lib/cn";
import { listResumes } from "@/lib/resume-actions";

import { SEEKER_GUTTER } from "../../../gutter";
import { ListingsError } from "../../listing-card";
import { getJobListing } from "../../listings";
import { BackToJobs } from "../page-actions";
import { Tailor } from "./tailor";

export async function generateMetadata({
  params,
}: PageProps<"/jobs/[jobId]/tailor">): Promise<Metadata> {
  const { jobId } = await params;
  const { job } = await getJobListing(jobId);
  return { title: job ? `Tailor for ${job.company}` : "Tailor My Resume" };
}

/**
 * /jobs/[jobId]/tailor (KAN-176): Tailor My Resume, reached from the job
 * posting's own page. The job is read the way that page reads it (404 when
 * it has closed); ./tailor.tsx does the rest.
 */
export default async function TailorPage({ params }: PageProps<"/jobs/[jobId]/tailor">) {
  const { jobId } = await params;
  const [{ job, error }, { resumes }] = await Promise.all([getJobListing(jobId), listResumes()]);

  if (error != null) {
    return (
      <div className={cn("max-w-app mx-auto w-full flex-1 py-6", SEEKER_GUTTER)}>
        <BackToJobs />
        <ListingsError error={error} retryHref={`/jobs/${encodeURIComponent(jobId)}/tailor`} />
      </div>
    );
  }
  if (job == null) notFound();

  return (
    <div className={cn("max-w-app mx-auto w-full flex-1 py-6", SEEKER_GUTTER)}>
      <BackToJobs />
      <h1 className="text-display text-ink mt-2">Tailor My Resume</h1>
      <p className="text-body text-ink-meta mt-1 mb-5 max-w-[68ch]">
        For {job.title} at {job.company}. We put what this posting asks about first and suggest
        rewordings in its language, never adding anything you haven&apos;t done.
      </p>
      <Tailor jobId={job.id} company={job.company} resumes={resumes} />
    </div>
  );
}
