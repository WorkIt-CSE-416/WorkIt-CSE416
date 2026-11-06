"use client";

import { usePathname, useSearchParams } from "next/navigation";
import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  useTransition,
  type ReactNode,
} from "react";

import { Skeleton } from "@/components/shadcn/skeleton";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/cn";

import { loadStages } from "./actions";
import { CompactJobCard } from "./compact-job-card";
import { FeedHeader } from "./feed-header";
import { keep } from "./feed-pages";
import { FeedTransition, PendingFeed } from "./feed-transition";
import {
  filtersQuery,
  listQuery,
  queryParams,
  readFilters,
  readSort,
  sortHref,
  type FeedFilters,
  type Sort,
} from "./filter-query";
import { JobFilters } from "./filters";
import { JobsTopRow } from "./jobs-top-row";
import { nextPage } from "./list-pages";
import type { JobFacets, JobLocationOption } from "./listings";
import { leavesFeed, onFeed } from "./feed-stages";
import { isFresh, readShownList, rememberList, subscribe, type ShownList } from "./shown-list";

/** A job posting's own page, /jobs/<id>; not its Tailor page under it. */
const JOB_PAGE = /^\/jobs\/([^/]+)$/;

/** The filter row's options, which the layout starts in the split view. */
type FilterOptions = {
  locations: Promise<JobLocationOption[]>;
  facets: Promise<JobFacets>;
};

/**
 * The jobs layout's frame (./layout.tsx, KAN-297): on a job posting's page,
 * the rail of jobs on the left and the page beside it, as Cooper's job board
 * does; on Tailor, the page alone. The rail lives in the layout, above the
 * job's own segment, so it stays mounted, scrolled where it was, as the seeker
 * opens one job after another from it. Beside it the job takes all the room
 * left, and About the Role keeps its own measure.
 *
 * THE SPLIT VIEW IS THIS FRAME TOO (`filterOptions`, KAN-519), on /jobs and on
 * a job's page: the Jobs page's header over the rail and the job, each pane
 * scrolling on its own under it, held to the height under the shell's 64px bar.
 * /jobs draws only the list's first job (./page.tsx) and a click opens that
 * job's page, so a job is one read of its own: the list and its Best Match
 * scores are never read again, and the rail never moves. A list from /search
 * keeps the plain frame, since the Jobs page's header is not its header.
 *
 * Below `@4xl/main` the frame flows with the page, so the header sticks as it
 * does on the cards: on /jobs the rail is the whole width, the job does not
 * show (./page.tsx), and a job's page is the job alone with Back.
 */
