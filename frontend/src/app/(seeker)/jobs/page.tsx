import type { Metadata } from "next";
import Link from "next/link";

import {
  AwardIcon,
  BookmarkIcon,
  BriefcaseIcon,
  CalendarIcon,
  CoinIcon,
  EllipsisIcon,
  MonitorIcon,
  PinIcon,
} from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { CompanyTile } from "@/components/ui/company-tile";
import { Fact } from "@/components/ui/fact";
import { IconButton } from "@/components/ui/icon-button";
import { cn } from "@/lib/cn";

import { RECOMMENDATIONS, type Recommendation } from "./data";
import { JobFilters } from "./filters";
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
        {/* Grid, not flex: the tile opts into `self-stretch` to grow past its
            own 64px default and match whatever height the flags/title/company
            stack beside it actually needs — a fixed box otherwise falls short
            of that stack's bottom edge, since the stack's height depends on
            content (title wrapping, how many flags there are) a fixed box
            can't anticipate. `aspect-square` is what keeps the grown box a
            square rather than a stretched rectangle, and needs grid's row/
            column sizing to resolve correctly — the same aspect-ratio-from-
            stretched-cross-size case is a known gap in flexbox specifically. */}
        <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-3">
          <CompanyTile
            Icon={job.Icon}
            size="lg"
            tone={job.tone}
            className="aspect-square h-full w-auto self-stretch"
          />

          <div className="min-w-0">
            <ul className="flex flex-wrap items-center gap-1.5">
              {job.flags.map((flag) => (
                <li key={flag.label} className="flex">
                  <Badge variant="tag" tone={flag.fresh ? "positive" : "neutral"}>
                    {flag.label}
                  </Badge>
                </li>
              ))}
            </ul>

            {/* Ink, not brand, and turning brand only on hover/focus — same
                call RowLink makes for the company table's title cell: a list
                where every card's title is the same blue has no contrast left
                to draw attention with. */}
            <h3 className="text-title mt-1.5">
              <Link
                href={`/jobs/${job.id}`}
                className="text-ink hover:text-brand focus-visible:ring-brand-ring rounded-xs focus-visible:ring-2 focus-visible:outline-none"
              >
                {job.title}
              </Link>
            </h3>

            {/* Ink, not brand, same call as the title above — a card where
                the company name is the one blue thing sitting under a black
                title reads as a mistake, not an affordance. The employer is
                still told apart from the sector by weight and the slash. */}
            <p className="text-note mt-0.5">
              <Link
                href="/companies"
                className="text-ink hover:text-brand focus-visible:ring-brand-ring rounded-xs font-semibold focus-visible:ring-2 focus-visible:outline-none"
              >
                {job.company}
              </Link>
              <span className="text-ink-faint"> / {job.industries.join(" · ")}</span>
            </p>
          </div>

          <IconButton label={`More options for ${job.title}`} tooltip="More options">
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
