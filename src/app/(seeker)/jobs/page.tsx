import type { Metadata } from "next";

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
import { CompanyTile } from "@/components/ui/company-tile";
import { Fact } from "@/components/ui/fact";
import { FilterChip } from "@/components/ui/filter-chip";
import { IconButton } from "@/components/ui/icon-button";
import { TextLink } from "@/components/ui/text-link";
import { cn } from "@/lib/cn";

import { FILTERS, RECOMMENDATIONS, SORT, type Recommendation } from "./data";
import { CircleSlashIcon, SparkleIcon } from "./icons";
import { MatchRail } from "./match-rail";

export const metadata: Metadata = {
  title: "Jobs",
  description: "Roles matched to your profile.",
};

/* Built without a mockup, from the layout described in ./data. Everything here
 * is inert, as it is on the other two job screens. */

/**
 * One recommendation: the job on the left, the reasoning on the right.
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
          <CompanyTile Icon={job.Icon} size="lg" tone={job.tone} />

          <div className="min-w-0 flex-1">
            <ul className="flex flex-wrap items-center gap-1.5">
              {job.flags.map((flag) => (
                <li key={flag.label} className="flex">
                  <Badge variant="tag" tone={flag.fresh ? "positive" : "neutral"}>
                    {flag.label}
                  </Badge>
                </li>
              ))}
            </ul>

            <h3 className="text-title text-ink mt-1.5">{job.title}</h3>

            {/* The employer is a link and the sector is not, so the two are
                told apart by weight and ink as well as by the slash. */}
            <p className="text-note mt-0.5">
              <TextLink href="/companies" className="font-semibold">
                {job.company}
              </TextLink>
              <span className="text-ink-faint"> / {job.industries.join(" · ")}</span>
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
          <Fact Icon={PinIcon}>{job.location}</Fact>
          <Fact Icon={BriefcaseIcon}>{job.jobType}</Fact>
          <Fact Icon={CoinIcon}>{job.salary}</Fact>
          <Fact Icon={MonitorIcon}>{job.workplace}</Fact>
          <Fact Icon={AwardIcon}>{job.level}</Fact>
          <Fact Icon={CalendarIcon}>{job.starts}</Fact>
        </div>

        <div className="border-border-subtle mt-3 flex flex-wrap items-center justify-between gap-3 border-t pt-3">
          <p className="text-meta text-ink-faint">{job.applicants}</p>

          <div className="flex items-center gap-2">
            <IconButton
              label={`Not interested in ${job.title}`}
              variant="outline"
              className="size-8"
            >
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

            <Button variant="primary" size="sm">
              Apply Now
            </Button>
          </div>
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