export function JobsRailFrame({
  filterOptions,
  children,
}: {
  filterOptions?: FilterOptions;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const params = useSearchParams();
  const list = useSyncExternalStore(subscribe, readShownList, () => null);
  const jobId = JOB_PAGE.exec(pathname)?.[1];
  const onList = pathname === "/jobs";
  const searched = list != null && new URLSearchParams(list.query).has("q");
  const split = filterOptions != null && (onList || (jobId != null && !searched));

  const pane = useRef<HTMLDivElement>(null);
  // The pane stays mounted, so each job would open scrolled as far as the last.
  useEffect(() => {
    pane.current?.scrollTo(0, 0);
  }, [pathname]);

  if (!jobId && !split) return children;

  // What the header shows: the address on /jobs, the list's own beside a job.
  const shown = queryParams(onList ? params.toString() : (list?.query ?? ""));
  const sort = onList || list?.source !== "feed" ? readSort(shown) : "newest";
  const filters = readFilters(shown);

  return (
    <FeedTransition>
      <div
        data-split={split || undefined}
        className={cn(
          "flex flex-1 flex-col",
          split && "@4xl/main:h-[calc(100svh-4rem)] @4xl/main:flex-none @4xl/main:overflow-hidden",
        )}
      >
        {split && filterOptions && (
          <FeedHeader
            flush
            top={<JobsTopRow view="split" />}
            className={cn("@4xl/main:shrink-0", !onList && "hidden @4xl/main:block")}
          >
            <JobFilters
              locations={filterOptions.locations}
              facets={filterOptions.facets}
              filters={filters}
              sort={sort}
              list={
                onList
                  ? undefined
                  : { path: "/jobs", query: sortHref(sort, filters).slice("/jobs".length) }
              }
            />
          </FeedHeader>
        )}
        {/* The split view from @4xl/main is one rounded panel, in the page's
            gutters, after Simplify's: the list and the job share its edge, and
            nothing but the panel divides the filters from them. It runs off the
            foot of the window, open, so the two columns get every pixel. */}
        <PendingFeed
          className={cn(
            "flex min-h-0 flex-1 flex-col @4xl/main:flex-row",
            split &&
              "@4xl/main:bg-panel @4xl/main:border-border-control @4xl/main:rounded-t-card @4xl/main:mx-6 @4xl/main:overflow-hidden @4xl/main:border @4xl/main:border-b-0 lg:@4xl/main:mx-8",
          )}
        >
          <JobsRail
            list={list}
            currentId={jobId ? decodeURIComponent(jobId) : undefined}
            split={split}
            onList={onList}
            wanted={onList ? { sort, filters } : undefined}
          />
          <div
            ref={pane}
            data-job-scroller={split || undefined}
            className={cn(
              "flex min-w-0 flex-1 flex-col",
              split && "@4xl/main:min-h-0 @4xl/main:overflow-y-auto @4xl/main:overscroll-none",
            )}
          >
            {children}
          </div>
        </PendingFeed>
      </div>
    </FeedTransition>
  );
}

/**
 * The roles the seeker last saw on /jobs or /search, in that list's order
 * (./shown-list, written by ./feed-list), with the open one marked. A job
 * opened from anywhere else (Home, a shared link) shows that last
 * list too, or the newest roles when there is none; a list older than half
 * an hour is fetched again, since roles close. Load More continues the list
 * with its own query, as the list's own Load More would.
 *
 * In the split view on /jobs the page writes the list (./remember-shown-list),
 * so the rail fetches nothing there and waits, on `wanted`, for the list of the
 * address on screen, with the alternative that Best Match with an empty bank
 * draws the plain feed. The list's first job is the open one. What it loads is
 * kept with the feed's own pages (./feed-pages), so Back finds the list as long
 * as it was. A list left open on /jobs past half an hour stays shown, as the
 * cards do: the rail fetches nothing there, so hiding it left the skeleton.
 *
 * FROM @4xl/main ONLY, but for the split view on /jobs, where it is the list at
 * every width. 20rem to 26rem wide (KAN-519): the compact card needs about
 * 20rem for two lines of title, and past 26rem it only adds air. It took all the
 * room past the job's 60rem until then, up to 40rem, for the six-fact cards.
 *
 * Its own scroll. Beside a job's page it is sticky, held to the page panel's
 * height while the page scrolls beside it; 4rem is the shell's 64px bar above
 * the page ((seeker)/layout.tsx). In the split view the frame holds its height.
 */
function JobsRail({
  list,
  currentId,
  split,
  onList,
  wanted,
}: {
  list: ShownList | null;
  currentId?: string;
  split: boolean;
  onList: boolean;
  wanted?: { sort: Sort; filters: FeedFilters };
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const scroller = useRef<HTMLDivElement>(null);
  const stale = list != null && !isFresh(list);
  const showable =
    list &&
    (onList || !stale) &&
    (!wanted ||
      list.query === listQuery(wanted.sort, wanted.filters) ||
      list.query === filtersQuery(wanted.filters))
      ? list
      : null;
  const openId = currentId ?? showable?.jobs[0]?.id;
  // A job saved or applied to leaves the list as it leaves the feed
  // (KAN-217, ./feed-stages), but the job open beside it stays marked.
  const jobs = showable ? onFeed(showable.jobs, showable.stages, openId) : [];

  // No list, or a stale one: ask for its first page again (the newest
  // roles when there is none). Checked on every job opened and whenever the
  // list goes stale, not once: the rail stays mounted while its list ages,
  // and checked only on mount it sat on its skeleton for good once the list
  // passed half an hour.
  useEffect(() => {
    if (onList) return;
    const stored = readShownList();
    if (stored && isFresh(stored)) return;
    let live = true;
    const query = stored?.query ?? "";
    const source = stored?.source ?? "feed";
    void Promise.all([nextPage({ query, source, jobs: [], offset: 0 }), loadStages()]).then(
      ([page, stages]) => {
        if (!live) return;
        if (page.error != null) setError("Couldn't load the jobs list.");
        else {
          rememberList({
            query,
            source,
            jobs: page.fresh,
            offset: page.offset,
            more: page.more,
            stages,
          });
        }
      },
    );
    return () => {
      live = false;
    };
  }, [currentId, onList, stale]);

  // Brings the open job into the rail's view when it is out of it, by the
  // rail's own scroll: scrollIntoView would scroll the page panel too. Only
  // when the job changes or the list lands: on each Load More it scrolled the
  // list back up to the open job.
  const landed = showable != null;
  useEffect(() => {
    const box = scroller.current;
    const row = box?.querySelector<HTMLElement>("[data-open]");
    if (!box || !row) return;
    const top = row.offsetTop;
    if (top < box.scrollTop || top + row.offsetHeight > box.scrollTop + box.clientHeight) {
      box.scrollTop = top - box.clientHeight / 3;
    }
  }, [openId, landed]);

  function loadMore(from: ShownList) {
    start(async () => {
      // As the feed's Load More (./feed-list): every job that left since it
      // was handed over moved the rest up one, and a repeat is dropped by id.
      const gone = from.jobs.filter((job) => leavesFeed(from.stages?.[job.id])).length;
      const page = await nextPage({ ...from, offset: Math.max(0, from.offset - gone) });
      if (page.error != null) {
        setError("Couldn't load more roles. Try again in a moment.");
        return;
      }
      setError(null);
      const jobs = [...from.jobs, ...page.fresh];
      rememberList({
        query: from.query,
        source: from.source,
        jobs,
        offset: page.offset + gone,
        more: page.more,
        stages: from.stages,
      });
      keep({
        path: new URLSearchParams(from.query).has("q") ? "/search" : "/jobs",
        query: from.query,
        jobs,
        offset: page.offset + gone,
        more: page.more,
      });
    });
  }

  return (
    <aside
      aria-label="Jobs"
      className={cn(
        "shrink-0 flex-col @4xl/main:w-[clamp(20rem,30cqw,26rem)] @4xl/main:border-r",
        // In the split view's panel, the list's edge is the panel's dark edge,
        // as the job's action-bar rule it meets is (2026-11-03).
        split ? "border-border-control" : "border-border-subtle",
        // Beside a job with no panel, off the sidebar by SEEKER_GUTTER less the
        // rows' own 16px, so the logos start on the page's line.
        split
          ? "@4xl/main:min-h-0"
          : "sticky top-0 h-[calc(100svh-4rem)] self-start sm:@4xl/main:ml-2 lg:@4xl/main:ml-4",
        split && onList ? "flex" : "hidden @4xl/main:flex",
      )}
    >
      {/* In the panel, the job's action bar's height, so the heading lines up
          with the bar beside it. No rule under it: the cards below have their
          own edges, and a rule here ran on with the bar's and crossed the
          list's edge in a "+" (2026-11-03). The bar's rule stops at that edge. */}
      <div
        className={cn(
          "px-4 pt-4 pb-3",
          split &&
            "@4xl/main:flex @4xl/main:h-15 @4xl/main:shrink-0 @4xl/main:flex-col @4xl/main:justify-center @4xl/main:py-0",
        )}
      >
        {showable || error ? (
          <h2 className="text-body text-ink font-semibold">
            {showable ? listTitle(showable) : "Jobs"}
          </h2>
        ) : (
          // The title's and the count's lines, as bars over the list's own.
          <div aria-hidden="true">
            <div className="flex h-5 items-center">
              <Skeleton className="h-3.5 w-24" />
            </div>
            <div className="mt-0.5 flex h-[15px] items-center">
              <Skeleton className="h-2.5 w-14" />
            </div>
          </div>
        )}
        {showable && (
          <div className="text-meta text-ink-meta mt-0.5">
            {jobs.length} {jobs.length === 1 ? "role" : "roles"}
            {showable.more ? " loaded" : ""}
          </div>
        )}
      </div>

      <div
        ref={scroller}
        className={cn(
          // No bar here: its 8px of room left the open job's tint short of the
          // column's edge, and only a bar that takes room can be styled.
          "relative min-h-0 flex-1 [scrollbar-width:none] pb-4",
          !split || !onList
            ? "overflow-y-auto overscroll-none"
            : "@4xl/main:overflow-y-auto @4xl/main:overscroll-none",
        )}
      >
        {showable ? (
          <>
            {/* Below @4xl/main, where the split view is the list alone, the
                list is a white card as /search's is (./feed-list.tsx, KAN-558);
                its edge lines up with the title above it. From @4xl/main the
                card steps aside (`contents`), and in the split view each row
                is its own card in the panel, edged in `border-control` as the
                Cards view's are, 8px apart; the open one is edged in brand
                (2026-11-03). Rows split by a hairline alone read as unboxed
                beside the dark-edged cards and buttons. */}
            <Card padding="none" className="mx-4 overflow-hidden @4xl/main:contents">
              <ul
                className={cn(
                  !split && "divide-border-subtle border-border-subtle divide-y border-y",
                  split && [
                    "max-@4xl/main:divide-border-subtle max-@4xl/main:divide-y",
                    SPLIT_LIST,
                  ],
                )}
              >
                {jobs.map((job) => (
                  <li
                    key={job.id}
                    data-open={job.id === openId || undefined}
                    className={cn(split && SPLIT_ROW)}
                  >
                    <CompactJobCard
                      job={job}
                      stage={showable.stages?.[job.id] ?? null}
                      current={job.id === openId}
                    />
                  </li>
                ))}
              </ul>
            </Card>
            {showable.more && (
              <div className="px-4">
                <Button
                  variant="secondary"
                  size="sm"
                  className="mt-3 w-full"
                  onClick={() => loadMore(showable)}
                  disabled={pending}
                >
                  {pending ? "Loading…" : error ? "Try Again" : "Load More Jobs"}
                </Button>
              </div>
            )}
          </>
        ) : error ? null : (
          <RailSkeleton split={split} />
        )}
        {error && (
          <p role="alert" className="text-body text-danger mt-3 px-4">
            {error}
          </p>
        )}
      </div>
    </aside>
  );
}

/** The split view's list from @4xl/main: a stack of cards 8px apart in the
 *  panel, 12px in from its edges. */
const SPLIT_LIST =
  "@4xl/main:flex @4xl/main:flex-col @4xl/main:gap-2 @4xl/main:px-3 @4xl/main:pt-3";

/** One row in it: a card edged as the Cards view's are, the open job in brand. */
const SPLIT_ROW =
  "@4xl/main:bg-panel @4xl/main:rounded-card @4xl/main:border-border-control @4xl/main:data-open:border-brand @4xl/main:overflow-hidden @4xl/main:border";

/** What the list was: Best Match, a search's results, or the newest roles. */
function listTitle({ source, query }: ShownList): string {
  if (source === "recommended") return "Best Matches";
  return new URLSearchParams(query).get("q") ? "Search Results" : "Newest Jobs";
}

function RailSkeleton({ split }: { split: boolean }) {
  return (
    <ul
      aria-hidden="true"
      className={cn(
        split
          ? ["max-@4xl/main:divide-border-subtle max-@4xl/main:divide-y", SPLIT_LIST]
          : "divide-border-subtle border-border-subtle divide-y border-y",
      )}
    >
      {Array.from({ length: 6 }, (_, i) => (
        <li key={i} className={cn("flex gap-3 px-3.5 py-4", split && SPLIT_ROW)}>
          <Skeleton className="rounded-control size-10 shrink-0" />
          <span className="flex flex-1 flex-col gap-2 pt-0.5">
            <Skeleton className="h-3 w-2/5" />
            <Skeleton className="h-3.5 w-4/5" />
            <Skeleton className="h-3 w-3/5" />
            <Skeleton className="h-3 w-1/2" />
          </span>
        </li>
      ))}
    </ul>
  );
}
