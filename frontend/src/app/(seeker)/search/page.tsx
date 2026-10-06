import type { Metadata } from "next";

import { BookmarkIcon, CoinIcon, FilterIcon, PinIcon } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { CompanyTile } from "@/components/ui/company-tile";
import { Fact } from "@/components/ui/fact";
import { FilterChip } from "@/components/ui/filter-chip";
import { IconButton } from "@/components/ui/icon-button";
import { Points, Section } from "@/components/ui/section";
import { SectionHeading } from "@/components/ui/section-heading";
import { TextLink } from "@/components/ui/text-link";
import { cn } from "@/lib/cn";

import { SEEKER_GUTTER } from "../gutter";
import { DETAIL, FILTERS, JOBS, type Job } from "./data";
import { BoltIcon, ExternalLinkIcon } from "./icons";

export const metadata: Metadata = {
  title: "Search Jobs",
  description: "Find your next role.",
};

/* KAN-43 renders the search mockup only, against the fixtures in ./data —
 * nothing here reads or writes yet, so the filters, the bookmarks and Apply Now
 * are inert on purpose. The query field itself lives in the top bar, see the
 * note in ../layout.tsx about why. */

function ResultCard({ job }: { job: Job }) {
  const { Icon } = job;

  return (
    <Card
      as="article"
      padding="sm"
      selected={job.selected}
      aria-current={job.selected ? "true" : undefined}
    >
      <div className="flex items-start gap-3">
        <CompanyTile Icon={Icon} size="md" tone={job.tone} />

        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-1.5">
            <h3 className="text-subtitle text-ink min-w-0 flex-1">{job.title}</h3>
            {job.isNew && <Badge tone="positive">New</Badge>}
            <IconButton
              label={job.saved ? `Remove ${job.title} from saved` : `Save ${job.title}`}
              tooltip={job.saved ? "Remove from saved" : "Save"}
              className={cn(job.saved ? "text-brand" : "text-border-strong hover:text-ink-meta")}
            >
              <BookmarkIcon filled={job.saved} className="size-3.5" />
            </IconButton>
          </div>
          <p className="text-note text-ink-meta mt-0.5">{job.company}</p>
        </div>
      </div>

      <div className="mt-2.5 flex flex-wrap items-center gap-x-3.5 gap-y-1">
        <Fact Icon={PinIcon}>{job.location}</Fact>
        <Fact Icon={CoinIcon}>{job.salary}</Fact>
      </div>

      <div className="mt-2.5 flex items-center justify-between gap-3">
        <p className="text-meta text-ink-faint">{job.posted}</p>
        <p className="text-meta text-brand flex items-center gap-0.5 font-semibold">
          {job.match}% Match
          {job.hot && <BoltIcon className="size-3" />}
        </p>
      </div>
    </Card>
  );
}

/** The dots between the employer, the location and the hiring status. */
function Dot() {
  return <span aria-hidden="true" className="bg-border-strong size-1 shrink-0 rounded-full" />;
}

export default function SearchPage() {
  const job = JOBS.find((entry) => entry.selected) ?? JOBS[0];

  return (
    /* Contained like every other seeker screen, not a full-bleed workspace.
       The results pane used to start at x=0 under a bar whose logo starts at
       the container's edge, so nothing on the page lined up with the bar
       above it. Under 896px of page (the shell's @container/main, which an
       open panel narrows) the detail pane steps out and the results take the
       width: two fixed panes side by side were wider than a phone, so the
       whole page scrolled sideways to reach the job. */
    <div
      className={cn(
        "max-w-app mx-auto flex w-full flex-1 flex-col gap-6 py-6 @4xl/main:flex-row @4xl/main:items-start",
        SEEKER_GUTTER,
      )}
    >
      <aside aria-labelledby="results-heading" className="flex shrink-0 flex-col @4xl/main:w-80">
        <div className="flex items-center justify-between gap-3">
          <SectionHeading as="h1" id="results-heading">
            Search Results
          </SectionHeading>
          <Badge variant="tag" pill>
            {JOBS.length} Jobs
          </Badge>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          {FILTERS.map((filter) => (
            <FilterChip key={filter.label} label={filter.label} active={filter.active} />
          ))}
          <IconButton label="More filters" variant="outline" className="ml-auto size-6.5">
            <FilterIcon className="size-3.5" />
          </IconButton>
        </div>

        <ul className="mt-4 flex flex-col gap-2.5">
          {JOBS.map((entry) => (
            <li key={entry.id}>
              <ResultCard job={entry} />
            </li>
          ))}
        </ul>
      </aside>

      <section aria-label="Job details" className="hidden min-w-0 flex-1 @4xl/main:block">
        {/* text-title, not text-display: at 28px the title outweighed the page
            heading of every other screen, and in a pane beside the results it
            wrapped long before the header ran out of room. */}
        <Card as="header" padding="lg" elevated={false} className="flex items-center gap-4">
          <CompanyTile Icon={job.Icon} size="lg" tone="outline" />

          <div className="min-w-0 flex-1">
            {/* The status rides with the title rather than at the end of the
                company line, where a wrap in the narrower pane left a dot
                dangling at the end of one line and the badge alone on the
                next. */}
            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
              <h2 className="text-title text-ink">{job.title}</h2>
              <Badge tone="positive">{DETAIL.status}</Badge>
            </div>

            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
              <TextLink href="/companies" className="text-label font-semibold">
                {job.company}
              </TextLink>
              <Dot />
              <span className="text-label text-ink-meta font-normal">{job.location}</span>
            </div>
          </div>

          <IconButton
            label={`Save ${job.title}`}
            tooltip="Save"
            variant="outline"
            className="text-ink-meta size-9 shrink-0"
          >
            <BookmarkIcon className="size-4" />
          </IconButton>

          <Button className="shrink-0">
            Apply Now
            <ExternalLinkIcon className="size-4" />
          </Button>
        </Card>

        {/* Two across at every width: the pane is ~584px at most, and four
            across left each value ~130px to wrap in. */}
        <dl className="mt-4 grid grid-cols-2 gap-3">
          {DETAIL.stats.map(({ label, value, Icon }) => (
            <div
              key={label}
              className="bg-well border-border-subtle rounded-control border px-3 py-3"
            >
              <dt className="text-caption text-ink-meta flex items-center gap-1.5 uppercase">
                <Icon className="size-3.5 shrink-0" />
                {label}
              </dt>
              <dd className="text-subtitle text-ink mt-1">{value}</dd>
            </div>
          ))}
        </dl>

        <Section title="About the Role">
          <p className="text-body text-ink-muted mt-3">{DETAIL.about}</p>
        </Section>

        {/* `marker` draws the bullets. Without it the items were indented
            with nothing in the indent, which read as a layout mistake. */}
        <Section title="What You'll Do">
          <Points items={DETAIL.responsibilities} marker />
        </Section>

        <Section title="Qualifications">
          <Points items={DETAIL.qualifications} marker />
        </Section>
      </section>
    </div>
  );
}
