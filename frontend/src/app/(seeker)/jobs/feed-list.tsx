"use client";

import { useEffect, useRef, useState, useSyncExternalStore, useTransition } from "react";

import { Button } from "@/components/ui/button";

import { loadMoreJobs, loadMoreRecommended } from "./actions";
import { keep, readKept, subscribe } from "./feed-pages";
import { PAGE_SIZE } from "./filter-query";
import type { ApplicationStage } from "../auto-apply/actions";
import { ListingCard } from "./listing-card";
import type { JobListing } from "./listings";

/**
 * The feed's cards on /jobs and /search, and its Load More (KAN-171). The
 * server draws the first page (PAGE_SIZE roles) and hands it here with
 * `more`, whether the API has anything past it; Load More asks for the next
 * page with the query the page was drawn with (`query`: its filters and
 * /search's words), and adds it below. A button, not page numbers, as the
 * team chose: a seeker scrolling a feed wants the next roles under the ones
 * they have read, not a different screen of them.
 *
 * THE LOADED PAGES OUTLIVE THE LIST ON A RETURN (./feed-pages): Back from a
 * job posting's page finds the list as long as it was, so ../scroll-memory.tsx
 * can put the seeker back where they were in it; without them the place it
 * returned to didn't exist yet. Any other arrival starts at the first page,
 * and a new filter or search does too. They expire after KEPT_FOR, since
 * roles close and an hour-old page would show them still open. The server's
 * first page is always fresh; a kept role it now holds is not shown twice.
 *
 * A role already on the list is not added twice. Pages are counted by offset,
 * so an import landing between two loads can shift one role into the next
 * page, and it would otherwise show twice.
 *
 * `source` picks what Load More asks: the plain feed, or the Best Match
 * order's scored jobs (KAN-231, KAN-288). Their `query` strings differ (the
 * page adds `sort=match`), so kept pages never cross from one to the other.
 *
 * After a load, focus moves to the first new role's title, where the button
 * was, so a keyboard carries on reading down the list instead of starting
 * over at the top when the button leaves. A live region says how many came.
 *
 * A JOB MARKED APPLIED FROM A CARD LEAVES THE LIST HERE (KAN-290 review), not
 * by a refresh: a refresh redraws only the server's first page, so a job from
 * a Load More page stayed listed. The API leaves an applied job out of every
 * later page, so everything past it moves up one: the kept offset drops by
 * one too, or the next Load More would skip a role. The offset is kept even
 * with no page loaded yet. Focus moves to the next role's title, as the card
 * and its Apply Now are gone.
 */
