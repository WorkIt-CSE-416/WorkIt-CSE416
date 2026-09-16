import type { Metadata } from "next";

import { BookmarkIcon, EllipsisIcon } from "@/components/icons";
import { JobPostingCard } from "@/components/job-posting-card";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { cn } from "@/lib/cn";

import { RECOMMENDATIONS, type Recommendation } from "./data";
import { JobFilters } from "./filters";
import {
  formatExperienceLevel,
  formatJobLocation,
  formatJobType,
  formatMinYearsExperience,
  formatSalary,
  formatTiming,
  formatWorkStyle,
} from "./format";
import { CircleSlashIcon, SparkleIcon } from "./icons";
import { MatchRail } from "./match-rail";

export const metadata: Metadata = {
  title: "Jobs",
  description: "Roles matched to your profile.",
};

/* Built without a mockup, from the layout described in ./data. Everything here
 * is inert, as it is on the other two job screens. */

/**
 * One recommendation: the job on the left, WorkIt's match reasoning on the
 * right. A thin wrapper over <JobPostingCard> — the shared shell — adding the
 * seeker-only chrome: a more-options menu, Not Interested / Save / Ask WorkIt /
 * Apply, and the match rail. See job-posting-card.tsx for the shell itself and
 * why those are slots rather than baked in.
 */
function RecommendationCard({ job }: { job: Recommendation }) {
  return (
    <JobPostingCard
      job={{
        // No per-job Icon/tone any more — that was company branding smuggled
        // onto the job. Initials stand in until `companies` has a logo.
        company: job.company,
        companyHref: "/companies",
        title: job.title,
        titleHref: `/jobs/${job.id}`,
        timing: formatTiming(job.uploadedAt, job.closesAt),
        // null only when there is no location information at all — Work
        // Style already says Remote, and printing that again under the pin
        // icon would read as two facts agreeing by coincidence. A posting
        // with a country but no city (a Remote role restricted to, say, the
        // US) still has something real to show, just not a full city.
        location: formatJobLocation(job),
        jobType: formatJobType(job.jobType),
        salary: formatSalary(job),
        workStyle: formatWorkStyle(job.workStyle),
        experienceLevel: formatExperienceLevel(job.experienceLevel),
        minYearsExperience: formatMinYearsExperience(job.minYearsExperience),
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
            label={job.saved ? `Remove ${job.title} from saved` : `Save ${job.title}`}
            tooltip={job.saved ? "Remove from saved" : "Save"}
            variant="outline"
            className={cn("size-8", job.saved && "text-brand")}
          >
            <BookmarkIcon filled={job.saved} className="size-4" />
          </IconButton>

          {/* Secondary, not primary: asking about a job is the step before
              applying to it, and only one control on a card can be the one
              being pointed at. */}
          <Button variant="secondary" size="sm">
            <SparkleIcon className="size-4" />
            Ask WorkIt
          </Button>

          <Button size="sm">Apply Now</Button>
        </>
      }
      rail={<MatchRail score={job.match} highlights={job.highlights} />}
    />
  );
}

export default function JobsPage() {
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

      <ul className="mt-4 flex flex-col gap-3">
        {RECOMMENDATIONS.map((job) => (
          <li key={job.id}>
            <RecommendationCard job={job} />
          </li>
        ))}
      </ul>
    </main>
  );
}
