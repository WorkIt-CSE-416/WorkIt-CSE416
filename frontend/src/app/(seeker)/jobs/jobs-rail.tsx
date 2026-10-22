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
import { MatchBadge } from "@/components/match-badge";
import { Skeleton } from "@/components/shadcn/skeleton";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";

import { loadMoreJobs, loadMoreRecommended } from "./actions";
import { formatPlaces } from "./format";
import { isFresh, readShownList, rememberList, subscribe, type ShownList } from "./shown-list";

/** A job posting's own page, /jobs/<id>; not its Tailor page under it. */
const JOB_PAGE = /^\/jobs\/([^/]+)$/;

/**
 * The jobs layout's frame (./layout.tsx, KAN-297): on a job posting's page,
 * the rail of jobs on the left and the page beside it, as Cooper's job board
 * does; on /jobs and Tailor, the page alone, as before. The rail lives in the
 * layout, above the job's own segment, so it stays mounted, scrolled where
 * it was, as the seeker opens one job after another from it.
 */
export function JobsRailFrame({ children }: { children: ReactNode }) {
  const jobId = JOB_PAGE.exec(usePathname())?.[1];
  if (!jobId) return children;
  return (
    <div className="flex flex-1">
      <JobsRail currentId={decodeURIComponent(jobId)} />
      <div className="flex min-w-0 flex-1 flex-col">{children}</div>
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
 * FROM @4xl/main ONLY, 288px wide: at a 1280px window the job's page keeps
 * 683px beside it, its action bar on one row and its facts in three columns.
 * At 320px from @5xl/main it hid on every 1280px laptop. Below @4xl/main
 * the page is as it was, with Back.
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
  // roles when there is none). Once, as the rail mounts.
  useEffect(() => {
    const stored = readShownList();
    if (stored && isFresh(stored)) return;
    let live = true;
    const query = stored?.query ?? "";
    const source = stored?.source ?? "feed";
    void (source === "recommended" ? loadMoreRecommended : loadMoreJobs)(query, 0).then((page) => {
      if (!live) return;
      if (page.error != null) setError("Couldn't load the jobs list.");
      else
        rememberList({ query, source, jobs: page.jobs, offset: page.jobs.length, more: page.more });
    });
    return () => {
      live = false;
    };
  }, []);

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
      const load = from.source === "recommended" ? loadMoreRecommended : loadMoreJobs;
      const page = await load(from.query, from.offset);
      if (page.error != null) {
        setError("Couldn't load more roles. Try again in a moment.");
        return;
      }
      setError(null);
      const shown = new Set(from.jobs.map((job) => job.id));
      rememberList({
        query: from.query,
        source: from.source,
        jobs: [...from.jobs, ...page.jobs.filter((job) => !shown.has(job.id))],
        offset: from.offset + page.jobs.length,
        more: page.more,
      });
    });
  }

  return (
    <aside
      aria-label="Jobs"
      className="border-border-subtle sticky top-0 hidden h-[calc(100svh-6.375rem)] w-72 shrink-0 flex-col self-start border-r @4xl/main:flex"
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

function RailRow({ job, current }: { job: ShownList["jobs"][number]; current: boolean }) {
  const place = formatPlaces(job.location_label ?? job.location);
  return (
    <Link
      href={`/jobs/${encodeURIComponent(job.id)}`}
      aria-current={current ? "page" : undefined}
      className={cn(
        "rounded-card focus-visible:ring-brand-ring flex gap-3 border p-3 transition-colors focus-visible:ring-2 focus-visible:outline-none",
        current ? "border-brand bg-brand-tint" : "border-border-subtle hover:bg-hover",
      )}
    >
      <CompanyLogo
        name={job.company}
        src={job.logo_url}
        className="text-note rounded-control size-9 shrink-0"
      />
      <span className="min-w-0 flex-1">
        <span className="text-label text-ink block truncate">{job.title}</span>
        <span className="text-meta text-ink-meta block truncate">
          {place ? `${job.company} · ${place}` : job.company}
        </span>
        {job.match != null && (
          <span className="mt-1.5 flex">
            <MatchBadge score={job.match} />
          </span>
        )}
      </span>
    </Link>
  );
}

function RailSkeleton() {
  return (
    <ul aria-hidden="true" className="flex flex-col gap-2">
      {Array.from({ length: 6 }, (_, i) => (
        <li key={i} className="rounded-card border-border-subtle flex gap-3 border p-3">
          <Skeleton className="rounded-control size-9 shrink-0" />
          <span className="flex flex-1 flex-col gap-2 pt-1">
            <Skeleton className="h-3 w-4/5" />
            <Skeleton className="h-2.5 w-3/5" />
          </span>
        </li>
      ))}
    </ul>
  );
}
