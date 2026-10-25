import { CloudSlashIcon, ProhibitIcon } from "@phosphor-icons/react/ssr";

import { SparkleIcon } from "@/components/icons";
import { JobPostingCard, NOT_LISTED } from "@/components/job-posting-card";
import { AskScoutButton } from "@/components/scout/scout-buttons";
import { Skeleton } from "@/components/shadcn/skeleton";
import { ButtonLink, buttonClasses } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { IconButton } from "@/components/ui/icon-button";

import {
  formatExperienceLevel,
  formatJobType,
  formatMinYears,
  formatPlaces,
  formatPosted,
  formatSalary,
  formatWorkStyle,
} from "./format";
import type { ApplicationStage } from "../auto-apply/actions";
import { AutoApplyButton } from "../auto-apply/auto-apply-button";
import { ApplyButton } from "./apply-button";
import type { JobListing } from "./listings";
import { MatchRail } from "./match-rail";
import { SaveJobButton } from "./save-job-button";

/* The live feed's card, and the two states that stand in for a list of them.
 * Shared by /jobs and /search, so a role found by searching is the same card,
 * with the same actions, as the role in the feed: the search screen used to
 * draw its own result card, with a different logo tile, a different Save and
 * no way to apply. */

/**
 * One scraped role in the shared <JobPostingCard> shell, with the seeker-only
 * chrome around it, in the full shape the card had when it showed fixture
 * postings: six facts and the match rail.
 *
 * EVERY FACT IS A `job_postings` COLUMN, filled from the scraped row where the
 * scraper has it and marked NOT_LISTED where it does not, which the card
 * draws as an empty slot in that fact's fixed place (see JobPostingCard), so
 * every card has the schema's shape rather than whatever a board gave:
 *
 *   location_city/country  `location`, one string from the board; a remote
 *                          role with none has nothing to list, so it is left
 *                          out (Work Style says Remote), as on a fixture
 *   job_type               "Internship" for every internship, whatever its
 *                          hours (as Jobright shows it: one kind of
 *                          internship, not a full-time and a part-time one).
 *                          Otherwise `job_type`, when the posting states it,
 *                          or the scraper's Full-Time for a silent new-grad
 *                          role: how the job is set up (Full-Time,
 *                          Part-Time, Contract)
 *   salary_*               `salary_*`, when the posting states pay
 *   work_style             `work_style`, when the board states it
 *   experience_level       `experience_level`, always: the scraper keeps
 *                          internship and new-grad roles only
 *   min_years_experience   `min_years_experience`, when the posting asks
 *                          for some; an internship shows `start_term` as
 *                          its own fact instead, since nobody asks an
 *                          intern for years
 *   uploaded_at            `posted_at`, when the board dated it
 *
 * The match rail shows the role's score and highlights in the Best
 * Match order, which scores against the seeker's resume, and its placeholder
 * (score null) everywhere else.
 * The card opens the role's own page, /jobs/[jobId] (KAN-73), which shows
 * its description; Apply Now opens the page's own Apply dialog (./apply-button,
 * KAN-290). Tailor
 * My Resume is the page's own button (KAN-241): it opens Tailor for this
 * role, and reads "Your Tailored Resume" once the seeker has one for it.
 */
export function ListingCard({
  job,
  stage,
  tailored,
  canMarkApplied,
  onApplied,
}: {
  job: JobListing;
  /** The seeker's application for it, for its Save and Auto Apply buttons;
   *  null: none. */
  stage: ApplicationStage | null;
  /** Whether the seeker has a resume tailored to it, for its Tailor button. */
  tailored: boolean;
  /** An applicant account, which Apply Now's dialog may ask "Did You
   *  Apply?". A company account can open /jobs too, and is never asked. */
  canMarkApplied: boolean;
  /** Takes the card off its list once the job is marked applied. */
  onApplied?: () => void;
}) {
  return (
    <JobPostingCard
      job={{
        company: job.company,
        logoUrl: job.logo_url,
        title: job.title,
        titleHref: `/jobs/${job.id}`,
        timing: job.posted_at ? formatPosted(job.posted_at) : NOT_LISTED,
        ...listingFacts(job),
      }}
      rail={<MatchRail score={job.match ?? null} highlights={job.highlights ?? []} />}
      /* One row of actions rather than a "⋯" up top as well: the menu had
         nothing in it, and two places to look for what a card can do is one
         too many. All sit at the row's right end, as on the mock cards: the
         quick verdicts first, then the steps toward applying, in the job
         page's order. */
      actions={
        <>
          <IconButton
            label={`Not interested in ${job.title}`}
            tooltip="Not interested"
            variant="outline"
            className="size-9"
          >
            <ProhibitIcon aria-hidden className="size-4" />
          </IconButton>

          <SaveJobButton jobId={job.id} title={job.title} stage={stage} />

          <AskScoutButton id={job.id} title={job.title} company={job.company} />

          {/* Only where auto apply can fill the form (Greenhouse for now). */}
          {job.auto_apply && (
            <AutoApplyButton jobId={job.id} title={job.title} company={job.company} stage={stage} />
          )}

          <ButtonLink
            href={`/jobs/${encodeURIComponent(job.id)}/tailor`}
            variant="secondary"
            size="sm"
          >
            <SparkleIcon className="size-4" />
            {tailored ? "Your Tailored Resume" : "Tailor My Resume"}
          </ButtonLink>

          {/* The job posting page's own dialog (KAN-290): which resume to
              send, then "Did You Apply?". No new-tab glyph: the button opens
              the dialog, and the dialog's links to the employer carry it.
              An applied job is already gone from the seeker's feed. */}
          <ApplyButton
            jobId={job.id}
            title={job.title}
            applyUrl={job.apply_url}
            canMarkApplied={canMarkApplied}
            applied={stage === "applied"}
            onApplied={onApplied}
          />
        </>
      }
    />
  );
}

