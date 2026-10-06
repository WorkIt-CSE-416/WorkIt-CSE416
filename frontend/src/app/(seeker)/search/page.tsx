import type { Metadata } from "next";

import { CoinIcon, FilterIcon, PinIcon, SearchIcon } from "@/components/icons";
import { SaveButton } from "@/components/save-button";
import { Badge } from "@/components/ui/badge";
import { Button, ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { CompanyTile } from "@/components/ui/company-tile";
import { EmptyState } from "@/components/ui/empty-state";
import { Fact } from "@/components/ui/fact";
import { FilterChip } from "@/components/ui/filter-chip";
import { IconButton } from "@/components/ui/icon-button";
import { Points, Section } from "@/components/ui/section";
import { cn } from "@/lib/cn";
import { matchColor } from "@/lib/match";

import { MatchBadge } from "../applications/match-badge";
import { SEEKER_GUTTER } from "../gutter";
import { FILTERS, JOBS, type Job } from "./data";
import { BoltIcon } from "./icons";

export const metadata: Metadata = {
  title: "Search Jobs",
  description: "Find your next role.",
};

/* KAN-43's search mockup, against the fixtures in ./data. The query is real:
 * the top bar's field (see the note in ../layout.tsx about why it lives there)
 * submits ?q, and this narrows the fixtures to it. Searching the live feed is
 * still to come, and the filters, the bookmarks and Apply Now stay inert on
 * purpose. */

/** True when the query appears in the job's title or its company's name. */
function matches(job: Job, needle: string) {
  return job.title.toLowerCase().includes(needle) || job.company.toLowerCase().includes(needle);
}

function ResultCard({ job, selected }: { job: Job; selected: boolean }) {
  const { Icon } = job;

  return (
    <Card
      as="article"
      padding="sm"
      selected={selected}
      aria-current={selected ? "true" : undefined}
    >
      {/* Save sits beside the title and company together, as on a /jobs
          card, so its 32px never pushes a one-line title off its company. */}
      <div className="flex items-start gap-3">
        <CompanyTile Icon={Icon} size="md" tone={job.tone} />

        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-1.5">
            <h2 className="text-subtitle text-ink min-w-0 flex-1">{job.title}</h2>
            {job.isNew && <Badge tone="positive">New</Badge>}
          </div>
          <p className="text-note text-ink-meta mt-0.5">{job.company}</p>
        </div>

        <SaveButton title={job.title} saved={job.saved} />
      </div>

      <div className="mt-2.5 flex flex-wrap items-center gap-x-3.5 gap-y-1">
        <Fact Icon={PinIcon}>{job.location}</Fact>
        <Fact Icon={CoinIcon}>{job.salary}</Fact>
      </div>

      {/* The score in the same banded pill the applications board draws, so
          a match reads the same colour on every screen. The spark takes the
          band's colour too. */}
      <div className="mt-2.5 flex items-center justify-between gap-3">
        <p className="text-meta text-ink-meta">{job.posted}</p>
        <div className="flex items-center gap-1">
          <MatchBadge score={job.match} />
          {job.hot && (
            <span style={{ color: matchColor(job.match) }}>
              <BoltIcon className="size-3" />
            </span>
          )}
        </div>
      </div>
    </Card>
  );
}

/** The dots between the employer, the location and the hiring status. */
function Dot() {
  return <span aria-hidden="true" className="bg-border-strong size-1 shrink-0 rounded-full" />;
}

export default async function SearchPage({ searchParams }: PageProps<"/search">) {
  const { q } = await searchParams;
  const query = typeof q === "string" ? q.trim() : "";
  const needle = query.toLowerCase();
  const results = needle ? JOBS.filter((entry) => matches(entry, needle)) : JOBS;
  const job: Job | undefined = results.find((entry) => entry.selected) ?? results[0];

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
      {/* With nothing to detail, the results column takes the whole width,
          as the empty state on /jobs does. */}
      <aside
        aria-labelledby="results-heading"
        className={cn("flex shrink-0 flex-col", job ? "@4xl/main:w-80" : "min-w-0 flex-1")}
      >
        {/* The page title, at every seeker screen's text-heading. The count
            sits on the heading's first line however far a long query wraps. */}
        <div className="flex items-baseline justify-between gap-3">
          <h1 id="results-heading" className="text-heading text-ink min-w-0 break-words">
            {query ? `Results for “${query}”` : "Search Jobs"}
          </h1>
          <Badge variant="tag" pill>
            {results.length} {results.length === 1 ? "Job" : "Jobs"}
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

        {job ? (
          <ul className="mt-4 flex flex-col gap-2.5">
            {results.map((entry) => (
              <li key={entry.id}>
                <ResultCard job={entry} selected={entry.id === job.id} />
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState
            Icon={SearchIcon}
            title={`No roles match “${query}”`}
            className="mt-4"
            action={
              <ButtonLink href="/jobs" variant="secondary" size="sm">
                Browse All Jobs
              </ButtonLink>
            }
          >
            Try a different title or company name.
          </EmptyState>
        )}
      </aside>

      {job && (
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
                <Badge tone="positive">{job.detail.status}</Badge>
              </div>

              {/* The company in ink, as on every job card: there is no company
                  page for it to link to yet. */}
              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="text-label text-ink font-medium">{job.company}</span>
                <Dot />
                <span className="text-label text-ink-meta font-normal">{job.location}</span>
              </div>
            </div>

            <SaveButton title={job.title} saved={job.saved} />

            <Button className="shrink-0">Apply Now</Button>
          </Card>

          {/* Two across at every width: the pane is ~584px at most, and four
              across left each value ~130px to wrap in. */}
          <dl className="mt-4 grid grid-cols-2 gap-3">
            {job.detail.stats.map(({ label, value, Icon }) => (
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
            <p className="text-body text-ink-muted mt-3">{job.detail.about}</p>
          </Section>

          {/* `marker` draws the bullets. Without it the items were indented
              with nothing in the indent, which read as a layout mistake. */}
          <Section title="What You'll Do">
            <Points items={job.detail.responsibilities} marker />
          </Section>

          <Section title="Qualifications">
            <Points items={job.detail.qualifications} marker />
          </Section>
        </section>
      )}
    </div>
  );
}
