import type { ReactNode } from "react";

import { CompanyLogo } from "@/components/company-logo";
import { TailorIcon } from "@/components/icons";
import { JOB_CARD_IN_PANEL, JobDetailHeader } from "@/components/job-detail/job-detail-header";
import { AskScoutButton } from "@/components/scout/scout-buttons";
import { Skeleton } from "@/components/shadcn/skeleton";
import { ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Section } from "@/components/ui/section";
import { listBuiltResumes } from "@/lib/built-resume-actions";
import { cn } from "@/lib/cn";
import { listSentResumes } from "@/lib/sent-resume-actions";

import type { ApplicationStage } from "../../auto-apply/actions";
import { getApplicationStage } from "../../auto-apply/applications";
import { AutoApplyButton } from "../../auto-apply/auto-apply-button";
import { placesOf } from "../format";
import { listingFacts } from "../listing-card";
import { getApplied, getJobListing, type JobListing } from "../listings";
import { NotInterestedButton } from "../not-interested-button";
import { SaveJobButton } from "../save-job-button";
import { factText, toPosting } from "../to-posting";
import { ApplyButton } from "../apply-button";
import { JobDescription } from "./description";
import { getCompany, type JobCompany } from "./company-tab";
import { getRequirements, KeyRequirementsCard, type Requirement } from "./key-requirements";
import { AppliedNote } from "./page-actions";
import { SentNote } from "./sent-note";
import { jobLogo } from "@/lib/job-logo";

/**
 * One live role as its job page draws it: the actions, the header and the
 * body (the sent and applied notes, the Key Requirements card, About the
 * Role). /jobs/[jobId] and the application's own page (/applications/[jobId],
 * its Job Description tab, KAN-256) both draw the role from here, so the two
 * look the same and cannot drift apart. ./page.tsx says what each part does.
 */
export type JobView = Awaited<ReturnType<typeof loadJobView>>;

/** A job's page width: every seeker page's `max-w-dashboard` (2026-10-27;
 *  it was 70rem, after 1024px left the header's six facts cramped, KAN-279).
 *  About the Role keeps its own 46ch measure, so its lines do not grow with
 *  it. The job page and the application's own page share it, so the two
 *  stay identical. */
export const JOB_PAGE_WIDTH =
  "max-w-dashboard mx-auto w-full flex-1 py-6 in-data-split:@4xl/main:px-4!";

/** What the application page already knows about its job from the
 *  tracker's row: its stage and when it was applied. Null when the row is
 *  missing (the page is then not found). */
export type KnownApplication = { stage: ApplicationStage | null; appliedAt: string | null } | null;

/** No requirements to read: About the Role alone draws no card. */
const NO_REQUIREMENTS: Promise<Requirement[]> = Promise.resolve([]);

/** No Company tab: the application's page draws none. */
const NO_COMPANY: Promise<JobCompany | null> = Promise.resolve(null);

/**
 * Everything the job page reads, in parallel. `job` is null for one that has
 * closed (or never existed); `error` when the API can't be read.
 *
 * EVERY READ STARTS HERE, AT ONCE, the Key Requirements card's included
 * (getRequirements, which never rejects). A read a component makes for
 * itself begins only once the page has rendered it, after all of these.
 *
 * The application's own page (/applications/[jobId]) passes two options.
 * `descriptionOnly`: it draws About the Role alone, so the requirements are
 * not read. `application`: its tracker row, read beside this one, already
 * says the stage and when it was applied, so those two reads are skipped
 * and the row's answers taken instead. It is a promise, not the row, so the
 * tracker read and these run together rather than one after the other.
 */
