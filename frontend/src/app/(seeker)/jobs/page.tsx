import type { Metadata } from "next";
import { Suspense } from "react";

import { BriefcaseIcon } from "@/components/icons";
import { EmptyState } from "@/components/ui/empty-state";
import { SegmentedLinks } from "@/components/ui/segmented-control";
import { cn } from "@/lib/cn";

import { RememberFeed } from "./[jobId]/page-actions";
import { BankPrompt } from "./bank-prompt";
import { CanonicalUrl } from "./canonical-url";
import { FeedHeader } from "./feed-header";
import { FeedFallback } from "./feed-fallback";
import { FeedList } from "./feed-list";
import { FeedTransition, PendingFeed } from "./feed-transition";
import { JobFilters } from "./filters";
import { ListingsError } from "./listing-card";
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
  getTailoredJobIds,
  isApplicant,
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
 * ONE LIST, TWO ORDERS (KAN-288), chosen by ?sort=:
 *
 * - Best Match (?sort=match), the default: the jobs the filters keep, scored
 *   against the seeker's experience bank, best first (GET
 *   /jobs/recommended). With an empty bank it shows the newest first under
 *   the same filters, below BankPrompt, which asks the student to fill it.
 * - Newest (?sort=newest): the plain feed, newest first.
 *
 * These were two views, Recommended and All Jobs, behind a switcher
 * (KAN-231). They drew the same filter row and the same cards, so they read
 * as one page, and they were merged into one list with a sort. An old
 * ?view=all link opens Newest; ?view=recommended opens Best Match.
 *
 * SAVED PREFERENCES APPLY ON A FRESH VISIT ONLY. /jobs with no query at all
 * (the sidebar's link, onboarding's Start Matching) draws Best Match with the
 * seeker's saved preferences, where the filter row shows them checked and can
 * loosen them, and writes them into the URL in place (./canonical-url). From
 * then on the URL is the truth: Clear All leaves ?sort=, which is "no
 * filters", rather than bringing the saved ones back as it would if an empty
 * filter set meant "use the saved ones".
 *
 * IN ONE ROUND TRIP. This was a redirect() to that URL, so the sidebar's
 * most used link cost two: the first answer (after the preferences read)
 * held only the redirect, and the router then asked for the page again. Now
 * the page draws the redirect's target itself, from the address that target
 * would have (`shown` below), so every part of it (the Sort By links, the
 * filter row, the list's query and Load More's key) is exactly what that
 * address draws on a reload. */

type Sort = "match" | "newest";

/** The page's order: ?sort=, else an old link's ?view= (All Jobs was the
 *  newest first), else Best Match. */
function readSort(params: Record<string, string | string[] | undefined>): Sort {
  const sort = [params.sort].flat()[0];
  if (sort === "match" || sort === "newest") return sort;
  return [params.view].flat()[0] === "all" ? "newest" : "match";
}

/** The list in this order under these filters, as a URL. */
function sortHref(sort: Sort, filters: FeedFilters): string {
  return `/jobs?${new URLSearchParams([["sort", sort], ...filterEntries(filters)])}`;
}

/** A URL's query in the shape a page's searchParams take, so the page can
 *  read an address it did not arrive at the way it reads its own. Every
 *  value is a list, which readSort and readFilters both take. */
function paramsOf(href: string): Record<string, string[]> {
  const params: Record<string, string[]> = {};
  for (const [key, value] of new URL(href, "http://n").searchParams) {
    (params[key] ??= []).push(value);
  }
  return params;
}

/**
 * The live feed and the states that stand in for it. Its own async component
 * so the page can stream: the heading and filter row paint at once and this
 * fills in behind <FeedFallback> (the last first page drawn, or the skeleton),
 * where awaiting the fetch in the page held
 * the whole screen (about 840ms locally) with the previous page still showing.
 * A Suspense boundary here rather than a route loading.tsx, which would also
 * cover /jobs/[jobId].
 *
 * `stages`, `tailored` and `applicant` are the seeker's applications, tailored
 * resumes and account type, for the cards' Auto Apply, Tailor and Apply Now
 * buttons. The page starts them before anything else (they do not depend on
 * the filters), and this awaits them with whichever page is drawn.
 */