export function FeedList({
  initial,
  more: initialMore,
  query,
  stages,
  tailored,
  canMarkApplied,
  source = "feed",
}: {
  initial: JobListing[];
  more: boolean;
  query: string;
  /** The seeker's applications by job id, read once with the first page; a
   *  Load More page's cards look theirs up here too. */
  stages: Record<string, ApplicationStage>;
  /** The job ids the seeker has a tailored resume for, read the same way. */
  tailored: string[];
  /** An applicant account, which a card's Apply Now may ask "Did You Apply?". */
  canMarkApplied: boolean;
  source?: "feed" | "recommended";
}) {
  // The server renders the first page alone; the browser adds the kept
  // pages, if this list has any, as it hydrates.
  const stored = useSyncExternalStore(subscribe, readKept, () => null);
  const mine = stored?.query === query ? stored : null;
  // First-page roles marked applied here, gone until the server's next draw
  // leaves them out itself.
  const [applied, setApplied] = useState<ReadonlySet<string>>(new Set());
  const first = initial.filter((job) => !applied.has(job.id));
  const firstPage = new Set(initial.map((job) => job.id));
  const loaded = (mine?.jobs ?? []).filter((job) => !firstPage.has(job.id));
  // How many roles the API has handed over, the next page's offset. Counted
  // before dropping repeats, so a repeat doesn't shift the next page back.
  const offset = mine?.offset ?? initial.length;
  const more = mine ? mine.more : initialMore;
  const [error, setError] = useState<string | null>(null);
  const [said, setSaid] = useState("");
  const [pending, start] = useTransition();
  // The first role of the last page loaded, to move focus to.
  const [focusId, setFocusId] = useState<string | null>(null);
  const list = useRef<HTMLUListElement>(null);
  const tailoredIds = new Set(tailored);

  useEffect(() => {
    if (!focusId) return;
    list.current
      ?.querySelector<HTMLAnchorElement>(`[data-job-id="${CSS.escape(focusId)}"] h3 a`)
      ?.focus();
  }, [focusId]);

  function markedApplied(job: JobListing) {
    const shown = [...first, ...loaded];
    const at = shown.findIndex((other) => other.id === job.id);
    setApplied((ids) => new Set(ids).add(job.id));
    keep({
      path: window.location.pathname,
      query,
      jobs: (mine?.jobs ?? []).filter((other) => other.id !== job.id),
      offset: offset - 1,
      more,
      at: mine?.at,
    });
    setSaid(`${job.title} marked applied.`);
    setFocusId((shown[at + 1] ?? shown[at - 1])?.id ?? null);
  }

  function loadMore() {
    // The list's own page, read before the request: the seeker may have left
    // for a job posting by the time it answers (review, 2026-10-10).
    const path = window.location.pathname;
    start(async () => {
      const page = await (source === "recommended" ? loadMoreRecommended : loadMoreJobs)(
        query,
        offset,
      );
      if (page.error != null) {
        setError("Couldn't load more roles. Try again in a moment.");
        return;
      }
      const shown = new Set([...initial, ...loaded].map((job) => job.id));
      const fresh = page.jobs.filter((job) => !shown.has(job.id));
      setError(null);
      keep({
        path,
        query,
        jobs: [...loaded, ...fresh],
        offset: offset + page.jobs.length,
        more: page.more,
      });
      setSaid(
        fresh.length === 0
          ? "No more roles."
          : `${fresh.length} more ${fresh.length === 1 ? "role" : "roles"} loaded.`,
      );
      setFocusId(fresh[0]?.id ?? null);
    });
  }

  return (
    <>
      <ul ref={list} className="mt-4 flex flex-col gap-3">
        {first.map((job, i) => (
          // The cards rise in as the feed arrives, 50ms apart and capped at
          // the sixth, about a screenful, so the list never makes anyone wait.
          <li
            key={job.id}
            data-job-id={job.id}
            style={{ animationDelay: `${Math.min(i, 6) * 50}ms` }}
            className="animate-rise"
          >
            <ListingCard
              job={job}
              stage={stages[job.id] ?? null}
              tailored={tailoredIds.has(job.id)}
              canMarkApplied={canMarkApplied}
              onApplied={() => markedApplied(job)}
            />
          </li>
        ))}
        {loaded.map((job, i) => (
          // A loaded page rises in the same way, counted within its own page.
          <li
            key={job.id}
            data-job-id={job.id}
            style={{ animationDelay: `${Math.min(i % PAGE_SIZE, 6) * 50}ms` }}
            className="animate-rise"
          >
            <ListingCard
              job={job}
              stage={stages[job.id] ?? null}
              tailored={tailoredIds.has(job.id)}
              canMarkApplied={canMarkApplied}
              onApplied={() => markedApplied(job)}
            />
          </li>
        ))}
      </ul>

      <div className="mt-6 flex flex-col items-center gap-2">
        {more ? (
          <Button
            variant="secondary"
            onClick={loadMore}
            disabled={pending}
            aria-describedby={error ? "feed-list-error" : undefined}
          >
            {pending ? "Loading…" : error ? "Try Again" : "Load More Jobs"}
          </Button>
        ) : (
          loaded.length > 0 && (
            <p className="text-body text-ink-meta">That&apos;s every role that matches.</p>
          )
        )}
        {error && (
          <p id="feed-list-error" className="text-body text-danger">
            {error}
          </p>
        )}
        <p role="status" className="sr-only">
          {said}
        </p>
      </div>
    </>
  );
}
