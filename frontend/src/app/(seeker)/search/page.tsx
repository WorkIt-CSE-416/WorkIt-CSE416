import type { Metadata } from "next";
import { Suspense } from "react";

import { SearchIcon } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/cn";

import { SEEKER_GUTTER } from "../gutter";
import { FeedTransition, PendingFeed } from "../jobs/feed-transition";
import { JobFilters } from "../jobs/filters";
import { ListingCard, ListingsError, ListingsSkeleton } from "../jobs/listing-card";
import {
  filterEntries,
  filtersQuery,
  isFiltered,
  readFilters,
  type FeedFilters,
} from "../jobs/filter-query";
import { getJobFacets, getJobListings, getJobLocations, type JobListing } from "../jobs/listings";

export const metadata: Metadata = {
  title: "Search Jobs",
  description: "Find your next role.",
};

/**
 * /search, where the top bar's field lands with the query as ?q. It reads the
 * same live feed as /jobs (../jobs/listings), keeps the roles whose title or
 * company name contains the query, ignoring case, and draws them with the
 * feed's own card (../jobs/listing-card) under the feed's own filters, so a
 * role looks and acts the same whichever way it was found.
 *
 * It replaced KAN-43's mockup: a results column and a detail pane over two
 * fixtures. A scraped role has no description for a pane to show, and on a
 * phone the pane was hidden, which left a result nothing could open. Apply
 * Now on each card opens the employer's posting, as it does on /jobs.
 *
 * The heading and the filters paint at once; the count and the list stream in
 * behind placeholders in their own shape. Both await one search, started
 * here, so they cannot disagree and the API is asked once. Each boundary is
 * keyed by the query, so a new search shows its placeholders straight away
 * instead of holding the old results on screen until the new ones arrive.
 *
 * The filters are the feed's own (../jobs/filter-query): the server narrows
 * the feed by them first, and the query is matched within what comes back.
 */

type Search = Awaited<ReturnType<typeof getJobListings>>;

/** True when the query appears in the role's title or its company's name. */
function matches(job: JobListing, needle: string) {
  return job.title.toLowerCase().includes(needle) || job.company.toLowerCase().includes(needle);
}

/** The live feed under these filters, narrowed to the query. An error passes
 *  through untouched. */
async function search(query: string, filters: FeedFilters): Promise<Search> {
  const feed = await getJobListings(filters);
  if (feed.error != null) return feed;

  const needle = query.toLowerCase();
  return { jobs: feed.jobs.filter((job) => matches(job, needle)), error: null };
}

/** "12 Roles" beside the heading. Nothing when there is nothing to count:
 *  the empty state under the filters says so in words. */
async function ResultCount({ results }: { results: Promise<Search> }) {
  const { jobs } = await results;
  if (!jobs?.length) return null;

  return (
    <Badge variant="tag" pill>
      {jobs.length} {jobs.length === 1 ? "Role" : "Roles"}
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
  results: Promise<Search>;
  query: string;
  filters: FeedFilters;
}) {
  const { jobs, error } = await results;

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
      <ul className="mt-4 flex flex-col gap-3">
        {jobs.map((job, i) => (
          // The cards rise in as the feed arrives, 50ms apart and capped at
          // the sixth, about a screenful, so the list never makes anyone wait.
          <li
            key={job.id}
            style={{ animationDelay: `${Math.min(i, 6) * 50}ms` }}
            className="animate-rise"
          >
            <ListingCard job={job} />
          </li>
        ))}
      </ul>
    </>
  );
}

export default async function SearchPage({ searchParams }: PageProps<"/search">) {
  const params = await searchParams;
  const query = typeof params.q === "string" ? params.q.trim() : "";
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

  const results = search(query, filters);
  // Keys the boundaries below: a new query or a new set of filters shows the
  // placeholders straight away.
  const key = `${query}${filtersQuery(filters)}`;

  return (
    <div className={cn("max-w-app mx-auto w-full flex-1 py-6", SEEKER_GUTTER)}>
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
            <ResultCount results={results} />
          </Suspense>
        </span>
      </div>
      {subtitle}

      {/* A container, so the facets switch on the row's own width, as on
          /jobs. */}
      {/* One transition for a filter change, so the results dim the moment
          the row starts it (../jobs/feed-transition). */}
      <FeedTransition>
        <div className="@container mt-4 flex flex-wrap items-center gap-2">
          <JobFilters locations={getJobLocations()} facets={getJobFacets()} filters={filters} />
        </div>

        <PendingFeed>
          <Suspense key={key} fallback={<ListingsSkeleton />}>
            <Results results={results} query={query} filters={filters} />
          </Suspense>
        </PendingFeed>
      </FeedTransition>
    </div>
  );
}
