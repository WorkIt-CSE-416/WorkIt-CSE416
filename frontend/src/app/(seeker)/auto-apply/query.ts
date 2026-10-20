/**
 * What Live Activity is showing, read from the Auto Apply page's URL
 * (KAN-285): the statuses it is filtered to and its sort. Kept in the query
 * string, as the Applications page keeps its choices (applications/query.ts),
 * so a reload, Back and a shared link land on the same view.
 *
 * Unlike the Applications page, nothing here goes back to the server: the
 * page draws every application once, and the table filters and sorts the
 * rows it holds. So both move the URL in place (shallow routing); a status
 * pick replaces the entry, as the Applications page's picks do, so ten ticks
 * are not ten steps of Back, and a sort heading adds one.
 */

/** The Status filter's options: the statuses in groups, in the order a job
 *  moves through them. */
export const STATUS_FILTERS = ["queued", "progress", "needs_you", "applied", "skipped"] as const;
export type StatusFilter = (typeof STATUS_FILTERS)[number];

/** The table's orders, each one way, the way its column is read: the queue
 *  (oldest added first, the job the extension opens next at the top), the
 *  company A to Z, what needs the seeker first, the best match first, the
 *  latest application first. */
export const SORTS = ["queue", "company", "status", "match", "applied"] as const;
export type Sort = (typeof SORTS)[number];
export const DEFAULT_SORT: Sort = "queue";

export type ActivityQuery = {
  /** Empty shows every status. */
  statuses: StatusFilter[];
  sort: Sort;
};

/** Anything unrecognised falls back to the default rather than erroring: a
 *  hand-edited URL still shows the page. */
export function parseActivityQuery(params: URLSearchParams): ActivityQuery {
  const picked = new Set((params.get("status") ?? "").split(","));
  const sort = params.get("sort");
  return {
    statuses: STATUS_FILTERS.filter((status) => picked.has(status)),
    sort: SORTS.includes(sort as Sort) ? (sort as Sort) : DEFAULT_SORT,
  };
}

/** The page's URL for `query` with `patch` applied. Defaults stay out of it,
 *  so the plain page is still `/auto-apply`; the status list keeps its commas
 *  readable, as ?stage= does on Applications. */
export function activityHref(query: ActivityQuery, patch: Partial<ActivityQuery> = {}) {
  const next = { ...query, ...patch };
  const params = new URLSearchParams();
  if (next.statuses.length > 0) params.set("status", next.statuses.join(","));
  if (next.sort !== DEFAULT_SORT) params.set("sort", next.sort);
  const search = params.toString().replaceAll("%2C", ",");
  return search ? `/auto-apply?${search}` : "/auto-apply";
}
