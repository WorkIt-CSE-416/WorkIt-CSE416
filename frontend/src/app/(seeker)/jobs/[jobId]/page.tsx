import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { SparkleIcon } from "@/components/icons";
import { CompanyLogo } from "@/components/company-logo";
import type { JobPosting } from "@/components/job-detail/data";
import { JobDetailHeader } from "@/components/job-detail/job-detail-header";
import { NOT_LISTED } from "@/components/job-posting-card";
import { AskScoutButton } from "@/components/scout/scout-buttons";
import { ButtonLink } from "@/components/ui/button";
import { Section } from "@/components/ui/section";
import { listBuiltResumes } from "@/lib/built-resume-actions";
import { cn } from "@/lib/cn";
import { listSentResumes } from "@/lib/sent-resume-actions";

import { SEEKER_GUTTER } from "../../gutter";
import { placesOf } from "../format";
import { getApplicationStage } from "../../auto-apply/applications";
import { AutoApplyButton } from "../../auto-apply/auto-apply-button";
import { SaveJobButton } from "../save-job-button";
import { ListingsError, listingFacts } from "../listing-card";
import { getApplied, getJobListing, type JobListing } from "../listings";
import { ApplyButton } from "./apply-button";
import { JobDescription } from "./description";
import { AppliedNote, BackToJobs, MoreActions } from "./page-actions";
import { SentNote } from "./sent-note";

export async function generateMetadata({ params }: PageProps<"/jobs/[jobId]">): Promise<Metadata> {
  const { jobId } = await params;
  const { job, error } = await getJobListing(jobId);
  if (job) return { title: `${job.title} at ${job.company}` };
  return { title: error != null ? "Jobs Aren't Loading" : "Job Not Found" };
}

/**
 * /jobs/[jobId] — one live role's own page, opened from its card's title on
 * /jobs or /search (KAN-73). `jobId` is the row's UUID; `GET /jobs/{id}`
 * answers with the role and its description, or 404 for one that has closed,
 * a company's own posting, or no such job, all of which get not-found.tsx.
 *
 * THE MOCK'S HEADER, WITH THE CARD'S FACTS. `JobDetailHeader` is shared with
 * the company's view of its own postings, so the live role is shaped into its
 * `JobPosting` (`toPosting`), with the six facts the card prints
 * (`listingFacts`), so a role reads the same on its card and its page. A fact
 * the posting doesn't state is left out, not marked.
 *
 * ONE "ABOUT THE ROLE", NOT THE MOCK'S THREE SECTIONS. A scraped posting is
 * plain text in whatever order its employer wrote it; ./description reads its
 * paragraphs, lists and subheadings from the text itself rather than sorting
 * it into "What You'll Do" and "Qualifications" by guesswork.
 *
 * Its actions, in one row (KAN-250): Save, then the "…" menu (Copy Link
 * and Report, ./page-actions), Ask Scout, Auto Apply (queues it for the Auto
 * Apply page, as on the card), Tailor My Resume (./tailor, KAN-217; "Your
 * Tailored Resume" once the student has one for this posting) and Apply Now.
 * Apply Now asks which resume to send, keeps it as a sent resume linked to
 * this posting, then leaves for the employer's posting (./apply-button,
 * KAN-220); once one is sent, the page says "You sent <name> on <date>"
 * (./sent-note, story 98). After the seeker leaves for the posting, the same
 * dialog asks "Did You Apply?" (KAN-242); Yes marks the job applied (KAN-232),
 * the page says "You applied on <date>", and the job leaves their feed. There
 * is no Applied button: one misclick marked a job applied with no undo. Save
 * keeps the job in My Applications (KAN-261); Report is still inert. No
 * match rail: nothing scores a role yet, and an empty ring here would read as
 * a verdict.
 */
