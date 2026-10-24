"use client";

import { useSyncExternalStore } from "react";

import { readKept, subscribe } from "./feed-pages";
import { ListingCard, ListingsSkeleton } from "./listing-card";

/**
 * The Suspense fallback for the feed: renders cached cards when the cache
 * matches this query, or the skeleton on a miss. A return to /jobs sees the
 * feed instantly while the server component resolves behind it.
 */
export function FeedFallback({ query, altQuery }: { query: string; altQuery?: string }) {
  const stored = useSyncExternalStore(subscribe, readKept, () => null);
  const match =
    stored && (stored.query === query || (altQuery && stored.query === altQuery)) ? stored : null;
  if (!match) return <ListingsSkeleton />;

  const tailoredIds = new Set(match.tailored);
  return (
    <>
      <h2 className="sr-only">{match.source === "recommended" ? "Best Matches" : "Newest Jobs"}</h2>
      <ul className="mt-4 flex flex-col gap-3">
        {match.jobs.map((job) => (
          <li key={job.id} data-job-id={job.id}>
            <ListingCard
              job={job}
              stage={match.stages[job.id] ?? null}
              tailored={tailoredIds.has(job.id)}
              canMarkApplied={match.canMarkApplied}
            />
          </li>
        ))}
      </ul>
    </>
  );
}