export async function loadJobView(
  jobId: string,
  {
    descriptionOnly = false,
    application,
  }: { descriptionOnly?: boolean; application?: Promise<KnownApplication> } = {},
) {
  const [{ job, error }, resumes, sent, applied, stage, requirements, company] = await Promise.all([
    getJobListing(jobId),
    listBuiltResumes(),
    listSentResumes(),
    application
      ? application.then((known) => known && { appliedAt: known.appliedAt })
      : getApplied(jobId),
    application ? application.then((known) => known?.stage ?? null) : getApplicationStage(jobId),
    descriptionOnly ? NO_REQUIREMENTS : getRequirements(jobId),
    descriptionOnly ? NO_COMPANY : getCompany(jobId),
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
    requirements,
    company,
  };
}

/** The job's actions, for JobActionBar: Auto Apply where it
 *  can fill the form, Tailor My Resume and Apply Now. What only keeps or sets
 *  the job aside sits on its card (JobCardActions), after Simplify, so the bar
 *  holds one row beside the tabs.
 *
 *  BELOW md APPLY NOW COMES FIRST, ACROSS THE PAGE (KAN-569), with Auto Apply
 *  and Tailor filling the row under it (each on its own row where the two do
 *  not fit): wrapped in this order, the bar took three rows and the one
 *  primary action was the last thing found.
 *  `data-phone-first` tells the bar to give the actions a row of their own. */
export function JobViewActions({ view, job }: { view: JobView; job: JobListing }) {
  const { stage, applied, tailored } = view;
  return (
    <>
      <div
        data-phone-first
        className="contents max-md:flex max-md:basis-full max-md:flex-wrap max-md:gap-2 max-md:*:grow"
      >
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
          <TailorIcon className="size-4" />
          {tailored ? "Tailored Resume" : "Tailor My Resume"}
        </ButtonLink>
      </div>
      <ApplyButton
        jobId={job.id}
        title={job.title}
        applyUrl={job.apply_url}
        canMarkApplied={applied != null}
        applied={applied?.appliedAt != null}
        showsSent
        className="shrink-0 max-md:order-first max-md:basis-full"
      />
    </>
  );
}

/** The job card's bare glyphs, at its top right, in the compact card's order:
 *  Ask Scout, then Not Interested on the job's own page (inert, as on the compact
 *  card) and Save. gap-4 clears each glyph's tap area. */
export function JobCardActions({
  view,
  job,
  notInterested = false,
}: {
  view: JobView;
  job: JobListing;
  notInterested?: boolean;
}) {
  return (
    <div className="flex items-center gap-4">
      <AskScoutButton id={job.id} title={job.title} company={job.company} quiet />
      {notInterested && <NotInterestedButton title={job.title} quiet />}
      <SaveJobButton jobId={job.id} title={job.title} stage={view.stage} quiet />
    </div>
  );
}

/** Who is hiring, the title and the facts. No match rail: see ./page.tsx.
 *  `titleAs` is h2 beside the list on /jobs, where the bar's "Jobs" is the h1. */
export function JobViewHeader({
  job,
  actions,
  titleAs,
}: {
  job: JobListing;
  actions?: ReactNode;
  titleAs?: "h1" | "h2";
}) {
  return (
    <JobDetailHeader
      posting={toPosting(job)}
      titleAs={titleAs}
      // The employer's own logo, as on the card, at the header's 40px; its
      // initials when it has none.
      tile={
        <CompanyLogo
          name={job.company}
          src={jobLogo(job)}
          className="text-label rounded-control size-10"
        />
      }
      actions={actions}
    />
  );
}

/** JobViewHeader's card while the posting loads (./loading.tsx, and the
 *  application's page's): the company line, the title and the facts under
 *  their rule, as JobDetailHeader draws them, each a bar of its line's
 *  height, so the card is its own size and the page under it holds still. */
export function JobViewHeaderSkeleton() {
  return (
    <Card
      as="header"
      padding="lg"
      elevated={false}
      aria-hidden="true"
      className={cn("@container flex flex-col gap-4", JOB_CARD_IN_PANEL)}
    >
      <div>
        <div className="flex items-center gap-3">
          <Skeleton className="rounded-control size-10 shrink-0" />
          <Skeleton className="h-4 w-48" />
        </div>
        {/* The title's 32px lines: two below 448px of card, where nearly
            every title wraps, one above. */}
        <div className="mt-2 flex h-8 items-center">
          <Skeleton className="h-7 w-3/4" />
        </div>
        <div className="flex h-8 items-center @md:hidden">
          <Skeleton className="h-7 w-1/2" />
        </div>
      </div>
      <div className="border-border-subtle grid grid-cols-2 gap-x-4 gap-y-2 border-t pt-4 @md:grid-cols-3">
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="h-4 w-4/5" />
        ))}
      </div>
    </Card>
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
  const { sent, applied, requirements } = view;
  const lastSent = sent[0];
  const places = placesOf(job.location_label ?? job.location);

  return (
    <>
      {!descriptionOnly && (
        <>
          {lastSent && <SentNote name={lastSent.name} at={lastSent.created_at} />}
          {applied?.appliedAt && <AppliedNote at={applied.appliedAt} />}
          <KeyRequirementsCard
            requirements={requirements}
            minYearsExperience={job.min_years_experience}
          />
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
