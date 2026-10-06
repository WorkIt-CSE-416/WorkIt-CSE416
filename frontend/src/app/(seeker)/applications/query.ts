import { STAGE_ORDER, type StageKey } from "../stage-colors";
import { nextEvent, sortKey, type Application } from "../tracker";

/**
 * What the Applications page is showing, read from its URL: the layout, the
 * stage and search filters, the list's sort, and the application open in the
 * detail panel.
 *
 * All of it lives in the query string rather than in component state, so it
 * survives a reload, the back button undoes it, and it can be linked to: the
 * Dashboard's Waiting opens `/applications?view=list&stage=applied`, and Next
 * Up opens one application's panel. It also leaves every view a server
 * component; the switcher, the stage chips and the sort headings are links.
 * The cost is that reading searchParams renders the route per request, which
 * the seeker shell already does.
 */
export const VIEWS = ["board", "grid", "list"] as const;
export type View = (typeof VIEWS)[number];

/** The board is the view KAN-43 designed first, so a bare URL still shows it. */
export const DEFAULT_VIEW: View = "board";

/** The list's orders. Each runs the way its column is read: the soonest next
 *  step first, the latest application first, the best match first. */
export const SORTS = ["next", "applied", "match"] as const;
export type Sort = (typeof SORTS)[number];
export const DEFAULT_SORT: Sort = "next";

export type ApplicationsQuery = {
  view: View;
  /** The stages to show, in STAGE_ORDER; empty shows them all. */
  stages: StageKey[];
  /** Matched against the role and the company, ignoring case. */
  q: string;
  sort: Sort;
  /** The application open in the detail panel, by id. */
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

/** The list's rows in `sort` order. What has no value to sort by (nothing
 *  scheduled, not applied yet) goes last, in the fixture's own order. */
export function sortApplications(apps: Application[], sort: Sort, now: Date) {
  const key: Record<Sort, (app: Application) => number> = {
    next: (app) => {
      const next = nextEvent(app, now);
      return next ? sortKey(next.at) : Infinity;
    },
    applied: (app) => (app.appliedOn ? -sortKey(app.appliedOn) : Infinity),
    match: (app) => -app.match,
  };

  return [...apps].sort((a, b) => {
    const ka = key[sort](a);
    const kb = key[sort](b);
    return ka === kb ? 0 : ka < kb ? -1 : 1;
  });
}
