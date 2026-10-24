import { ArrowRightIcon } from "@/components/icons";
import { ButtonLink } from "@/components/ui/button";
import { TextLink } from "@/components/ui/text-link";
import { cn } from "@/lib/cn";

import { getApplicationStages } from "../auto-apply/applications";
import { formatPosted } from "../jobs/format";
import { getTopMatches, isApplicant, type JobListing } from "../jobs/listings";
import { SectionCard } from "./section-card";
import { LIST } from "./top-matches-frame";
import { TopMatchesList, type TopMatchRow } from "./top-matches-list";

/**
 * Top Matches, under the headline numbers (KAN-342): the seeker's best-scoring
 * open jobs, best first, as flat rows in one tile. The scores are Best
 * Match's (`getTopMatches`), with no score floor, unlike the Strong Matches
 * number above: a new seeker's thin experience bank can score every job a
 * Weak Match, and their best weak ones are still where to start.
 *
 * This file reads; ./top-matches-list.tsx draws the heading and the rows and
 * holds Auto Apply's picking mode, which needs the browser. The posted time
 * is worked out here and handed down as words, so the server's render and
 * the browser's hydration print the same thing.
 *
 * Its own <Suspense> in the page, since scoring takes a moment and the
 * numbers above should not wait; TopMatchesSkeleton holds its shape.
 */
const SHOWN = 12;

export async function TopMatches({ className }: { className?: string }) {
  // The seeker's stages beside the scores, for each row's Save button and
  // for which rows Auto Apply can still pick, as the Jobs page reads them.
  // The best matches auto apply can fill come alongside, for picking mode:
  // the top list may hold none of them (Greenhouse only, for now).
  const [top, autoTop, canMarkApplied, stages] = await Promise.all([
    getTopMatches(SHOWN),
    getTopMatches(SHOWN, { autoApplyOnly: true }),
    isApplicant(),
    getApplicationStages(),
  ]);

  if (top === "empty" || top === null || top.length === 0) {
    return (
      <SectionCard aria-labelledby="top-matches" className={className}>
        <StaticHeading />
        <p className="text-body text-ink-meta mt-3">
          {top === "empty" ? (
            <>
              Add what you have done to your <TextLink href="/bank">experience bank</TextLink>, and
              your best-fitting jobs show up here.
            </>
          ) : top === null ? (
            "Your matches aren't loading right now. Check back in a few minutes."
          ) : (
            "No open jobs to match yet. They show up here as companies post them."
          )}
        </p>
      </SectionCard>
    );
  }

  const toRow = (job: JobListing): TopMatchRow => ({
    id: job.id,
    title: job.title,
    company: job.company,
    logoUrl: job.logo_url,
    applyUrl: job.apply_url,
    match: job.match ?? null,
    posted: job.posted_at ? formatPosted(job.posted_at) : null,
    autoApply: job.auto_apply,
    stage: stages[job.id] ?? null,
  });

  return (
    <SectionCard aria-labelledby="top-matches" className={className}>
      <TopMatchesList
        rows={top.map(toRow)}
        autoRows={Array.isArray(autoTop) ? autoTop.map(toRow) : []}
        canMarkApplied={canMarkApplied}
      />
    </SectionCard>
  );
}

/** The heading with only its way onward, where there is nothing to pick:
 *  the empty and failed states, and the skeleton. */
function StaticHeading() {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 id="top-matches" className="text-subtitle text-ink font-medium">
          Top Matches
        </h2>
        <p className="text-body text-ink-meta mt-1">Your highest-scoring jobs right now.</p>
      </div>
      <ButtonLink href="/jobs?sort=match" variant="secondary" size="sm">
        See More Matches
        <ArrowRightIcon className="size-4" />
      </ButtonLink>
    </div>
  );
}

/** Top Matches while the scores load: its heading over rows in their own
 *  shape (a logo, a title line, a meta line, the buttons), filling the same
 *  frame, so Activity below does not jump when the jobs arrive. */
export function TopMatchesSkeleton({ className }: { className?: string }) {
  return (
    <SectionCard aria-labelledby="top-matches" aria-busy="true" className={className}>
      <StaticHeading />
      <ul aria-hidden="true" className={cn(LIST, "@4xl/main:overflow-hidden")}>
        {Array.from({ length: 6 }, (_, i) => (
          <li key={i} className="bg-well rounded-card flex shrink-0 items-center gap-3 p-3">
            <span className="bg-panel rounded-control size-10 shrink-0 animate-pulse" />
            <span className="flex flex-1 flex-col gap-1.5">
              <span className="bg-panel h-3.5 w-2/3 animate-pulse rounded" />
              <span className="bg-panel h-3 w-1/3 animate-pulse rounded" />
            </span>
            <span className="bg-panel rounded-control h-9 w-28 shrink-0 animate-pulse" />
          </li>
        ))}
      </ul>
    </SectionCard>
  );
}
