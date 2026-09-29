import type { Metadata } from "next";

import { BookmarkIcon, EllipsisIcon } from "@/components/icons";
import { JobPostingCard } from "@/components/job-posting-card";
import { Button, ButtonLink } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";

import { JobFilters } from "./filters";
import { formatExperienceLevel, formatPosted, formatWorkStyle } from "./format";
import { CircleSlashIcon, SparkleIcon } from "./icons";
import { getJobListings, type JobListing } from "./listings";

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
        // Initials stand in until `companies` has a logo.
        company: job.company,
        title: job.title,
        timing: job.posted_at ? formatPosted(job.posted_at) : null,
        location: job.location,
        jobType: null,
        salary: null,
        workStyle: job.work_style ? formatWorkStyle(job.work_style) : null,
        experienceLevel: formatExperienceLevel(job.experience_level),
        minYearsExperience: null,
      }}
      headerAction={
        <IconButton label={`More options for ${job.title}`} tooltip="More options">
          <EllipsisIcon className="size-4" />
        </IconButton>
      }
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
          <Button variant="secondary" size="sm">
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
    <main className="max-w-app mx-auto w-full flex-1 px-12 py-4.5">
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
        <p role="alert" className="text-body text-ink-meta mt-4">
          Couldn&apos;t load jobs. {error}
        </p>
      ) : (
        <ul className="mt-4 flex flex-col gap-3">
          {jobs.map((job) => (
            <li key={job.id}>
              <ListingCard job={job} />
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
