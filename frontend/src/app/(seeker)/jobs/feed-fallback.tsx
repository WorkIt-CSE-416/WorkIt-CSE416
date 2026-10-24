"use client";

import { useSyncExternalStore } from "react";

import { readKept, subscribe } from "./feed-pages";
import { ListingCard, ListingsSkeleton } from "./listing-card";

/**
 * Suspense fallback for the feed: renders cached cards when the cache holds
 * data for this query, or the loading skeleton on a miss. The server component
 * still resolves in the background; when it does, React replaces this with
 * fresh content.
 */
export function FeedFallback({
  query,
  altQuery,
}: {
  /** The query the feed was drawn with, as `Feed` computes it. */
  query: string;
  /** A fallback query to match: Best Match falls back to the plain feed when
   *  the bank is empty, so its cache may sit under the plain query. */
  altQuery?: string;
}) {
  const stored = useSyncExternalStore(subscribe, readKept, () => null);
  const match =
    stored && (stored.query === query || (altQuery && stored.query === altQuery))
      ? stored
      : null;

  if (!match) return <ListingsSkeleton />;

  const tailoredIds = new Set(match.tailored);

  return (
    <>
      <h2 className="sr-only">
        {match.source === "recommended" ? "Best Matches" : "Newest Jobs"}
      </h2>
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
