import { Ban, CloudOff, Sparkles } from "lucide-react";

import { ExternalLinkIcon } from "@/components/icons";
import { JobPostingCard } from "@/components/job-posting-card";
import { SaveButton } from "@/components/save-button";
import { Skeleton } from "@/components/shadcn/skeleton";
import { Button, ButtonLink, buttonClasses } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { IconButton } from "@/components/ui/icon-button";

import { formatExperienceLevel, formatPosted, formatWorkStyle } from "./format";
import type { JobListing } from "./listings";

/* The live feed's card, and the two states that stand in for a list of them.
 * Shared by /jobs and /search, so a role found by searching is the same card,
 * with the same actions, as the role in the feed: the search screen used to
 * draw its own result card, with a different logo tile, a different Save and
 * no way to apply. */

/**
 * One scraped role in the shared <JobPostingCard> shell, with the seeker-only
 * chrome around it. What a scraped role lacks is null, and the card omits it:
 * no salary or job type (job boards rarely state them), no match rail (nothing
 * scores roles yet), and no title link (there is no expanded view for a role
 * with no description). Apply Now leaves for the employer's own posting.
 */
export function ListingCard({ job }: { job: JobListing }) {
  return (
    <JobPostingCard
      job={{
        company: job.company,
        logoUrl: job.logo_url,
        title: job.title,
        timing: job.posted_at ? formatPosted(job.posted_at) : null,
        location: job.location,
        jobType: null,
        salary: null,
        workStyle: job.work_style ? formatWorkStyle(job.work_style) : null,
        experienceLevel: formatExperienceLevel(job.experience_level),
        minYearsExperience: null,
      }}
      /* One row of actions rather than a "⋯" up top as well: the menu had
         nothing in it, and two places to look for what a card can do is one
         too many. Quick, quiet verdicts on the left, the two steps toward
         applying on the right. */
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

          {/* Secondary, not primary: asking about a job is the step before
              applying to it, and only one control on a card can be the one
              being pointed at. */}
          <Button variant="secondary" size="sm" className="ml-auto">
            <Sparkles className="size-4" />
            Ask WorkIt
          </Button>

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

/**
 * A list's place while the feed loads: four cards in the listing card's own
 * shape (logo, title, company, facts), so the page does not jump when the
 * real ones land. It follows the card's narrow layout too, at the same
 * container widths: under 672px the actions drop to a ruled row of their own,
 * and under 448px the timing takes a line of its own. Without that row every
 * phone card nearly doubled in height as the feed streamed in. Stated once
 * for a screen reader; the shapes themselves are hidden.
 */
export function ListingsSkeleton() {
  return (
    <div role="status" className="mt-4">
      <span className="sr-only">Loading jobs</span>
      <ul aria-hidden="true" className="flex flex-col gap-3">
        {Array.from({ length: 4 }, (_, index) => (
          <li key={index}>
            {/* The padding on an inner box, as on the real card, so the
                container query measures the same width there and here. */}
            <Card padding="none" className="@container">
              <div className="p-4 sm:p-5">
                <div className="flex gap-3 sm:gap-4">
                  <Skeleton className="rounded-control size-11 shrink-0 sm:size-12" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-5 w-2/3" />
                    <Skeleton className="h-4 w-1/3" />
                    <Skeleton className="hidden h-4 w-1/4 @max-md:block" />
                    <Skeleton className="h-4 w-1/2" />
                  </div>
                </div>
                <div className="border-border-subtle mt-4 flex gap-2 border-t pt-3 @2xl:hidden">
                  <Skeleton className="size-8" />
                  <Skeleton className="size-8" />
                  <Skeleton className="ml-auto h-8 w-28" />
                  <Skeleton className="h-8 w-24" />
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
