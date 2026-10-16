import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { BriefcaseIcon } from "@/components/icons";
import { EmptyState } from "@/components/ui/empty-state";
import { SegmentedLinks } from "@/components/ui/segmented-control";
import { cn } from "@/lib/cn";

import { RememberFeed } from "./[jobId]/page-actions";
import { BankPrompt } from "./bank-prompt";
import { FeedHeader } from "./feed-header";
import { FeedList } from "./feed-list";
import { FeedTransition, PendingFeed } from "./feed-transition";
import { JobFilters } from "./filters";
import { ListingsError, ListingsSkeleton } from "./listing-card";
import {
  filterEntries,
  filtersQuery,
  isFiltered,
  readFilters,
  type FeedFilters,
} from "./filter-query";
import {
  getJobFacets,
  getJobListings,
  getJobLocations,
  getRecommendedPage,
  getSavedFilters,
  type FeedPage,
} from "./listings";
import { SEEKER_GUTTER } from "../gutter";
import type { ApplicationStage } from "../auto-apply/actions";
import { getApplicationStages } from "../auto-apply/applications";

export const metadata: Metadata = {
  title: "Jobs",
  description: "Roles matched to your profile.",
};

/* Built without a mockup, from the layout described in ./data. The feed is
 * live (./listings), narrowed on the server by the filter row's picks, which
 * live in the URL (./filter-query, ./filters); Save, Not Interested and Ask
 * WorkIt are still inert. The card and its loading and error states are
 * ./listing-card, which /search shares.
 *
 * TWO VIEWS (KAN-231), chosen by ?view=:
 *
 * - Recommended, the default: the jobs the filters keep, scored against the
 *   seeker's experience bank, best first (GET /jobs/recommended). With an
 *   empty bank it shows the plain feed under the same filters, below
 *   BankPrompt, which asks the student to fill it.
 * - All Jobs (?view=all): the plain feed, newest first.
 *
 * SAVED PREFERENCES APPLY ON A FRESH VISIT ONLY. /jobs with no query at all
 * (the sidebar's link, onboarding's Start Matching) redirects to the
 * Recommended view with the seeker's saved preferences written into the URL,
 * where the filter row shows them checked and can loosen them. From then on
 * the URL is the truth: Clear All leaves ?view=recommended, which is "no
 * filters", rather than bringing the saved ones back as it would if an empty
 * filter set meant "use the saved ones". */

type View = "recommended" | "all";

/** The Recommended view under these filters, as a URL. */
function recommendedHref(filters: FeedFilters): string {
  return `/jobs?${new URLSearchParams([["view", "recommended"], ...filterEntries(filters)])}`;
}

/**
 * The live feed and the states that stand in for it. Its own async component
 * so the page can stream: the heading and filter row paint at once and this
 * fills in behind <ListingsSkeleton>, where awaiting the fetch in the page held
 * the whole screen (about 840ms locally) with the previous page still showing.
 * A Suspense boundary here rather than a route loading.tsx, which would also
 * cover /jobs/[jobId].
 */
async function Feed({ filters, view }: { filters: FeedFilters; view: View }) {
  // The seeker's applications beside the first page, for the cards' Auto
  // Apply buttons: started now, awaited with whichever page is drawn.
  const stages = getApplicationStages();
  if (view === "recommended") {
    const [page, byJob] = await Promise.all([getRecommendedPage(filtersQuery(filters), 0), stages]);
    if (page) {
      // `view=recommended` in Load More's query keeps its kept pages apart
      // from the plain feed's (./feed-list).
      const query = recommendedHref(filters).slice("/jobs".length);
      return (
        <Results
          page={page}
          filters={filters}
          query={query}
          retryHref={recommendedHref(filters)}
          stages={byJob}
        />
      );
    }
  }
  // An empty bank (the API's 404) shows the plain feed; BankPrompt above it
  // already asks the student to fill the bank.
  const [page, byJob] = await Promise.all([getJobListings(filters), stages]);
  return (
    <Results
      page={page}
      filters={filters}
      query={filtersQuery(filters)}
      retryHref={`/jobs${filtersQuery(filters)}`}
      stages={byJob}
      plain
    />
  );
}

function Results({
  page,
  filters,
  query,
  retryHref,
  stages,
  plain = false,
}: {
  page: FeedPage;
  filters: FeedFilters;
  query: string;
  retryHref: string;
  stages: Record<string, ApplicationStage>;
  /** The plain feed's Load More rather than the scored one's. */
  plain?: boolean;
}) {
  const { jobs, more, error } = page;

  if (error != null) return <ListingsError error={error} retryHref={retryHref} />;

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
      <h2 className="sr-only">{plain ? "Jobs" : "Recommended Jobs"}</h2>
      {/* The first page, and a Load More for the rest (./feed-list). */}
      <FeedList
        initial={jobs}
        more={more}
        query={query}
        stages={stages}
        source={plain ? "feed" : "recommended"}
      />
    </>
  );
}

export default async function JobsPage({ searchParams }: PageProps<"/jobs">) {
  const params = await searchParams;
  if (Object.keys(params).length === 0) {
    const saved = await getSavedFilters();
    if (saved && isFiltered(saved)) redirect(recommendedHref(saved));
  }
  const view: View = params.view === "all" ? "all" : "recommended";
  const filters = readFilters(params);
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
            <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
              <div>
                <h1 className="text-heading text-ink">
                  {view === "all" ? "All Jobs" : "Recommended for You"}
                </h1>
                <p className="text-body text-ink-meta mt-1">
                  {view === "all"
                    ? "Every open role in the feed, refreshed every few hours."
                    : "Roles that fit your preferences, ranked against your experience."}
                </p>
              </div>
              {/* Recommended goes to bare /jobs, so it starts from the saved
                  preferences again; All Jobs starts from no filters. */}
              <SegmentedLinks
                label="Jobs View"
                value={view}
                options={[
                  { value: "recommended", label: "Recommended", href: "/jobs" },
                  { value: "all", label: "All Jobs", href: "/jobs?view=all" },
                ]}
              />
            </div>
          }
        >
          <JobFilters locations={locations} facets={getJobFacets()} filters={filters} />
        </FeedHeader>

        {/* An empty bank's prompt to fill or import (./bank-prompt). Its own
            boundary with no fallback, so the feed never waits on it. */}
        <Suspense fallback={null}>
          <BankPrompt />
        </Suspense>

        {/* Keyed by the view and filters, so a new pick shows the skeleton
            straight away instead of holding the old list until the narrowed
            one arrives. */}
        <PendingFeed>
          <Suspense key={`${view}${filtersQuery(filters)}`} fallback={<ListingsSkeleton />}>
            <Feed filters={filters} view={view} />
          </Suspense>
        </PendingFeed>
      </FeedTransition>
    </div>
  );
}
