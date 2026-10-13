import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { listBuiltResumes } from "@/lib/built-resume-actions";
import { cn } from "@/lib/cn";

import { SEEKER_GUTTER } from "../../../gutter";
import { ListingsError } from "../../listing-card";
import { getJobListing } from "../../listings";
import { BackToJobs } from "../page-actions";
import { TailorScreen } from "./tailor-screen";

export async function generateMetadata({
  params,
}: PageProps<"/jobs/[jobId]/tailor">): Promise<Metadata> {
  const { jobId } = await params;
  const { job } = await getJobListing(jobId);
  return { title: job ? `Tailor for ${job.title}` : "Tailor" };
}

/**
 * /jobs/[jobId]/tailor, Tailor (KAN-217): opened from "Tailor My Resume" on
 * a job posting's page. The page loads the posting and whether a tailored
 * resume for it exists; the run itself waits for the student's click,
 * because each run spends one of today's Tailor runs.
 */
export default async function TailorPage({ params }: PageProps<"/jobs/[jobId]/tailor">) {
  const { jobId } = await params;
  const [{ job, error }, resumes] = await Promise.all([getJobListing(jobId), listBuiltResumes()]);
  if (error != null) {
    return (
      <div className={cn("max-w-app mx-auto w-full flex-1 py-6", SEEKER_GUTTER)}>
        <BackToJobs />
        <ListingsError error={error} retryHref={`/jobs/${encodeURIComponent(jobId)}/tailor`} />
      </div>
    );
  }
  if (job == null) notFound();
  const tailored = resumes.data?.find((r) => r.job_posting_id === job.id) ?? null;

  return (
    <div className={cn("max-w-app mx-auto w-full flex-1 py-6", SEEKER_GUTTER)}>
      <BackToJobs />
      <h1 className="text-heading text-ink">Tailor</h1>
      <p className="text-body text-ink-meta mt-1">
        {job.title} at {job.company}
      </p>
      <TailorScreen jobId={job.id} title={job.title} tailoredName={tailored?.name ?? null} />
    </div>
  );
}
