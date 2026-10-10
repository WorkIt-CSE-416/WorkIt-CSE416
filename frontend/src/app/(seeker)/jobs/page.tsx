import type { Metadata } from "next";
import { Suspense } from "react";

import { BriefcaseIcon } from "@/components/icons";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/cn";

import { RememberFeed } from "./[jobId]/page-actions";
import { FeedHeader } from "./feed-header";
import { FeedTransition, PendingFeed } from "./feed-transition";
import { JobFilters } from "./filters";
import { ListingCard, ListingsError, ListingsSkeleton } from "./listing-card";
import { filtersQuery, isFiltered, readFilters, type FeedFilters } from "./filter-query";
import { getJobFacets, getJobListings, getJobLocations } from "./listings";
import { SEEKER_GUTTER } from "../gutter";

export const metadata: Metadata = {
  title: "Jobs",
  description: "Roles matched to your profile.",
};

/* Built without a mockup, from the layout described in ./data. The feed is
 * live (./listings), narrowed on the server by the filter row's picks, which
 * live in the URL (./filter-query, ./filters); Save, Not Interested and Ask
 * WorkIt are still inert. The card and its loading and error states are
 * ./listing-card, which /search shares. */

/**
 * The live feed and the states that stand in for it. Its own async component
 * so the page can stream: the heading and filter row paint at once and this
 * fills in behind <ListingsSkeleton>, where awaiting the fetch in the page held
 * the whole screen (about 840ms locally) with the previous page still showing.
 * A Suspense boundary here rather than a route loading.tsx, which would also
 * cover /jobs/[jobId].
 */
async function Feed({ filters }: { filters: FeedFilters }) {
  const { jobs, error } = await getJobListings(filters);

  if (error != null)
    return <ListingsError error={error} retryHref={`/jobs${filtersQuery(filters)}`} />;

  if (jobs.length === 0 && isFiltered(filters)) {
    return (
      <EmptyState Icon={BriefcaseIcon} title="No Roles Match These Filters" className="mt-4">
        Nothing in the feed fits every filter you picked. Loosen one, or clear them all.
      </EmptyState>
    );
  }

  if (jobs.length === 0) {
    return (
      <EmptyState Icon={BriefcaseIcon} title="No Roles Yet" className="mt-4">
        New internship and new-grad roles land here as companies post them. Check back tomorrow
        morning.
      </EmptyState>
    );
  }

  return (
    <>
      {/* The level between the page's h1 and each card's h3. The card stays
          an h3 because the company preview nests it under headings of its
          own. */}
      <h2 className="sr-only">Recommended Jobs</h2>
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

export default async function JobsPage({ searchParams }: PageProps<"/jobs">) {
  const filters = readFilters(await searchParams);
  // Not awaited: the filter row paints at once and the Location facet fills
  // in when its options land.
  const locations = getJobLocations();

  return (
    <div className={cn("max-w-app mx-auto w-full flex-1 py-6", SEEKER_GUTTER)}>
      {/* So a job's page can go back to this list, filters and all. */}
      <RememberFeed />
      {/* One transition for a filter change, so the feed dims the moment the
          row starts it (./feed-transition). */}
      <FeedTransition>
        {/* The heading and filters stay put while the list scrolls. */}
        <FeedHeader
          heading={
            <>
              <h1 className="text-heading text-ink">Recommended for You</h1>
              <p className="text-body text-ink-meta mt-1">
                Roles matched to your profile, refreshed every few hours.
              </p>
            </>
          }
        >
          <JobFilters locations={locations} facets={getJobFacets()} filters={filters} />
        </FeedHeader>

        {/* Keyed by the filters, so a new pick shows the skeleton straight
            away instead of holding the old list until the narrowed one
            arrives. */}
        <PendingFeed>
          <Suspense key={filtersQuery(filters)} fallback={<ListingsSkeleton />}>
            <Feed filters={filters} />
          </Suspense>
        </PendingFeed>
      </FeedTransition>
    </div>
  );
}
