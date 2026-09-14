import type { Metadata } from "next";

import { Avatar } from "@/components/avatar";
import {
  AwardIcon,
  BookmarkIcon,
  BriefcaseIcon,
  CalendarIcon,
  CoinIcon,
  EllipsisIcon,
  FilterIcon,
  MonitorIcon,
  PinIcon,
} from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Fact } from "@/components/ui/fact";
import { FilterChip } from "@/components/ui/filter-chip";
import { IconButton } from "@/components/ui/icon-button";
import { TextLink } from "@/components/ui/text-link";
import { cn } from "@/lib/cn";

import { FILTERS, RECOMMENDATIONS, SORT, type Recommendation } from "./data";
import {
  formatExperience,
  formatJobType,
  formatLocation,
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
 * right.
 *
 * The card pads its two halves rather than itself, which is why it takes
 * `padding="none"`: the rail carries its own fill and has to reach the card's
 * edges for that fill to read as a panel rather than as a floating box.
 * `overflow-hidden` is what clips it back to the card's corner radius.
 *
 * Below `md` the rail drops under the job instead of beside it. A 208px column
 * beside a 300px one is not a row any more, and the score is the last thing
 * that should be squeezed.
 */
function RecommendationCard({ job }: { job: Recommendation }) {
  return (
    <Card as="article" padding="none" className="flex flex-col overflow-hidden md:flex-row">
      <div className="min-w-0 flex-1 p-4">
        <div className="flex items-start gap-3">
          {/* No per-job Icon/tone any more — that was company branding
              smuggled onto the job. Initials stand in until `companies` has a
              logo. */}
          <Avatar name={job.company} className="text-title size-12" />

          <div className="min-w-0 flex-1">
            <ul className="flex flex-wrap items-center gap-1.5">
              {job.roles.map((role) => (
                <li key={role} className="flex">
                  <Badge variant="tag" tone="neutral">
                    {role}
                  </Badge>
                </li>
              ))}
            </ul>

            <h3 className="text-title text-ink mt-1.5">{job.title}</h3>

            <p className="text-note mt-0.5">
              <TextLink href="/companies" className="font-semibold">
                {job.company}
              </TextLink>
            </p>
          </div>

          <IconButton label={`More options for ${job.title}`}>
            <EllipsisIcon className="size-4" />
          </IconButton>
        </div>

        {/* Six facts on a grid rather than a wrapping row: fixed columns keep
            the salary under the salary of the card above it, which is what
            makes a stack of these scannable. */}
        <div className="border-border-subtle mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 border-t pt-3 sm:grid-cols-3">
          <Fact Icon={PinIcon}>{formatLocation(job.locationCity, job.locationCountry)}</Fact>
          <Fact Icon={BriefcaseIcon}>{formatJobType(job.jobType)}</Fact>
          <Fact Icon={CoinIcon}>{formatSalary(job)}</Fact>
          <Fact Icon={MonitorIcon}>{formatWorkStyle(job.workStyle)}</Fact>
          <Fact Icon={AwardIcon}>
            {formatExperience(job.experienceLevel, job.minYearsExperience)}
          </Fact>
          <Fact Icon={CalendarIcon}>{formatTiming(job.uploadedAt, job.closesAt)}</Fact>
        </div>

        <div className="border-border-subtle mt-3 flex flex-wrap items-center justify-end gap-2 border-t pt-3">
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
        </div>
      </div>

      <MatchRail score={job.match} highlights={job.highlights} />
    </Card>
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
