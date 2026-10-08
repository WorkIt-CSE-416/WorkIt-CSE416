import { Ban, CloudOff } from "lucide-react";

import { ExternalLinkIcon } from "@/components/icons";
import { JobPostingCard, NOT_LISTED } from "@/components/job-posting-card";
import { SaveButton } from "@/components/save-button";
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
  formatPosted,
  formatSalary,
  formatWorkStyle,
} from "./format";
import type { JobListing } from "./listings";
import { MatchRail } from "./match-rail";

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
 * scraper has it and marked NOT_LISTED where it does not, so the card states
 * the schema rather than whatever a board happened to give:
 *
 *   location_city/country  `location`, one string from the board; a remote
 *                          role with none has nothing to list, so it is left
 *                          out (Work Style says Remote), as on a fixture
 *   job_type               "Internship" on every internship, as Jobright
 *                          shows it; otherwise `job_type`, when the posting
 *                          states it
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
 * The match rail is its placeholder (score null): nothing scores a role yet.
 * There is no title link: there is no expanded view for a role with no
 * description. Apply Now leaves for the employer's own posting.
 */
export function ListingCard({ job }: { job: JobListing }) {
  return (
    <JobPostingCard
      job={{
        company: job.company,
        logoUrl: job.logo_url,
        title: job.title,
        timing: job.posted_at ? formatPosted(job.posted_at) : NOT_LISTED,
        location: job.location ?? (job.work_style === "remote" ? null : NOT_LISTED),
        jobType: jobType(job),
        salary: salary(job),
        workStyle: job.work_style ? formatWorkStyle(job.work_style) : NOT_LISTED,
        experienceLevel: formatExperienceLevel(job.experience_level),
        ...yearsOrStart(job),
      }}
      rail={<MatchRail score={null} highlights={[]} />}
      /* One row of actions rather than a "⋯" up top as well: the menu had
         nothing in it, and two places to look for what a card can do is one
         too many. All four sit at the row's right end, as on the mock cards:
         the quick verdicts first, then the two steps toward applying. */
      actions={
        <>
          <IconButton
            label={`Not interested in ${job.title}`}
            tooltip="Not interested"
            variant="outline"
            className="size-8"
          >
            <Ban className="size-4" />
          </IconButton>

          <SaveButton title={job.title} />

          <AskScoutButton id={job.id} title={job.title} company={job.company} />

          {/* Leaves for the employer's own posting, so the glyph says so and
              a screen reader hears it. On a card under 384px (a phone) the
              glyph steps out: its 22px pushed Apply Now onto a line of its
              own, and the spoken hint still stands. */}
          <ButtonLink href={job.apply_url} target="_blank" rel="noopener noreferrer" size="sm">
            Apply Now
            <ExternalLinkIcon className="size-3.5 @max-sm:hidden" />
            <span className="sr-only"> (opens in a new tab)</span>
          </ButtonLink>
        </>
      }
    />
  );
}

function jobType(job: JobListing) {
  // Jobright's rule: an internship's job type is "Internship", whatever hours
  // it states. "Full-Time" beside "Internship" read as a contradiction.
  if (job.experience_level === "internship") return "Internship";
  return job.job_type ? formatJobType(job.job_type) : NOT_LISTED;
}

/** An internship shows when it starts; any other role its minimum years. */
function yearsOrStart(job: JobListing) {
  if (job.experience_level === "internship") {
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
                    <Skeleton className="size-8" />
                    <Skeleton className="size-8" />
                    <Skeleton className="h-8 w-28" />
                    <Skeleton className="h-8 w-24" />
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
      Icon={CloudOff}
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
