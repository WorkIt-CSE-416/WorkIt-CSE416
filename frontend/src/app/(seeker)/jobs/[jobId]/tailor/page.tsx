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
      <div className={cn("max-w-app mx-auto w-full flex-1 py-6", SEEKER_GUTTER)}>
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
      // A WORK AREA, NOT A READING PAGE: the resume and the Suggestions
      // panel sit side by side, so every pixel helps. No max-w-app, and when
      // the sidebar collapses the page takes back the room the shell holds
      // empty (--panel-gain), as the Applications page does (../../../
      // applications/page.tsx says how; this wrapper carries its own copy of
      // the property, which does not inherit). The content stops at the
      // Dashboard's cap, so a very wide window does not blow the resume up.
      // At max-w-app the resume and panel were squeezed between two wide
      // margins with the sidebar closed.
      <div
        className={cn(
          "-mx-[calc(var(--panel-gain)/2)] flex-1 py-6 transition-[--panel-gain] duration-200 ease-linear md:in-data-[pinned=false]:[--panel-gain:calc(var(--sidebar-width)_-_var(--sidebar-width-icon))]",
          SEEKER_GUTTER,
        )}
      >
        <div className="max-w-dashboard mx-auto w-full">
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
    <div className={cn("max-w-app mx-auto w-full flex-1 py-6", SEEKER_GUTTER)}>
      <TailorScreen
        jobId={job.id}
        job={job}
        start={source ? { step: "keywords", source } : undefined}
      />
    </div>
  );
}
