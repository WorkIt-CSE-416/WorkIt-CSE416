/**
 * The next page of a list of roles, for every reader that pages one: the
 * feed's Load More (./feed-list) and the job page's rail (./jobs-rail.tsx),
 * its own Load More and its first page. One place picks the server action
 * for the list's order and counts the offset, so the two lists page alike.
 */

import { loadMoreJobs, loadMoreRecommended } from "./actions";
import type { JobListing } from "./listings";

/** How long a kept list's roles are trusted: roles close, so after this
 *  a list is fetched again rather than shown with closed roles in it. The
 *  feed's kept Load More pages (./feed-pages) and the rail's list
 *  (./shown-list) both age by it. */
export const LIST_FRESH_FOR = 30 * 60 * 1000;

/** Which order drew a list: the plain feed, or Best Match's scored jobs. */
export type ListSource = "feed" | "recommended";

/**
 * The page after the `offset` roles a list has had from the API, with the
 * roles it already shows (`jobs`) dropped: pages are counted by offset, so
 * an import landing between two loads can shift a role into the next page.
 * `offset` comes back moved on by the whole page, repeats included, so a
 * repeat doesn't shift the next page back. A failed page answers the
 * action's error and leaves the list as it was.
 */
export async function nextPage({
  query,
  source,
  jobs,
  offset,
}: {
  query: string;
  source: ListSource;
  jobs: JobListing[];
  offset: number;
}) {
  const load = source === "recommended" ? loadMoreRecommended : loadMoreJobs;
  const page = await load(query, offset);
  if (page.error != null) return { error: page.error } as const;
  const shown = new Set(jobs.map((job) => job.id));
  return {
    error: null,
    fresh: page.jobs.filter((job) => !shown.has(job.id)),
    offset: offset + page.jobs.length,
    more: page.more,
  } as const;
}
