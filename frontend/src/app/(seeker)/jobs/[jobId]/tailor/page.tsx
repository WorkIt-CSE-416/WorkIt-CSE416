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
import { Editor } from "../../../resumes/[resumeId]/editor";
import { ListingsError } from "../../listing-card";
import { getJobListing } from "../../listings";
import { BackToJobs } from "../page-actions";
import { TailorScore } from "./tailor-score";
import { TailorSteps } from "./tailor-steps";
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
 * shows the tailored resume's editor on this route once one exists.
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
  const resume =
    resumes.data?.find((r) => r.id === requestedId && r.job_posting_id === job.id) ?? tailored;

  if (resume) {
    const rendered = renderResumePdf(resume.id);
    const [bank, choices, { profile, error: profileError }] = await Promise.all([
      getBank(resume.id),
      getChoices(resume.id),
      getProfile(),
    ]);
    const editorError = bank.error ?? choices.error ?? profileError;

    return (
      <div className={cn("max-w-app mx-auto w-full flex-1 py-6", SEEKER_GUTTER)}>
        <BackToJobs />
        <TailorSteps current="review" />
        <h1 className="text-heading text-ink">{resume.name}</h1>
        <p className="text-body text-ink-meta mt-1">
          Tailored for {job.title} at {job.company}
        </p>
        <TailorScore resumeId={resume.id} />
        {bank.data && choices.data && profile ? (
          <Editor
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
    );
  }

  return (
    <div className={cn("max-w-app mx-auto w-full flex-1 py-6", SEEKER_GUTTER)}>
      <BackToJobs />
      <h1 className="text-heading text-ink">Tailor</h1>
      <p className="text-body text-ink-meta mt-1">
        {job.title} at {job.company}
      </p>
      <TailorScreen jobId={job.id} title={job.title} />
    </div>
  );
}
