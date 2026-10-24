"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  useTransition,
  type ReactNode,
} from "react";

import { CompanyLogo } from "@/components/company-logo";
import { JobFactGrid } from "@/components/job-posting-card";
import { MatchBadge } from "@/components/match-badge";
import { Skeleton } from "@/components/shadcn/skeleton";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";

import { formatPosted } from "./format";
import { nextPage } from "./list-pages";
import { listingFacts } from "./listing-card";
import { isFresh, readShownList, rememberList, subscribe, type ShownList } from "./shown-list";

/** A job posting's own page, /jobs/<id>; not its Tailor page under it. */
const JOB_PAGE = /^\/jobs\/([^/]+)$/;

/**
 * The jobs layout's frame (./layout.tsx, KAN-297): on a job posting's page,
 * the rail of jobs on the left and the page beside it, as Cooper's job board
 * does; on /jobs and Tailor, the page alone, as before. The rail lives in the
 * layout, above the job's own segment, so it stays mounted, scrolled where
 * it was, as the seeker opens one job after another from it.
 *
 * WHERE THE RAIL SHOWS, THE FRAME SPANS THE WHOLE PAGE PANEL. The page is
 * kept --panel-gain narrower than the panel and centred ((seeker)/layout.tsx,
 * "A PAGE KEEPS THE WIDTH"), so with the menu closed half the gain stood
 * empty left of the rail. The frame takes it back on both sides and the
 * rail grows by the whole gain, so the job's page keeps its width in both
 * states and only the rail's cards widen.
 *
 * Beside the rail the job's page stops at 60rem, not its own 70rem, and the
 * rail takes the room that leaves: at 70rem the description ran far wider
 * than the rail's cards.
 */
export function JobsRailFrame({ children }: { children: ReactNode }) {
  const jobId = JOB_PAGE.exec(usePathname())?.[1];
  if (!jobId) return children;
  return (
    <div className="flex flex-1 @4xl/main:mx-[calc(var(--panel-gain)/-2)]">
      <JobsRail currentId={decodeURIComponent(jobId)} />
      <div className="flex max-w-[60rem] min-w-0 flex-1 flex-col">{children}</div>
    </div>
  );
}

/**
 * The roles the seeker last saw on /jobs or /search, in that list's order
 * (./shown-list, written by ./feed-list), with the open one marked. A job
 * opened from anywhere else (the Dashboard, a shared link) shows that last
 * list too, or the newest roles when there is none; a list older than half
 * an hour is fetched again, since roles close. Load More continues the list
 * with its own query, as the list's own Load More would.
 *
 * FROM @4xl/main ONLY. It takes what the page has past the job's 60rem
 * (JobsRailFrame caps the job there beside it), between 18rem and
 * 40rem, plus what a closed menu frees (JobsRailFrame). At a 1280px window
 * that is 288px and the job keeps 683px, its action bar on one row and its
 * facts in three columns; at 320px from @5xl/main it hid on every 1280px
 * laptop. Below @4xl/main the page is as it was, with Back.
 *
 * Its own scroll, held to the page panel's height while the page scrolls
 * beside it. 6.375rem is the shell's chrome above and below the panel from
 * sm up ((seeker)/layout.tsx: 12px padding, the 64px bar, a 12px gap, 12px
 * padding and the panel's 2px of border); the rail never shows below sm.
 */
