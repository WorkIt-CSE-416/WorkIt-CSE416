import { CloudSlashIcon } from "@phosphor-icons/react/ssr";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";

import { buttonClasses } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { getBank } from "@/lib/bank-actions";
import { getChoices, listBuiltResumes, renderResumePdf } from "@/lib/built-resume-actions";
import { cn } from "@/lib/cn";
import { getProfile } from "@/lib/profile-actions";

import { SEEKER_GUTTER } from "../../../gutter";
import { ListingsError } from "../../listing-card";
import { getJobListing } from "../../listings";
import { BackToJobs } from "../page-actions";
import { TailorReviewBar } from "./tailor-header";
import { TailorReview } from "./tailor-suggestions";
import { TailorScreen } from "./tailor-screen";

export async function generateMetadata({
  params,
}: PageProps<"/jobs/[jobId]/tailor">): Promise<Metadata> {
  const { jobId } = await params;
  const { job } = await getJobListing(jobId);
  return { title: job ? `Tailor for ${job.title}` : "Tailor" };
}

/**
 * /jobs/[jobId]/tailor, Tailor (KAN-217, docs/tailor_resume.md): opened
 * from "Tailor My Resume" on a job posting's page. It loads the posting and
 * draws the pick views (`TailorScreen`, each step with its own title, line
 * and job card) until the posting has a tailored resume, then that
 * resume's editor, Review Changes, on this route.
 */
export default async function TailorPage({
  params,
  searchParams,
}: PageProps<"/jobs/[jobId]/tailor">) {
  await connection();
  const { jobId } = await params;
  const [{ job, error }, resumes, query] = await Promise.all([
    getJobListing(jobId),
    listBuiltResumes(),
    searchParams,
  ]);
  if (error != null) {
    return (
      <div className={cn("max-w-dashboard mx-auto w-full flex-1 py-6", SEEKER_GUTTER)}>
        <BackToJobs />
        <ListingsError error={error} retryHref={`/jobs/${encodeURIComponent(jobId)}/tailor`} />
      </div>
    );
  }
  if (job == null) notFound();
  const tailored = resumes.data?.find((r) => r.job_posting_id === job.id) ?? null;
  const requestedId = typeof query.resumeId === "string" ? query.resumeId : null;
  // The review's Back: Choose Keywords again on the run's source, so a
  // posting with a tailored resume can be tailored again (the run replaces it)
  const source =
    query.step === "keywords" && typeof query.source === "string" ? query.source : null;
  const restart = source != null || query.step === "pick";
  const resume = restart
    ? null
    : (resumes.data?.find((r) => r.id === requestedId && r.job_posting_id === job.id) ?? tailored);

  if (resume) {
    const rendered = renderResumePdf(resume.id);
    const [bank, choices, { profile, error: profileError }] = await Promise.all([
      getBank(resume.id),
      getChoices(resume.id),
      getProfile(),
    ]);
    const editorError = bank.error ?? choices.error ?? profileError;

    return (
      // A WORK AREA, NOT A READING PAGE, laid out as a Google Doc (KAN-499):
      // the resume and the Suggestions panel run to the page's edges, with a
      // 16px gutter and no width cap, since every pixel helps. The resume
      // itself stops at its zoom, centred in its column, so a very wide
      // window gives the page room around it and does not blow it up.
      // Home's cap and the seekers' gutter left about 50px each side here
      <div className="flex-1 px-4 pt-3 pb-4">
        <div className="w-full">
          <TailorReviewBar job={job} resumeId={resume.id} />
          {bank.data && choices.data && profile ? (
            <TailorReview
              name={resume.name}
              job={job}
              resumeId={resume.id}
              initial={rendered}
              initialBank={bank.data}
              initialChoices={choices.data}
              initialHeader={profile}
            />
          ) : (
            <EmptyState
              Icon={CloudSlashIcon}
              title="This Resume Isn't Loading Right Now"
              className="mt-4"
              action={
                <a
                  href={`/jobs/${encodeURIComponent(job.id)}/tailor?resumeId=${encodeURIComponent(
                    resume.id,
                  )}`}
                  className={buttonClasses({ variant: "secondary", size: "sm" })}
                >
                  Try Again
                </a>
              }
            >
              {editorError}
            </EmptyState>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className={cn("max-w-dashboard mx-auto w-full flex-1 py-6", SEEKER_GUTTER)}>
      <TailorScreen
        jobId={job.id}
        job={job}
        start={source ? { step: "keywords", source } : undefined}
      />
    </div>
  );
}
