import type { Metadata } from "next";
import { Suspense } from "react";

import { SearchIcon } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/cn";

import { SEEKER_GUTTER } from "../gutter";
import { RememberFeed } from "../jobs/[jobId]/page-actions";
import { FeedHeader } from "../jobs/feed-header";
import { FeedTransition, PendingFeed } from "../jobs/feed-transition";
import { JobFilters } from "../jobs/filters";
import { FeedList } from "../jobs/feed-list";
import { ListingsError, ListingsSkeleton } from "../jobs/listing-card";
import {
  feedQuery,
  filterEntries,
  isFiltered,
  readFilters,
  readQuery,
  type FeedFilters,
} from "../jobs/filter-query";
import {
  getJobCount,
  getJobFacets,
  getJobListings,
  getJobLocations,
  type FeedPage,
} from "../jobs/listings";

export const metadata: Metadata = {
  title: "Search Jobs",
  description: "Find your next role.",
};

/**
 * /search, where the top bar's field lands with the query as ?q. It asks the
 * same live feed as /jobs (../jobs/listings) for the roles whose title or
 * company name contains the query, ignoring case, and draws them with the
 * feed's own list and card (../jobs/feed-list) under the feed's own filters,
 * so a role looks and acts the same whichever way it was found. The API does
 * the matching, across every job: it used to happen here, inside the 50 the
 * feed had sent, so the 51st newest role could never be found (KAN-171). A
 * page holds the first 50 matches, and Load More adds the rest.
 *
 * It replaced KAN-43's mockup: a results column and a detail pane over two
 * fixtures. A scraped role has no description for a pane to show, and on a
 * phone the pane was hidden, which left a result nothing could open. Apply
 * Now on each card opens the employer's posting, as it does on /jobs.
 *
 * The heading and the filters paint at once; the count and the list stream in
 * behind placeholders in their own shape. The count is every match, not the
 * page shown, so it comes from GET /jobs/count beside the list's own request,
 * under the same filters and words. Each boundary is keyed by the query, so a
 * new search shows its placeholders straight away instead of holding the old
 * results on screen until the new ones arrive.
 *
 * The filters are the feed's own (../jobs/filter-query), sent with the words.
 */

/** "128 Roles" beside the heading, every match. Nothing when there is
 *  nothing to count (the empty state under the filters says so in words) or
 *  the API can't say. */
async function ResultCount({ count }: { count: Promise<number | null> }) {
  const n = await count;
  if (!n) return null;

  return (
    <Badge variant="tag" pill>
      {n} {n === 1 ? "Role" : "Roles"}
    </Badge>
  );
}

/** The count's place while the search runs: the badge's own box and type, with
 *  the text hidden, so it is the size of a two-digit count. It sits in the
 *  same fixed slot the count lands in, so swapping one for the other moves
 *  nothing. */
function ResultCountSkeleton() {
  return (
    <span
      aria-hidden="true"
      className="bg-muted text-note inline-flex animate-pulse rounded-full px-2 py-0.5 text-transparent"
    >
      00 Roles
    </span>
  );
}

/** The matching roles, or the state that stands in for them. */
async function Results({
  results,
  query,
  filters,
}: {
  results: Promise<FeedPage>;
  query: string;
  filters: FeedFilters;
}) {
  const { jobs, more, error } = await results;

  if (error != null) {
    const retry = new URLSearchParams([["q", query], ...filterEntries(filters)]);
    return <ListingsError error={error} retryHref={`/search?${retry}`} />;
  }

  if (jobs.length === 0) {
    return (
      <EmptyState
        Icon={SearchIcon}
        title={`No Roles Match “${query}”`}
        className="mt-4"
        action={
          <ButtonLink href="/jobs" variant="secondary" size="sm">
            Browse All Jobs
          </ButtonLink>
        }
      >
        {isFiltered(filters)
          ? "Try a different title or company name, loosen a filter, or browse every role in the feed."
          : "Try a different title or company name, or browse every role in the feed."}
      </EmptyState>
    );
  }

  return (
    <>
      {/* The level between the page's h1 and each card's h3, as on /jobs. */}
      <h2 className="sr-only">Search Results</h2>
      {/* The first page of matches, and a Load More for the rest. */}
      <FeedList initial={jobs} more={more} query={feedQuery(filters, query)} />
    </>
  );
}

export default async function SearchPage({ searchParams }: PageProps<"/search">) {
  const params = await searchParams;
  const query = readQuery(params);
  const filters = readFilters(params);

  /* The heading and subtitle every state shares, at /jobs's sizes. */
  const subtitle = (
    <p className="text-body text-ink-meta mt-1">
      Roles from today&apos;s feed, matched by title or company.
    </p>
  );

  /* Reached by submitting an empty field, or by the URL alone. No filters and
     no count, since nothing has been searched for them to narrow or count. */
  if (!query) {
    return (
      <div className={cn("max-w-app mx-auto w-full flex-1 py-6", SEEKER_GUTTER)}>
        <h1 className="text-heading text-ink">Search Jobs</h1>
        {subtitle}

        <EmptyState
          Icon={SearchIcon}
          title="Search for a Role"
          className="mt-6"
          action={
            <ButtonLink href="/jobs" variant="secondary" size="sm">
              Browse All Jobs
            </ButtonLink>
          }
        >
          Search by job title or company name, or browse every role in the feed.
        </EmptyState>
      </div>
    );
  }

  const results = getJobListings(filters, query);
  const count = getJobCount(filters, query);
  // Keys the boundaries below: a new query or a new set of filters shows the
  // placeholders straight away.
  const key = feedQuery(filters, query);

  return (
    <div className={cn("max-w-app mx-auto w-full flex-1 py-6", SEEKER_GUTTER)}>
      {/* So a job's page can come back to these results. */}
      <RememberFeed />
      {/* One transition for a filter change, so the results dim the moment
          the row starts it (../jobs/feed-transition). */}
      <FeedTransition>
        {/* The heading and filters stay put while the results scroll, as on
            /jobs. */}
        <FeedHeader
          heading={
            <>
              {/* The heading runs inline, so the count follows its last word however
                  far a long query wraps it. As the end of a flex row it was pushed to
                  the far edge whenever the heading wrapped, where it read as
                  belonging to nothing.

                  The count's slot is a fixed width (72px holds "999 Roles"), held
                  whether it shows the placeholder, a count or nothing at all, so a
                  long query wraps at the same word before and after the results land
                  and nothing below moves. It is centred on the heading's x-height
                  (align-middle, against the wrapper's own text-heading) rather than
                  sitting on the baseline, where the pill hung below the heading's
                  letters. The count is a live region, so a screen reader hears how
                  many roles a search found once they land. */}
              <div className="text-heading break-words">
                <h1 className="text-heading text-ink inline">Results for “{query}”</h1>
                <span role="status" className="ml-3 inline-flex w-18 align-middle">
                  <Suspense key={key} fallback={<ResultCountSkeleton />}>
                    <ResultCount count={count} />
                  </Suspense>
                </span>
              </div>
              {subtitle}
            </>
          }
        >
          <JobFilters locations={getJobLocations()} facets={getJobFacets()} filters={filters} />
        </FeedHeader>

        <PendingFeed>
          <Suspense key={key} fallback={<ListingsSkeleton />}>
            <Results results={results} query={query} filters={filters} />
          </Suspense>
        </PendingFeed>
      </FeedTransition>
    </div>
  );
}
