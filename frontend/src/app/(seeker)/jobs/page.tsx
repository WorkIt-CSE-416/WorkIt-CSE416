import type { Metadata } from "next";

import { BookmarkIcon, BriefcaseIcon, SearchIcon } from "@/components/icons";
import { JobPostingCard } from "@/components/job-posting-card";
import { Button, ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { IconButton } from "@/components/ui/icon-button";
import { cn } from "@/lib/cn";

import { JobFilters } from "./filters";
import { formatExperienceLevel, formatPosted, formatWorkStyle } from "./format";
import { CircleSlashIcon, SparkleIcon } from "./icons";
import { getJobListings, type JobListing } from "./listings";
import { SEEKER_GUTTER } from "../gutter";

export const metadata: Metadata = {
  title: "Jobs",
  description: "Roles matched to your profile.",
};

/* Built without a mockup, from the layout described in ./data. The feed is
 * live (./listings); Save, Not Interested and Ask WorkIt are still inert. */

/**
 * One scraped role in the shared <JobPostingCard> shell, with the seeker-only
 * chrome around it. What a scraped role lacks is null, and the card omits it:
 * no salary or job type (job boards rarely state them), no match rail (nothing
 * scores roles yet), and no title link (there is no expanded view for a role
 * with no description). Apply Now leaves for the employer's own posting.
 */
function ListingCard({ job }: { job: JobListing }) {
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
            <CircleSlashIcon className="size-4" />
          </IconButton>

          <IconButton
            label={`Save ${job.title}`}
            tooltip="Save"
            variant="outline"
            className="size-8"
          >
            <BookmarkIcon className="size-4" />
          </IconButton>

          {/* Secondary, not primary: asking about a job is the step before
              applying to it, and only one control on a card can be the one
              being pointed at. */}
          <Button variant="secondary" size="sm" className="ml-auto">
            <SparkleIcon className="size-4" />
            Ask WorkIt
          </Button>

          <ButtonLink href={job.apply_url} target="_blank" rel="noopener noreferrer" size="sm">
            Apply Now
          </ButtonLink>
        </>
      }
    />
  );
}

export default async function JobsPage() {
  const { jobs, error } = await getJobListings();

  return (
    <div className={cn("max-w-app mx-auto w-full flex-1 py-6", SEEKER_GUTTER)}>
      <div>
        <h1 className="text-heading text-ink">Recommended for You</h1>
        <p className="text-body text-ink-meta mt-1">
          Roles matched to your profile, refreshed every morning.
        </p>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <JobFilters />
      </div>

      {error != null ? (
        <EmptyState
          Icon={SearchIcon}
          title="Jobs aren't loading right now"
          className="mt-4"
          /* The API's own message is for whoever runs this locally ("No
             scraped jobs yet. Run `python3 -m workit_scraper`"), not for a
             seeker, who can't act on it. */
          detail={process.env.NODE_ENV === "development" ? error : undefined}
        >
          We couldn&apos;t reach the job feed. Refresh the page, or check back in a few minutes.
        </EmptyState>
      ) : jobs.length === 0 ? (
        <EmptyState Icon={BriefcaseIcon} title="No roles yet" className="mt-4">
          New internship and new-grad roles land here as companies post them. Check back tomorrow
          morning.
        </EmptyState>
      ) : (
        <ul className="mt-4 flex flex-col gap-3">
          {jobs.map((job) => (
            <li key={job.id}>
              <ListingCard job={job} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
