import type { Metadata } from "next";
import type { ReactNode } from "react";

import { BookmarkIcon, CoinIcon, FilterIcon, PinIcon } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { CompanyTile } from "@/components/ui/company-tile";
import { Fact } from "@/components/ui/fact";
import { FilterChip } from "@/components/ui/filter-chip";
import { IconButton } from "@/components/ui/icon-button";
import { SectionHeading } from "@/components/ui/section-heading";
import { TextLink } from "@/components/ui/text-link";
import { cn } from "@/lib/cn";

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

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-5">
      <SectionHeading>{title}</SectionHeading>
      {children}
    </section>
  );
}

/** The mockup indents these and draws no markers, so the marker is dropped
 *  rather than faked. role="list" keeps the semantics Safari removes when a
 *  list has no marker. */
function Points({ items }: { items: string[] }) {
  return (
    <ul role="list" className="mt-3 flex flex-col gap-1.5 pl-4">
      {items.map((item) => (
        <li key={item} className="text-label text-ink-muted leading-5 font-normal">
          {item}
        </li>
      ))}
    </ul>
  );
}

export default function SearchPage() {
  const job = JOBS.find((entry) => entry.selected) ?? JOBS[0];

  return (
    <div className="flex flex-1 items-stretch">
      <aside
        aria-labelledby="results-heading"
        className="bg-well border-border-subtle flex w-90 shrink-0 flex-col border-r"
      >
        <div className="bg-panel px-2 pt-3 pb-4">
          <div className="flex items-center justify-between gap-3">
            <SectionHeading as="h1" id="results-heading">
              Search Results
            </SectionHeading>
            <Badge variant="tag" pill>
              {JOBS.length} Jobs
            </Badge>
          </div>

          <div className="mt-2 flex items-center gap-1.5">
            {FILTERS.map((filter) => (
              <FilterChip key={filter.label} label={filter.label} active={filter.active} />
            ))}
            <IconButton label="More filters" variant="outline" className="ml-auto size-6.5">
              <FilterIcon className="size-3.5" />
            </IconButton>
          </div>
        </div>

        <ul className="flex flex-col gap-2.5 p-2">
          {JOBS.map((entry) => (
            <li key={entry.id}>
              <ResultCard job={entry} />
            </li>
          ))}
        </ul>
      </aside>

      <main className="bg-panel min-w-0 flex-1 px-6 pt-5 pb-12">
        <Card as="header" padding="lg" elevated={false} className="flex items-center gap-4">
          <CompanyTile Icon={job.Icon} size="lg" tone="outline" />

          <div className="min-w-0 flex-1">
            <h2 className="text-display text-ink">{job.title}</h2>

            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
              <TextLink href="/companies" className="text-label font-semibold">
                {job.company}
              </TextLink>
              <Dot />
              <span className="text-label text-ink-meta font-normal">{job.location}</span>
              <Dot />
              <Badge tone="positive">{DETAIL.status}</Badge>
            </div>
          </div>

          <IconButton
            label={`Save ${job.title}`}
            variant="outline"
            className="text-ink-meta h-10 w-6 shrink-0"
          >
            <BookmarkIcon className="size-4" />
          </IconButton>

          <Button size="lg" className="shrink-0">
            Apply Now
            <ExternalLinkIcon className="size-4" />
          </Button>
        </Card>

        <dl className="mt-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
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
          <p className="text-label text-ink-muted mt-3 leading-5 font-normal">{DETAIL.about}</p>
        </Section>

        <Section title="What You'll Do">
          <Points items={DETAIL.responsibilities} />
        </Section>

        <Section title="Qualifications">
          <Points items={DETAIL.qualifications} />
        </Section>
      </main>
    </div>
  );
}