export default async function JobDetailPage({ params }: PageProps<"/jobs/[jobId]">) {
  const { jobId } = await params;
  const [{ job, error }, resumes, sent, applied, stage] = await Promise.all([
    getJobListing(jobId),
    listBuiltResumes(),
    listSentResumes(),
    getApplied(jobId),
    getApplicationStage(jobId),
  ]);
  const tailored = resumes.data?.some((r) => r.job_posting_id === job?.id) ?? false;
  // Newest first, so the first match is the last one sent to this posting.
  const lastSent = sent.data?.find((s) => s.job_posting_id === job?.id) ?? null;

  if (error != null) {
    return (
      <div className={cn("max-w-app mx-auto w-full flex-1 py-6", SEEKER_GUTTER)}>
        <BackToJobs />
        <ListingsError error={error} retryHref={`/jobs/${encodeURIComponent(jobId)}`} />
      </div>
    );
  }
  if (job == null) notFound();
  const places = placesOf(job.location_label ?? job.location);

  return (
    <div className={cn("max-w-app mx-auto w-full flex-1 py-6", SEEKER_GUTTER)}>
      <BackToJobs />

      <JobDetailHeader
        posting={toPosting(job)}
        // The employer's own logo, as on the card, at the header's 32px; its
        // initials when it has none.
        tile={
          <CompanyLogo name={job.company} src={job.logo_url} className="text-meta size-8 rounded" />
        }
        // Under the title at every width: beside it, six controls squeezed the
        // title to a word a line (KAN-246).
        actionsBelow
        actions={
          <>
            {/* Outlined like the feed card's icon actions. */}
            <SaveJobButton jobId={job.id} title={job.title} stage={stage} />
            <MoreActions title={job.title} />
            <AskScoutButton id={job.id} title={job.title} company={job.company} />
            {/* Only where auto apply can fill the form (Greenhouse for now). */}
            {job.auto_apply && (
              <AutoApplyButton
                jobId={job.id}
                title={job.title}
                company={job.company}
                stage={stage}
              />
            )}
            <ButtonLink
              href={`/jobs/${encodeURIComponent(job.id)}/tailor`}
              variant="secondary"
              size="sm"
              className="shrink-0"
            >
              <SparkleIcon className="size-4" />
              {tailored ? "Your Tailored Resume" : "Tailor My Resume"}
            </ButtonLink>
            <ApplyButton
              jobId={job.id}
              title={job.title}
              applyUrl={job.apply_url}
              canMarkApplied={applied != null}
              applied={applied?.appliedAt != null}
              className="shrink-0"
            />
          </>
        }
      />

      {lastSent && <SentNote name={lastSent.name} at={lastSent.created_at} />}
      {applied?.appliedAt && <AppliedNote at={applied.appliedAt} />}

      <Section title="About the Role">
        {/* The card names one place and how many more; here, all of them. */}
        {places.length > 1 && (
          <p className="text-body text-ink-muted mt-3">Open in {places.join(" · ")}.</p>
        )}
        {job.description ? (
          <JobDescription text={job.description} company={job.company} applyUrl={job.apply_url} />
        ) : (
          <p className="text-body text-ink-meta mt-3">
            This posting has no description here. Apply Now opens it on {job.company}&apos;s site.
          </p>
        )}
      </Section>
    </div>
  );
}

/** A fact's words, or nothing where the posting doesn't say (the header
 *  leaves that fact out). */
const text = (value: string | null | typeof NOT_LISTED | undefined) =>
  typeof value === "string" ? value : "";

/** The live role in the shape the shared header reads. What only a fixture
 *  carries (an employer blurb, the mock's sections) is empty. */
function toPosting(job: JobListing): JobPosting {
  const facts = listingFacts(job);
  return {
    id: job.id,
    companyName: job.company,
    title: job.title,
    status: "Open",
    jobType: text(facts.jobType),
    workStyle: text(facts.workStyle),
    level: text(facts.experienceLevel),
    starts: text("startTerm" in facts ? facts.startTerm : facts.minYearsExperience),
    locationCity: text(facts.location),
    salary: text(facts.salary),
    postedAt: job.posted_at ?? "",
    updatedAt: job.posted_at ?? "",
    companyAbout: "",
    about: "",
    responsibilities: [],
    qualifications: [],
  };
}
