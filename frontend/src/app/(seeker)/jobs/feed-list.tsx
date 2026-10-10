"use client";

import { useEffect, useRef, useState, useTransition } from "react";

import { Button } from "@/components/ui/button";

import { loadMoreJobs } from "./actions";
import { PAGE_SIZE } from "./filter-query";
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
 * The page's Suspense boundary is keyed by its filters, so changing one
 * remounts this list at its first page. The loaded pages live only here: a
 * reload, or Back from a job's page, starts at the first page again.
 *
 * A role already on the list is not added twice. Pages are counted by offset,
 * so an import landing between two loads can shift one role into the next
 * page, and it would otherwise show twice.
 *
 * After a load, focus moves to the first new role's title, where the button
 * was, so a keyboard carries on reading down the list instead of starting
 * over at the top when the button leaves. A live region says how many came.
 */
export function FeedList({
  initial,
  more: initialMore,
  query,
}: {
  initial: JobListing[];
  more: boolean;
  query: string;
}) {
  const [loaded, setLoaded] = useState<JobListing[]>([]);
  // How many roles the API has handed over, the next page's offset. Counted
  // before dropping repeats, so a repeat doesn't shift the next page back.
  const [offset, setOffset] = useState(initial.length);
  const [more, setMore] = useState(initialMore);
  const [error, setError] = useState<string | null>(null);
  const [said, setSaid] = useState("");
  const [pending, start] = useTransition();
  // The first role of the last page loaded, to move focus to.
  const [focusId, setFocusId] = useState<string | null>(null);
  const list = useRef<HTMLUListElement>(null);

  useEffect(() => {
    if (!focusId) return;
    list.current
      ?.querySelector<HTMLAnchorElement>(`[data-job-id="${CSS.escape(focusId)}"] h3 a`)
      ?.focus();
  }, [focusId]);

  function loadMore() {
    start(async () => {
      const page = await loadMoreJobs(query, offset);
      if (page.error != null) {
        setError("Couldn't load more roles. Try again in a moment.");
        return;
      }
      const shown = new Set([...initial, ...loaded].map((job) => job.id));
      const fresh = page.jobs.filter((job) => !shown.has(job.id));
      setError(null);
      setLoaded((prev) => [...prev, ...fresh]);
      setOffset((prev) => prev + page.jobs.length);
      setMore(page.more);
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
        {initial.map((job, i) => (
          // The cards rise in as the feed arrives, 50ms apart and capped at
          // the sixth, about a screenful, so the list never makes anyone wait.
          <li
            key={job.id}
            data-job-id={job.id}
            style={{ animationDelay: `${Math.min(i, 6) * 50}ms` }}
            className="animate-rise"
          >
            <ListingCard job={job} />
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
            <ListingCard job={job} />
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
