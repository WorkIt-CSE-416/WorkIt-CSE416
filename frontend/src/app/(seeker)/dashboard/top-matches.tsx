import { CompanyLogo } from "@/components/company-logo";
import { ArrowRightIcon, SparkleIcon } from "@/components/icons";
import { MatchBadge } from "@/components/match-badge";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { TextLink } from "@/components/ui/text-link";
import { cn } from "@/lib/cn";

import { getApplicationStages } from "../auto-apply/applications";
import { ApplyButton } from "../jobs/apply-button";
import { formatPosted } from "../jobs/format";
import { getTailoredJobIds, getTopMatches, isApplicant } from "../jobs/listings";
import { SaveJobButton } from "../jobs/save-job-button";
import { SectionCard } from "./section-card";
import { TopMatchLink } from "./top-match-link";

/**
 * Top Matches, under the headline numbers (KAN-342): the seeker's best-scoring
 * open jobs, best first, as flat rows in one tile. The scores are Best
 * Match's (`getTopMatches`), with no score floor, unlike the Strong Matches
 * number above: a new seeker's thin experience bank can score every job a
 * Weak Match, and their best weak ones are still where to start. See More
 * Matches, at the heading's right, opens the Jobs page in Best Match order.
 *
 * FLAT ROWS, NOT THE FEED'S CARDS. The Jobs page's cards were tried here and
 * were too tall for a glance: three of them filled the screen. A row is a
 * well with the logo, the title (its link to the job posting page), the
 * company, the match ring and when it was posted, then the feed card's steps
 * toward applying: Save, Tailor My Resume, and Apply Now, which opens the
 * same dialog as everywhere else (KAN-290). The title's link makes the job
 * page's Back return here (./top-match-link.tsx).
 *
 * THE LIST SCROLLS INSIDE ITS TILE from @4xl/main, at a fixed height
 * (`h-80`, about four and a half rows, so the cut row says there is more),
 * with a quiet bar along the tile's edge (-mr-5, pr-5) and a fade at its
 * foot. The list is focusable, so it scrolls from the keyboard too. Below
 * @4xl/main it does not scroll: it shows the first five rows and the page
 * scrolls past them, since a box that scrolls inside a scrolling page traps
 * the swipe that reaches its end. This is New Matches' frame, the newest
 * postings in posting order, which this list replaced, ordered by fit.
 *
 * Its own <Suspense> in the page, since scoring takes a moment and the
 * numbers above should not wait; TopMatchesSkeleton holds its shape.
 */
const SHOWN = 12;

function Heading() {
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

/** The scrolling list's frame, shared by the rows and their skeleton. */
const LIST = cn(
  "mt-4 flex flex-col gap-2",
  "@4xl/main:-mr-5 @4xl/main:h-80 @4xl/main:overflow-y-auto @4xl/main:overscroll-contain @4xl/main:pr-5 @4xl/main:pb-6",
  "@max-4xl/main:[&>li:nth-child(n+6)]:hidden",
);

export async function TopMatches({ className }: { className?: string }) {
  // The seeker's stages and tailored resumes beside the scores, for each
  // row's Save and Tailor buttons, as the Jobs page reads them.
  const [top, canMarkApplied, stages, tailored] = await Promise.all([
    getTopMatches(SHOWN),
    isApplicant(),
    getApplicationStages(),
    getTailoredJobIds(),
  ]);

  return (
    <SectionCard aria-labelledby="top-matches" className={className}>
      <Heading />
      {top === "empty" ? (
        <p className="text-body text-ink-meta mt-3">
          Add what you have done to your <TextLink href="/bank">experience bank</TextLink>, and your
          best-fitting jobs show up here.
        </p>
      ) : top === null || top.length === 0 ? (
        <p className="text-body text-ink-meta mt-3">
          {top === null
            ? "Your matches aren't loading right now. Check back in a few minutes."
            : "No open jobs to match yet. They show up here as companies post them."}
        </p>
      ) : (
        <div className="relative">
          <ul
            tabIndex={0}
            aria-label="Top Matches"
            className={cn(
              LIST,
              "scrollbar-quiet focus-visible:ring-brand-ring rounded-xs focus-visible:ring-2 focus-visible:outline-none",
            )}
          >
            {top.map((job, i) => (
              // The rows rise in as the scores arrive, 30ms apart and capped
              // at the eighth, so the list never makes anyone wait.
              <li
                key={job.id}
                style={{ animationDelay: `${Math.min(i, 8) * 30}ms` }}
                className="bg-well rounded-card animate-rise flex shrink-0 flex-col gap-3 p-3 @xl/main:flex-row @xl/main:items-center"
              >
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  <CompanyLogo
                    name={job.company}
                    src={job.logo_url}
                    className="text-note rounded-control size-10 shrink-0"
                  />
                  <div className="min-w-0 flex-1">
                    <TopMatchLink
                      href={`/jobs/${encodeURIComponent(job.id)}`}
                      className="text-label text-ink hover:text-brand focus-visible:ring-brand-ring block rounded-xs transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none @max-4xl/main:line-clamp-2 @4xl/main:truncate"
                    >
                      {job.title}
                    </TopMatchLink>
                    <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="text-note text-ink-meta min-w-0 truncate">
                        {job.company}
                      </span>
                      {job.match != null && <MatchBadge score={job.match} />}
                      {job.posted_at && (
                        <Badge variant="tag" pill>
                          {formatPosted(job.posted_at)}
                        </Badge>
                      )}
                    </div>
                  </div>
                </div>
                {/* The feed card's steps toward applying, in its order: Save,
                    Tailor, Apply Now. Their own full-width line below
                    @xl/main: beside the text on a phone they squeezed the
                    title to two words a line. */}
                <div className="flex shrink-0 items-center gap-2 @max-xl/main:w-full">
                  <SaveJobButton jobId={job.id} title={job.title} stage={stages[job.id] ?? null} />
                  <ButtonLink
                    href={`/jobs/${encodeURIComponent(job.id)}/tailor`}
                    variant="secondary"
                    size="sm"
                    className="whitespace-nowrap @max-xl/main:flex-1"
                  >
                    <SparkleIcon className="size-4" />
                    {/* The feed card's words, shortened on a phone, where
                        "Tailor My Resume" and "Apply Now" each broke onto two
                        lines beside each other. */}
                    <span className="@max-xl/main:hidden">
                      {tailored.includes(job.id) ? "Your Tailored Resume" : "Tailor My Resume"}
                    </span>
                    <span className="@xl/main:hidden">
                      {tailored.includes(job.id) ? "Tailored" : "Tailor"}
                    </span>
                  </ButtonLink>
                  <ApplyButton
                    jobId={job.id}
                    title={job.title}
                    applyUrl={job.apply_url}
                    canMarkApplied={canMarkApplied}
                    applied={stages[job.id] === "applied"}
                    className="whitespace-nowrap @max-xl/main:flex-1"
                  />
                </div>
              </li>
            ))}
          </ul>
          <span
            aria-hidden="true"
            className="from-panel pointer-events-none absolute right-0 bottom-0 left-0 hidden h-8 bg-linear-to-t to-transparent @4xl/main:block"
          />
        </div>
      )}
    </SectionCard>
  );
}

/** Top Matches while the scores load: its heading over rows in their own
 *  shape (a logo, a title line, a meta line, the button), filling the same
 *  frame, so Activity below does not jump when the jobs arrive. */
export function TopMatchesSkeleton({ className }: { className?: string }) {
  return (
    <SectionCard aria-labelledby="top-matches" aria-busy="true" className={className}>
      <Heading />
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