function JobsRail({ currentId }: { currentId: string }) {
  const list = useSyncExternalStore(subscribe, readShownList, () => null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const scroller = useRef<HTMLDivElement>(null);
  const showable = list && isFresh(list) ? list : null;

  // No list, or a stale one: ask for its first page again (the newest
  // roles when there is none). Checked on every job opened, not once: the
  // rail stays mounted while its list ages, and checked only on mount it
  // sat on its skeleton for good once the list passed half an hour.
  useEffect(() => {
    const stored = readShownList();
    if (stored && isFresh(stored)) return;
    let live = true;
    const query = stored?.query ?? "";
    const source = stored?.source ?? "feed";
    void nextPage({ query, source, jobs: [], offset: 0 }).then((page) => {
      if (!live) return;
      if (page.error != null) setError("Couldn't load the jobs list.");
      else rememberList({ query, source, jobs: page.fresh, offset: page.offset, more: page.more });
    });
    return () => {
      live = false;
    };
  }, [currentId]);

  // Brings the open job into the rail's view when it is out of it, by the
  // rail's own scroll: scrollIntoView would scroll the page panel too.
  const listed = showable?.jobs.length ?? 0;
  useEffect(() => {
    const box = scroller.current;
    const row = box?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!box || !row) return;
    const top = row.offsetTop;
    if (top < box.scrollTop || top + row.offsetHeight > box.scrollTop + box.clientHeight) {
      box.scrollTop = top - box.clientHeight / 3;
    }
  }, [currentId, listed]);

  function loadMore(from: ShownList) {
    start(async () => {
      const page = await nextPage(from);
      if (page.error != null) {
        setError("Couldn't load more roles. Try again in a moment.");
        return;
      }
      setError(null);
      rememberList({
        query: from.query,
        source: from.source,
        jobs: [...from.jobs, ...page.fresh],
        offset: page.offset,
        more: page.more,
      });
    });
  }

  return (
    <aside
      aria-label="Jobs"
      className="border-border-subtle sticky top-0 hidden h-[calc(100svh-6.375rem)] w-[calc(clamp(18rem,100cqw_-_60rem,40rem)_+_var(--panel-gain))] shrink-0 flex-col self-start border-r @4xl/main:flex"
    >
      <div className="px-4 pt-6 pb-3">
        <h2 className="text-label text-ink">{showable ? listTitle(showable) : "Jobs"}</h2>
        {showable && (
          <p className="text-meta text-ink-meta mt-0.5">
            {showable.jobs.length} {showable.jobs.length === 1 ? "role" : "roles"}
            {showable.more ? " loaded" : ""}
          </p>
        )}
      </div>

      <div
        ref={scroller}
        className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-4"
      >
        {showable ? (
          <>
            <ul className="flex flex-col gap-2">
              {showable.jobs.map((job) => (
                <li key={job.id}>
                  <RailRow job={job} current={job.id === currentId} />
                </li>
              ))}
            </ul>
            {showable.more && (
              <Button
                variant="secondary"
                size="sm"
                className="mt-3 w-full"
                onClick={() => loadMore(showable)}
                disabled={pending}
              >
                {pending ? "Loading…" : error ? "Try Again" : "Load More Jobs"}
              </Button>
            )}
          </>
        ) : error ? null : (
          <RailSkeleton />
        )}
        {error && (
          <p role="alert" className="text-body text-danger mt-3">
            {error}
          </p>
        )}
      </div>
    </aside>
  );
}

/** What the list was: Best Match, a search's results, or the newest roles. */
function listTitle({ source, query }: ShownList): string {
  if (source === "recommended") return "Best Matches";
  return new URLSearchParams(query).get("q") ? "Search Results" : "Newest Jobs";
}

/** One role as a rail card: who and what, when it was posted and its match,
 *  then the feed card's own six facts (location, job type, salary, work
 *  style, level, start or years) in its grid, empty slots and all
 *  (`JobFactGrid`, `listingFacts`). Two columns of facts in a narrow rail,
 *  three once the card is 448px wide, as on the feed card. */
function RailRow({ job, current }: { job: ShownList["jobs"][number]; current: boolean }) {
  return (
    <Link
      href={`/jobs/${encodeURIComponent(job.id)}`}
      aria-current={current ? "page" : undefined}
      className={cn(
        "rounded-card focus-visible:ring-brand-ring @container block border p-4 transition-colors focus-visible:ring-2 focus-visible:outline-none",
        current ? "border-brand bg-brand-tint" : "border-border-subtle hover:bg-hover",
      )}
    >
      <span className="flex items-start gap-3">
        <CompanyLogo
          name={job.company}
          src={job.logo_url}
          className="text-label rounded-control size-11 shrink-0"
        />
        <span className="min-w-0 flex-1">
          <span title={job.title} className="text-label text-ink block truncate">
            {job.title}
          </span>
          <span className="text-meta text-ink-meta mt-0.5 block truncate">
            {job.company}
            {/* The clock moves between the server render and hydration. */}
            {job.posted_at && (
              <span suppressHydrationWarning> · {formatPosted(job.posted_at)}</span>
            )}
          </span>
        </span>
        {job.match != null && <MatchBadge score={job.match} />}
      </span>
      <JobFactGrid job={listingFacts(job)} className="border-border-subtle mt-3 border-t pt-3" />
    </Link>
  );
}

function RailSkeleton() {
  return (
    <ul aria-hidden="true" className="flex flex-col gap-2">
      {Array.from({ length: 6 }, (_, i) => (
        <li key={i} className="rounded-card border-border-subtle border p-4">
          <span className="flex gap-3">
            <Skeleton className="rounded-control size-11 shrink-0" />
            <span className="flex flex-1 flex-col gap-2 pt-1">
              <Skeleton className="h-3 w-4/5" />
              <Skeleton className="h-2.5 w-3/5" />
            </span>
          </span>
          <span className="border-border-subtle mt-3 grid grid-cols-2 gap-2 border-t pt-3">
            {Array.from({ length: 4 }, (_, j) => (
              <Skeleton key={j} className="h-2.5 w-3/4" />
            ))}
          </span>
        </li>
      ))}
    </ul>
  );
}
