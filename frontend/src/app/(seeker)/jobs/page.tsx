import type { Metadata } from "next";

import { BookmarkIcon, EllipsisIcon, FilterIcon } from "@/components/icons";
import { JobPostingCard } from "@/components/job-posting-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FilterChip } from "@/components/ui/filter-chip";
import { IconButton } from "@/components/ui/icon-button";
import { cn } from "@/lib/cn";

import { FILTERS, RECOMMENDATIONS, SORT, type Recommendation } from "./data";
import {
  formatCountry,
  formatExperienceLevel,
  formatJobType,
  formatLocation,
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
        timing: formatTiming(job.uploadedAt, job.closesAt),
        // null only when there is no location information at all — Work
        // Style already says Remote, and printing that again under the pin
        // icon would read as two facts agreeing by coincidence. A posting
        // with a country but no city (a Remote role restricted to, say, the
        // US) still has something real to show, just not a full city.
        location: job.locationCity
          ? formatLocation(job.locationCity, job.locationCountry)
          : job.locationCountry
            ? formatCountry(job.locationCountry)
            : null,
        jobType: formatJobType(job.jobType),
        salary: formatSalary(job),
        workStyle: formatWorkStyle(job.workStyle),
        experienceLevel: formatExperienceLevel(job.experienceLevel),
        minYearsExperience: formatMinYearsExperience(job.minYearsExperience),
      }}
      headerAction={
        <IconButton label={`More options for ${job.title}`}>
          <EllipsisIcon className="size-4" />
        </IconButton>
      }
      actions={
        <>
          <IconButton label={`Not interested in ${job.title}`} variant="outline" className="size-8">
            <CircleSlashIcon className="size-4" />
          </IconButton>

          <IconButton
            label={job.saved ? `Remove ${job.title} from saved` : `Save ${job.title}`}
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
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-heading text-ink">Recommended for You</h1>
          <p className="text-body text-ink-meta mt-1">
            Roles matched to your profile, refreshed every morning.
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-3">
          <Badge variant="tag" pill>
            {RECOMMENDATIONS.length} matches
          </Badge>
          {/* The sort reuses the filter chip: it is the same affordance — a
              label with a menu behind it — and giving it a second shape would
              only claim a difference that is not there. */}
          <span className="text-note text-ink-meta">Sort by</span>
          <FilterChip label={SORT} />
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {FILTERS.map((filter) => (
          <FilterChip key={filter.label} label={filter.label} active={filter.active} />
        ))}

        {/* Deliberately not a chip. The chips each own one facet; this opens
            everything else, and the applications header already spells that
            control this way. */}
        <Button variant="secondary" size="sm">
          <FilterIcon className="size-4" />
          All filters
        </Button>
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