/** A scraped role's six facts as the card prints them, NOT_LISTED where the
 *  posting doesn't say. Shared with the role's own page (/jobs/[jobId]), so
 *  the page and its card never describe one job two ways. */
export function listingFacts(job: JobListing) {
  return {
    // The import's label where it placed a US city ("San Francisco, CA" for
    // "SF"), else the board's text tidied ("Philadelphia, PA"); several read
    // "Bellevue, WA +2 more", and the job posting's page lists every place.
    location:
      formatPlaces(job.location_label ?? job.location) ??
      (job.work_style === "remote" ? null : NOT_LISTED),
    jobType: job.job_type ? formatJobType(job.job_type) : NOT_LISTED,
    salary: salary(job),
    workStyle: job.work_style ? formatWorkStyle(job.work_style) : NOT_LISTED,
    experienceLevel: formatExperienceLevel(job.experience_level),
    ...yearsOrStart(job),
  };
}

/** An internship shows when it starts; any other role its minimum years. */
function yearsOrStart(job: JobListing) {
  if (job.job_type === "internship") {
    return {
      minYearsExperience: null,
      startTerm: job.start_term ? `Start in ${job.start_term}` : NOT_LISTED,
    };
  }
  return {
    minYearsExperience:
      job.min_years_experience != null ? formatMinYears(job.min_years_experience) : NOT_LISTED,
  };
}

function salary(job: JobListing) {
  if (!job.salary_currency || !job.salary_period) return NOT_LISTED;
  return formatSalary({
    salary: job.salary ?? undefined,
    salaryMin: job.salary_min ?? undefined,
    salaryMax: job.salary_max ?? undefined,
    salaryCurrency: job.salary_currency,
    salaryPeriod: job.salary_period,
  });
}

/**
 * A list's place while the feed loads: four cards in the listing card's own
 * shape (the tall logo tile; badge, title and company; the ruled fact grid;
 * the ruled action row; and the match rail), so the page does not jump when
 * the real ones land. It is nested as the card is (a card container, a row
 * that puts the rail beside the body from 576px of card, and a body
 * container), so the tile, the grid and the rail break at the same widths.
 * Stated once for a screen reader; the shapes themselves are hidden.
 */
export function ListingsSkeleton() {
  return (
    <div role="status" className="mt-4">
      <span className="sr-only">Loading jobs</span>
      <ul aria-hidden="true" className="flex flex-col gap-3">
        {Array.from({ length: 4 }, (_, index) => (
          <li key={index}>
            <Card padding="none" className="@container overflow-hidden">
              <div className="flex flex-col @xl:flex-row">
                <div className="@container min-w-0 flex-1 p-4">
                  <div className="flex items-start gap-3">
                    <Skeleton className="rounded-card w-14 shrink-0 self-stretch @md:w-20" />
                    <div className="flex-1 space-y-2">
                      <Skeleton className="h-6 w-32 rounded-full" />
                      <Skeleton className="h-6 w-2/3" />
                      <Skeleton className="h-4 w-1/3" />
                    </div>
                  </div>
                  <div className="border-border-subtle mt-3 grid grid-cols-2 gap-x-4 gap-y-2.5 border-t pt-3 @md:grid-cols-3">
                    {Array.from({ length: 6 }, (_, fact) => (
                      <Skeleton key={fact} className="h-3.5 w-4/5" />
                    ))}
                  </div>
                  <div className="border-border-subtle mt-3 flex justify-end gap-2 border-t pt-3">
                    <Skeleton className="size-9" />
                    <Skeleton className="size-9" />
                    <Skeleton className="h-9 w-28" />
                    <Skeleton className="h-9 w-28" />
                    <Skeleton className="h-9 w-36" />
                    <Skeleton className="h-9 w-24" />
                  </div>
                </div>
                {/* The match rail's box: the ring, the tier line, three rows. */}
                <div className="bg-well border-border-subtle flex shrink-0 flex-col items-center gap-2 border-t p-4 @xl:w-52 @xl:border-t-0 @xl:border-l">
                  <Skeleton className="size-16 rounded-full" />
                  <Skeleton className="h-3 w-24" />
                  <div className="border-border-subtle mt-1 flex w-full flex-col gap-1.5 border-t pt-3">
                    <Skeleton className="h-2 w-full" />
                    <Skeleton className="h-2 w-4/5" />
                    <Skeleton className="h-2 w-11/12" />
                  </div>
                </div>
              </div>
            </Card>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * What a list shows when the feed did not load. `retryHref` is the page's own
 * URL, query and all, so Try Again reloads the screen the seeker was on.
 */
export function ListingsError({ error, retryHref }: { error: string; retryHref: string }) {
  return (
    <EmptyState
      Icon={CloudSlashIcon}
      title="Jobs Aren't Loading Right Now"
      className="mt-4"
      /* A plain link, not <Link>: a full reload is what re-runs the fetch. */
      action={
        <a href={retryHref} className={buttonClasses({ variant: "secondary", size: "sm" })}>
          Try Again
        </a>
      }
      /* The API's own message is for whoever runs this locally ("No scraped
         jobs yet. Run `python3 -m workit_scraper`"), not for a seeker, who
         can't act on it. */
      detail={process.env.NODE_ENV === "development" ? error : undefined}
    >
      We couldn&apos;t reach the job feed. Try again in a few minutes.
    </EmptyState>
  );
}
