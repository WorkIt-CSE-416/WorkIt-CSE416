import { CompanyLogo } from "@/components/company-logo";
import { SparkleIcon } from "@/components/icons";
import { JobDetailHeader } from "@/components/job-detail/job-detail-header";
import { AskScoutButton } from "@/components/scout/scout-buttons";
import { ButtonLink } from "@/components/ui/button";
import { Section } from "@/components/ui/section";
import { listBuiltResumes } from "@/lib/built-resume-actions";
import { listSentResumes } from "@/lib/sent-resume-actions";

import { getApplicationStage } from "../../auto-apply/applications";
import { AutoApplyButton } from "../../auto-apply/auto-apply-button";
import { placesOf } from "../format";
import { listingFacts } from "../listing-card";
import { getApplied, getJobListing, type JobListing } from "../listings";
import { SaveJobButton } from "../save-job-button";
import { factText, toPosting } from "../to-posting";
import { ApplyButton } from "./apply-button";
import { JobDescription } from "./description";
import { KeyRequirementsCard } from "./key-requirements";
import { AppliedNote, MoreActions } from "./page-actions";
import { SentNote } from "./sent-note";

/**
 * One live role as its job page draws it: the actions, the header and the
 * body (the sent and applied notes, the Key Requirements card, About the
 * Role). /jobs/[jobId] and the application's own page (/applications/[jobId],
 * its Job Description tab, KAN-256) both draw the role from here, so the two
 * look the same and cannot drift apart. ./page.tsx says what each part does.
 */
export type JobView = Awaited<ReturnType<typeof loadJobView>>;

/** A job's page width, a little wider than the reading pages' `max-w-app`
 *  (KAN-279): at 1024px the header's six facts felt cramped. About the Role
 *  keeps its own 68ch measure, so its lines do not grow with it. The job page
 *  and the application's own page share it, so the two stay identical. */
export const JOB_PAGE_WIDTH = "mx-auto w-full max-w-[70rem] flex-1 py-6";

/** Everything the job page reads, in parallel. `job` is null for one that has
 *  closed (or never existed); `error` when the API can't be read. */
export async function loadJobView(jobId: string) {
  const [{ job, error }, resumes, sent, applied, stage] = await Promise.all([
    getJobListing(jobId),
    listBuiltResumes(),
    listSentResumes(),
    getApplied(jobId),
    getApplicationStage(jobId),
  ]);
  // The sent resumes linked to this posting, newest first, so the first is
  // the last one sent.
  const sentHere = (sent.data ?? []).filter((s) => s.job_posting_id === job?.id);
  return {
    job,
    error,
    stage,
    applied,
    sent: sentHere,
    tailored: resumes.data?.some((r) => r.job_posting_id === job?.id) ?? false,
  };
}

/** The job's actions, for JobActionBar: Save, the "…" menu, Ask Scout, Auto
 *  Apply where it can fill the form, Tailor My Resume and Apply Now. */
export function JobViewActions({ view, job }: { view: JobView; job: JobListing }) {
  const { stage, applied, tailored } = view;
  return (
    <>
      {/* Outlined like the feed card's icon actions. */}
      <SaveJobButton jobId={job.id} title={job.title} stage={stage} />
      <MoreActions title={job.title} />
      <AskScoutButton id={job.id} title={job.title} company={job.company} />
      {/* Only where auto apply can fill the form (Greenhouse for now). */}
      {job.auto_apply && (
        <AutoApplyButton jobId={job.id} title={job.title} company={job.company} stage={stage} />
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
  );
}

/** Who is hiring, the title and the facts. No match rail: see ./page.tsx. */
export function JobViewHeader({ job }: { job: JobListing }) {
  return (
    <JobDetailHeader
      posting={toPosting(job)}
      // The employer's own logo, as on the card, at the header's 40px; its
      // initials when it has none.
      tile={
        <CompanyLogo
          name={job.company}
          src={job.logo_url}
          className="text-label rounded-control size-10"
        />
      }
    />
  );
}

/** Under the header: what was sent and when it was applied to, the
 *  Key Requirements card, and About the Role. `descriptionOnly` keeps About
 *  the Role alone: the application page's Job Description tab (KAN-256),
 *  where the notes and the checklist are the application's business, not
 *  the posting's, and pushed the description down. */
export function JobViewBody({
  view,
  job,
  descriptionOnly = false,
}: {
  view: JobView;
  job: JobListing;
  descriptionOnly?: boolean;
}) {
  const { sent, applied } = view;
  const lastSent = sent[0];
  const places = placesOf(job.location_label ?? job.location);

  return (
    <>
      {!descriptionOnly && (
        <>
          {lastSent && <SentNote name={lastSent.name} at={lastSent.created_at} />}
          {applied?.appliedAt && <AppliedNote at={applied.appliedAt} />}
          <KeyRequirementsCard jobId={job.id} minYearsExperience={job.min_years_experience} />
        </>
      )}

      <Section title="About the Role">
        {/* The card names one place and how many more; here, all of them. */}
        {places.length > 1 && (
          <p className="text-body text-ink mt-3">Open in {places.join(" · ")}.</p>
        )}
        {job.description ? (
          <JobDescription
            text={job.description}
            company={job.company}
            applyUrl={job.apply_url}
            pay={factText(listingFacts(job).salary) || null}
          />
        ) : (
          <p className="text-body text-ink-meta mt-3">
            This posting has no description here. Apply Now opens it on {job.company}&apos;s site.
          </p>
        )}
      </Section>
    </>
  );
}
