import type { Metadata } from "next";
import { Suspense } from "react";

import { SearchIcon } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/cn";
import { formatCount } from "@/lib/format-count";

import { SEEKER_GUTTER } from "../gutter";
import { RememberFeed } from "../jobs/[jobId]/page-actions";
import { FeedTransition, PendingFeed } from "../jobs/feed-transition";
import { getApplicationStages } from "../auto-apply/applications";
import { FeedList } from "../jobs/feed-list";
import { ListingsError, ListingsSkeleton } from "../jobs/listing-card";
import { feedQuery, NO_FILTERS, readQuery } from "../jobs/filter-query";
import {
  getJobCount,
  getJobListings,
  getTailoredJobIds,
  isApplicant,
  type FeedPage,
} from "../jobs/listings";

export const metadata: Metadata = {
  title: "Search Jobs",
  description: "Find your next role.",
};

/**
 * /search, where the top bar's field lands with the query as ?q. It asks the
 * same live feed as /jobs (../jobs/listings) for what the query names: the
 * API reads it with the role resolver (KAN-155), so "swe intern stripe" is
 * software engineer internships at Stripe or that mention it, a typo
 * corrected, newest first (backend/app/routers/jobs.py). It draws them with the
 * feed's own list and card (../jobs/feed-list), so a role looks and acts the
 * same whichever way it was found. The API does the matching, across every
 * job: it used to happen here, inside the 50 the feed had sent, so the 51st
 * newest role could never be found (KAN-171). A page holds the first 50
 * matches, and Load More adds the rest.
 *
 * FILTERS ARE NOT APPLIED ON SEARCH (KAN-308). A search always starts with
 * a clean slate: any filters the seeker had on /jobs are not carried here,
 * and the filter row is not shown. The search query alone decides what
 * matches. To narrow by location, job type or other facets, the seeker goes
 * back to /jobs and uses the filters there.
 *
 * The heading paints at once; the count and the list stream in behind
 * placeholders in their own shape. The count is every match, not the page
 * shown, so it comes from GET /jobs/count beside the list's own request.
 * Each boundary is keyed by the query, so a new search shows its
 * placeholders straight away instead of holding the old results on screen
 * until the new ones arrive.
 */

/** "128 Roles" beside the heading, every match. Nothing when there is
 *  nothing to count (the empty state under the filters says so in words) or
 *  the API can't say. */
async function ResultCount({ count }: { count: Promise<number | null> }) {
  const n = await count;
  if (!n) return null;

  return (
    <Badge variant="tag" pill>
      {formatCount(n)} {n === 1 ? "Role" : "Roles"}
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
async function Results({ results, query }: { results: Promise<FeedPage>; query: string }) {
  // The seeker's applications and tailored resumes, for the cards' Auto Apply
  // and Tailor buttons, and whether Apply Now may ask "Did You Apply?" (as
  // /jobs).
  const [{ jobs, more, error }, stages, tailored, canMarkApplied] = await Promise.all([
    results,
    getApplicationStages(),
    getTailoredJobIds(),
    isApplicant(),
  ]);

  if (error != null) {
    const retry = new URLSearchParams([["q", query]]);
    return <ListingsError error={error} retryHref={`/search?${retry}`} />;
  }

  if (jobs.length === 0) {
    return (
      <EmptyState
        Icon={SearchIcon}
        title={`No Roles Match "${query}"`}
        className="mt-4"
        action={
          <ButtonLink href="/jobs" variant="secondary" size="sm">
            Browse All Jobs
          </ButtonLink>
        }
      >
        Try a different title or company name, or browse every role in the feed.
      </EmptyState>
    );
  }

  return (
    <>
      {/* The level between the page's h1 and each card's h3, as on /jobs. */}
      <h2 className="sr-only">Search Results</h2>
      {/* The first page of matches, and a Load More for the rest. */}
      <FeedList
        initial={jobs}
        more={more}
        query={feedQuery(NO_FILTERS, query)}
        stages={stages}
        tailored={tailored}
        canMarkApplied={canMarkApplied}
      />
    </>
  );
}

export default async function SearchPage({ searchParams }: PageProps<"/search">) {
  const params = await searchParams;
  const query = readQuery(params);

  /* The heading and subtitle every state shares, at /jobs's sizes. */
  const subtitle = (
    <p className="text-body text-ink-meta mt-1">
      Roles from today&apos;s feed, matched by role, company and description.
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

  // Filters are always cleared on search (KAN-308).
  const results = getJobListings(NO_FILTERS, query);
  const count = getJobCount(NO_FILTERS, query);
  const key = feedQuery(NO_FILTERS, query);

  return (
    <div className={cn("max-w-app mx-auto w-full flex-1 py-6", SEEKER_GUTTER)}>
      {/* So a job's page can come back to these results. */}
      <RememberFeed />
      <FeedTransition>
        <div className="text-heading break-words">
          <h1 className="text-heading text-ink inline">Results for &ldquo;{query}&rdquo;</h1>
          <span role="status" className="ml-3 inline-flex w-22 align-middle">
            <Suspense key={key} fallback={<ResultCountSkeleton />}>
              <ResultCount count={count} />
            </Suspense>
          </span>
        </div>
        {subtitle}

        <PendingFeed>
          <Suspense key={key} fallback={<ListingsSkeleton />}>
            <Results results={results} query={query} />
          </Suspense>
        </PendingFeed>
      </FeedTransition>
    </div>
  );
}
