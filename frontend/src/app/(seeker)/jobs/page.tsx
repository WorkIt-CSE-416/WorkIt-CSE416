import type { Metadata } from "next";
import { Suspense } from "react";

import { BriefcaseIcon } from "@/components/icons";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/cn";

import { JobFilters } from "./filters";
import { ListingCard, ListingsError, ListingsSkeleton } from "./listing-card";
import { getJobListings, getJobLocations, placesQuery, readPlaces } from "./listings";
import { SEEKER_GUTTER } from "../gutter";

export const metadata: Metadata = {
  title: "Jobs",
  description: "Roles matched to your profile.",
};

/* Built without a mockup, from the layout described in ./data. The feed is
 * live (./listings), narrowed by the Location filter's `?location=` codes
 * (./filters); Save, Not Interested and Ask WorkIt are still inert. The card
 * and its loading and error states are ./listing-card, which /search shares. */

/**
 * The live feed and the states that stand in for it. Its own async component
 * so the page can stream: the heading and filter row paint at once and this
 * fills in behind <ListingsSkeleton>, where awaiting the fetch in the page held
 * the whole screen (about 840ms locally) with the previous page still showing.
 * A Suspense boundary here rather than a route loading.tsx, which would also
 * cover /jobs/[jobId].
 */
async function Feed({ places }: { places: string[] }) {
  const { jobs, error } = await getJobListings(places);

  if (error != null)
    return <ListingsError error={error} retryHref={`/jobs${placesQuery(places)}`} />;

  if (jobs.length === 0 && places.length > 0) {
    return (
      <EmptyState Icon={BriefcaseIcon} title="No Roles There Yet" className="mt-4">
        Nothing in the feed is offered in the places you picked. Try another location, or clear the
        filter.
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
  const places = readPlaces((await searchParams).location);
  // Not awaited: the filter row paints at once and the Location facet fills
  // in when its options land.
  const locations = getJobLocations();

  return (
    <div className={cn("max-w-app mx-auto w-full flex-1 py-6", SEEKER_GUTTER)}>
      <div>
        <h1 className="text-heading text-ink">Recommended for You</h1>
        <p className="text-body text-ink-meta mt-1">
          Roles matched to your profile, refreshed every few hours.
        </p>
      </div>

      {/* A container, so the facets switch on the row's own width (see
          ./filters), which an open sidebar narrows, not on the window's. */}
      <div className="@container mt-4 flex flex-wrap items-center gap-2">
        <JobFilters locations={locations} places={places} />
      </div>

      {/* Keyed by the places, so a new pick shows the skeleton straight away
          instead of holding the old list until the narrowed one arrives. */}
      <Suspense key={places.join()} fallback={<ListingsSkeleton />}>
        <Feed places={places} />
      </Suspense>
    </div>
  );
}