async function Feed({
  filters,
  sort,
  stages,
  tailored,
  applicant,
}: {
  filters: FeedFilters;
  sort: Sort;
  stages: Promise<Record<string, ApplicationStage>>;
  tailored: Promise<string[]>;
  applicant: Promise<boolean>;
}) {
  if (sort === "match") {
    const [page, byJob, tailoredIds, canMarkApplied] = await Promise.all([
      getRecommendedPage(filtersQuery(filters), 0),
      stages,
      tailored,
      applicant,
    ]);
    if (page) {
      // `sort=match` in Load More's query keeps its kept pages apart from
      // the plain feed's (./feed-list).
      const query = sortHref("match", filters).slice("/jobs".length);
      return (
        <Results
          page={page}
          filters={filters}
          query={query}
          retryHref={sortHref("match", filters)}
          stages={byJob}
          tailored={tailoredIds}
          canMarkApplied={canMarkApplied}
        />
      );
    }
  }
  // Newest, or Best Match with an empty bank (the API's 404): the plain
  // feed. BankPrompt above it already asks the student to fill the bank.
  const [page, byJob, tailoredIds, canMarkApplied] = await Promise.all([
    getJobListings(filters),
    stages,
    tailored,
    applicant,
  ]);
  return (
    <Results
      page={page}
      filters={filters}
      query={filtersQuery(filters)}
      retryHref={sortHref(sort, filters)}
      stages={byJob}
      tailored={tailoredIds}
      canMarkApplied={canMarkApplied}
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
  tailored,
  canMarkApplied,
  plain = false,
}: {
  page: FeedPage;
  filters: FeedFilters;
  query: string;
  retryHref: string;
  stages: Record<string, ApplicationStage>;
  tailored: string[];
  canMarkApplied: boolean;
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
      <h2 className="sr-only">{plain ? "Newest Jobs" : "Best Matches"}</h2>
      {/* The first page, and a Load More for the rest (./feed-list). */}
      <FeedList
        initial={jobs}
        more={more}
        query={query}
        stages={stages}
        tailored={tailored}
        canMarkApplied={canMarkApplied}
        source={plain ? "feed" : "recommended"}
      />
    </>
  );
}

export default async function JobsPage({ searchParams }: PageProps<"/jobs">) {
  // Everything the filters don't decide, started before the one read they
  // might wait on (a fresh visit's saved preferences), so that read no longer
  // holds them back. None is awaited here: the filter row paints at once and
  // the Location and Role facets fill in when their options land, and Feed
  // awaits the rest with its first page.
  const locations = getJobLocations();
  const facets = getJobFacets();
  const stages = getApplicationStages();
  const tailored = getTailoredJobIds();
  const applicant = isApplicant();

  const params = await searchParams;
  // A fresh visit with saved preferences draws the address it stands for,
  // which ./canonical-url then puts in the address bar.
  let canonical: string | null = null;
  if (Object.keys(params).length === 0) {
    const saved = await getSavedFilters();
    if (saved && isFiltered(saved)) canonical = sortHref("match", saved);
  }
  const shown = canonical ? paramsOf(canonical) : params;
  const sort = readSort(shown);
  const filters = readFilters(shown);

  return (
    <div className={cn("max-w-app mx-auto w-full flex-1 py-6", SEEKER_GUTTER)}>
      {canonical && <CanonicalUrl href={canonical} />}
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
                <h1 className="text-heading text-ink">Jobs</h1>
                <p className="text-body text-ink-meta mt-1">
                  {sort === "match"
                    ? "Roles that fit your preferences, ranked against your experience."
                    : "Every open role in the feed, newest first."}
                </p>
              </div>
              {/* Each order keeps the filters as they stand. */}
              <SegmentedLinks
                label="Sort By"
                value={sort}
                options={[
                  { value: "match", label: "Best Match", href: sortHref("match", filters) },
                  { value: "newest", label: "Newest", href: sortHref("newest", filters) },
                ]}
              />
            </div>
          }
        >
          <JobFilters locations={locations} facets={facets} filters={filters} />
        </FeedHeader>

        {/* An empty bank's prompt to fill or import (./bank-prompt). Its own
            boundary with no fallback, so the feed never waits on it. */}
        <Suspense fallback={null}>
          <BankPrompt />
        </Suspense>

        {/* Keyed by the order and filters, so a new pick shows the skeleton
            straight away instead of holding the old list until the narrowed
            one arrives. The fallback draws this query's last first page
            (./feed-fallback), or the skeleton when there is none. */}
        <PendingFeed>
          <Suspense
            key={`${sort}${filtersQuery(filters)}`}
            fallback={
              <FeedFallback
                query={
                  sort === "match"
                    ? sortHref("match", filters).slice("/jobs".length)
                    : filtersQuery(filters)
                }
                altQuery={sort === "match" ? filtersQuery(filters) : undefined}
              />
            }
          >
            <Feed
              filters={filters}
              sort={sort}
              stages={stages}
              tailored={tailored}
              applicant={applicant}
            />
          </Suspense>
        </PendingFeed>
      </FeedTransition>
    </div>
  );
}
