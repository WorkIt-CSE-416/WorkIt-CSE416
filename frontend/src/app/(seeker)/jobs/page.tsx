import type { Metadata } from "next";
import { Suspense } from "react";

import { BriefcaseIcon } from "@/components/icons";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/cn";

import { JobPage } from "./[jobId]/job-page";
import JobLoading from "./[jobId]/loading";
import { RememberFeed } from "./[jobId]/page-actions";
import { BankPrompt } from "./bank-prompt";
import { CanonicalUrl } from "./canonical-url";
import { FeedHeader } from "./feed-header";
import { FeedFallback } from "./feed-fallback";
import { FeedList } from "./feed-list";
import { FeedTransition, PendingFeed } from "./feed-transition";
import { JobFilters } from "./filters";
import { JobsTopRow } from "./jobs-top-row";
import { ListingsError } from "./listing-card";
import {
  filtersQuery,
  isFiltered,
  listQuery,
  queryParams,
  readFilters,
  readSort,
  sortHref,
  type FeedFilters,
  type Sort,
} from "./filter-query";
import {
  getJobFacets,
  getJobListings,
  getJobLocations,
  getJobsView,
  getRecommendedPage,
  getSavedFilters,
  drawnAt,
  getTailoredJobIds,
  isApplicant,
  type FeedPage,
} from "./listings";
import { RememberShownList } from "./remember-shown-list";
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
 * would have (`shown` below), so every part of it (the Sort menu, the
 * filter row, the list's query and Load More's key) is exactly what that
 * address draws on a reload.
 *
 * TWO VIEWS OF THE LIST (KAN-519), chosen by the switch at the heading's end and kept
 * in a cookie (./view): the large cards, or the split view. In the split view
 * this page draws only the open job, the list's first: the layout's frame draws
 * the heading, the filters and the list (./jobs-rail.tsx), which is what lets
 * those stay mounted, and Best Match unscored, as one job opens after another. */

/**
 * This order's first page. Best Match with an empty bank (the API's 404) is the
 * plain feed; BankPrompt above it already asks the student to fill the bank.
 */
async function firstPage(filters: FeedFilters, sort: Sort) {
  if (sort === "match") {
    const page = await getRecommendedPage(filtersQuery(filters), 0);
    if (page) return { page, query: listQuery("match", filters), plain: false };
  }
  return { page: await getJobListings(filters), query: filtersQuery(filters), plain: true };
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
  const [{ page, query, plain }, byJob, tailoredIds, canMarkApplied] = await Promise.all([
    firstPage(filters, sort),
    stages,
    tailored,
    applicant,
  ]);
  return (
    <Results
      page={page}
      filters={filters}
      query={query}
      retryHref={sortHref(sort, filters)}
      stages={byJob}
      tailored={tailoredIds}
      canMarkApplied={canMarkApplied}
      plain={plain}
    />
  );
}

/**
 * The split view's side of the page (KAN-519): this list's first job, or the
 * state that stands in for it, with the list handed to the frame's rail. The
 * rail is the whole list below `@4xl/main`, so the job shows only from there.
 */
async function SplitFeed({
  filters,
  sort,
  stages,
}: {
  filters: FeedFilters;
  sort: Sort;
  stages: Promise<Record<string, ApplicationStage>>;
}) {
  const [{ page, query, plain }, byJob] = await Promise.all([firstPage(filters, sort), stages]);
  const { more, error } = page;
  const jobs = page.jobs ?? [];
  const first = jobs[0];
  return (
    <>
      <RememberShownList
        query={query}
        source={plain ? "feed" : "recommended"}
        jobs={jobs}
        more={more}
        stages={byJob}
        drawnAt={drawnAt()}
      />
      {first ? (
        <div className="hidden @4xl/main:contents">
          <Suspense fallback={<JobLoading />}>
            <JobPage jobId={first.id} listed />
          </Suspense>
        </div>
      ) : (
        <div className={cn("w-full", SEEKER_GUTTER)}>
          {error != null ? (
            <ListingsError error={error} retryHref={sortHref(sort, filters)} />
          ) : (
            <NoRoles filters={filters} />
          )}
        </div>
      )}
    </>
  );
}

/** What a list shows with no roles to show. */
function NoRoles({ filters }: { filters: FeedFilters }) {
  return isFiltered(filters) ? (
    <EmptyState Icon={BriefcaseIcon} title="No Roles Match These Filters" className="mt-4">
      Nothing in the feed fits every filter you picked. Loosen one, or clear them all.
    </EmptyState>
  ) : (
    <EmptyState Icon={BriefcaseIcon} title="No Roles Yet" className="mt-4">
      New internship and new-grad roles land here as companies post them. Check back tomorrow
      morning.
    </EmptyState>
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

  if (jobs.length === 0) return <NoRoles filters={filters} />;

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
        drawnAt={drawnAt()}
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
  // Dated before the stages are read (./listings, drawnAt).
  drawnAt();
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
  const shown = canonical ? queryParams(canonical.slice("/jobs".length)) : params;
  const sort = readSort(shown);
  const filters = readFilters(shown);
  const view = await getJobsView();

  if (view === "split") {
    return (
      <>
        {canonical && <CanonicalUrl href={canonical} />}
        <RememberFeed />
        <div className={cn("pt-4 empty:hidden", SEEKER_GUTTER)}>
          <Suspense fallback={null}>
            <BankPrompt />
          </Suspense>
        </div>
        <Suspense
          key={listQuery(sort, filters)}
          fallback={
            <div className="hidden @4xl/main:contents">
              <JobLoading />
            </div>
          }
        >
          <SplitFeed filters={filters} sort={sort} stages={stages} />
        </Suspense>
      </>
    );
  }

  return (
    <div className={cn("max-w-dashboard mx-auto w-full flex-1 py-6", SEEKER_GUTTER)}>
      {canonical && <CanonicalUrl href={canonical} />}
      {/* So a job's page can go back to this list, filters and all. */}
      <RememberFeed />
      {/* One transition for a filter change, so the feed dims the moment the
          row starts it (./feed-transition). */}
      <FeedTransition>
        {/* The search and filters stay put while the list scrolls. */}
        <FeedHeader top={<JobsTopRow view={view} />}>
          <JobFilters locations={locations} facets={facets} filters={filters} sort={sort} />
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
                query={listQuery(sort, filters)}
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
