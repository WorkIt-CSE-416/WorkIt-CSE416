import { ArrowRightIcon } from "@/components/icons";
import { ButtonLink } from "@/components/ui/button";
import { TextLink } from "@/components/ui/text-link";
import { cn } from "@/lib/cn";

import { getApplicationStages } from "../auto-apply/applications";
import { ListingCard, ListingsSkeleton } from "../jobs/listing-card";
import { getTailoredJobIds, getTopMatches, isApplicant } from "../jobs/listings";

/**
 * Top Matches, under the headline numbers (KAN-342): the seeker's best-scoring
 * open jobs, best first, as the Jobs page's own cards stacked one over the
 * next (`ListingCard`, with its match rail, Save, Tailor and Apply Now). The
 * scores are Best Match's (`getTopMatches`), with no score floor, unlike the
 * Good Matches number above: a new seeker's thin experience bank can score
 * every job a Weak Match, and their best weak ones are still where to start.
 * See More Matches, at the heading's right, opens the Jobs page in Best Match
 * order for the rest.
 *
 * An open section, not a tile: the feed's cards are cards already, and inside
 * a white tile they drew a box in a box.
 *
 * It came back in place of New Matches, the newest postings in posting order,
 * which went when Good Matches replaced New Roles; the user asked for a list
 * ordered by fit. Its own <Suspense> in the page, since scoring takes a
 * moment and the numbers above should not wait; TopMatchesSkeleton holds the
 * same heading and SHOWN cards.
 */
const SHOWN = 3;

function Heading() {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
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

export async function TopMatches({ className }: { className?: string }) {
  const [top, stages, tailored, canMarkApplied] = await Promise.all([
    getTopMatches(SHOWN),
    getApplicationStages(),
    getTailoredJobIds(),
    isApplicant(),
  ]);

  return (
    <section aria-labelledby="top-matches" className={className}>
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
        <ul aria-label="Top Matches" className="mt-4 flex flex-col gap-3">
          {top.map((job, i) => (
            // Rise in as the feed's cards do, 40ms apart.
            <li key={job.id} className="animate-rise" style={{ animationDelay: `${i * 40}ms` }}>
              <ListingCard
                job={job}
                stage={stages[job.id] ?? null}
                tailored={tailored.includes(job.id)}
                canMarkApplied={canMarkApplied}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Top Matches while the scores load: its heading over the feed's own
 *  skeleton cards, SHOWN of them, so Activity below does not jump. */
export function TopMatchesSkeleton({ className }: { className?: string }) {
  return (
    <section aria-labelledby="top-matches" aria-busy="true" className={cn(className)}>
      <Heading />
      <ListingsSkeleton count={SHOWN} />
    </section>
  );
}
