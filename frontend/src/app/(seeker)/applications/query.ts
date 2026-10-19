import { STAGE_ORDER, type StageKey } from "../stage-colors";
import { sortKey, type Application } from "../tracker";

/**
 * What the Applications page is showing, read from its URL: the layout, the
 * stage and search filters, and the list's sort. ?app= named the application
 * open in a side panel until KAN-256; it now only redirects to that
 * application's own page.
 *
 * All of it lives in the query string rather than in component state, so it
 * survives a reload, the back button undoes it, and it can be linked to: the
 * Dashboard's Waiting opens `/applications?view=list&stage=applied`. It also leaves every view a server
 * component; the stage chips and the sort headings are links, and the
 * layout switcher moves ?view= in place (./view-switcher.tsx).
 * The cost is that reading searchParams renders the route per request, which
 * the seeker shell already does.
 */
/** The board (./board.tsx) is archived (KAN-256): its code stays, but no
 *  URL shows it, and an old ?view=board link opens the list. To bring it
 *  back, add "board" here, its option in ./view-switcher.tsx and its pane in
 *  ./page.tsx. */
export const VIEWS = ["list", "grid"] as const;
export type View = (typeof VIEWS)[number];

/** The list is the primary view (KAN-256), so a bare URL shows it. */
export const DEFAULT_VIEW: View = "list";

/** The list's orders. Each runs the way its column is read: the latest
 *  application first, the best match first. An old ?sort=next link falls back
 *  to the default (parseQuery). */
export const SORTS = ["applied", "match"] as const;
export type Sort = (typeof SORTS)[number];
export const DEFAULT_SORT: Sort = "applied";

export type ApplicationsQuery = {
  view: View;
  /** The stages to show, in STAGE_ORDER; empty shows them all. */
  stages: StageKey[];
  /** Matched against the role and the company, ignoring case. */
  q: string;
  sort: Sort;
  /** An old side-panel link's application, by id: ./page.tsx redirects it
   *  to the application's own page. */
  app: string | null;
};

type SearchParams = Record<string, string | string[] | undefined>;

function first(raw: string | string[] | undefined) {
  return Array.isArray(raw) ? raw[0] : raw;
}

/** Anything unrecognised falls back to the default rather than erroring: a
 *  hand-edited URL still shows the page. */
export function parseQuery(params: SearchParams): ApplicationsQuery {
  const view = first(params.view);
  const sort = first(params.sort);
  const stages = new Set((first(params.stage) ?? "").split(","));

  return {
    view: VIEWS.includes(view as View) ? (view as View) : DEFAULT_VIEW,
    stages: STAGE_ORDER.filter((stage) => stages.has(stage)),
    q: (first(params.q) ?? "").trim(),
    sort: SORTS.includes(sort as Sort) ? (sort as Sort) : DEFAULT_SORT,
    app: first(params.app) || null,
  };
}

/**
 * The URL for `query` with `patch` applied. Defaults stay out of it, so the
 * plain page is still `/applications`. The stage list keeps its commas
 * readable rather than encoded.
 */
export function applicationsHref(query: ApplicationsQuery, patch: Partial<ApplicationsQuery> = {}) {
  const next = { ...query, ...patch };
  const params = new URLSearchParams();

  if (next.view !== DEFAULT_VIEW) params.set("view", next.view);
  if (next.stages.length > 0) params.set("stage", next.stages.join(","));
  if (next.q) params.set("q", next.q);
  if (next.sort !== DEFAULT_SORT) params.set("sort", next.sort);
  if (next.app) params.set("app", next.app);

  const search = params.toString().replaceAll("%2C", ",");
  return search ? `/applications?${search}` : "/applications";
}

/** One application's own page (./[jobId], KAN-256), which a row or card
 *  opens. It replaced the ?app= side panel; an old ?app= link redirects
 *  there (./page.tsx). */
export function applicationHref(id: string) {
  return `/applications/${encodeURIComponent(id)}`;
}

/** The applications the filters leave: in a chosen stage (any, when none is
 *  chosen) and matching the search. */
export function filterApplications(
  apps: Application[],
  query: Pick<ApplicationsQuery, "stages" | "q">,
) {
  const q = query.q.toLowerCase();

  return apps.filter(
    (app) =>
      (query.stages.length === 0 || query.stages.includes(app.stage)) &&
      (!q || `${app.role} ${app.company}`.toLowerCase().includes(q)),
  );
}

/** The list's rows in `sort` order. What has no value to sort by (not
 *  applied yet, no match score) goes last, in the order it came in. */
export function sortApplications(apps: Application[], sort: Sort) {
  const key: Record<Sort, (app: Application) => number> = {
    applied: (app) => (app.appliedOn ? -sortKey(app.appliedOn) : Infinity),
    match: (app) => (app.match != null ? -app.match : Infinity),
  };

  return [...apps].sort((a, b) => {
    const ka = key[sort](a);
    const kb = key[sort](b);
    return ka === kb ? 0 : ka < kb ? -1 : 1;
  });
}
