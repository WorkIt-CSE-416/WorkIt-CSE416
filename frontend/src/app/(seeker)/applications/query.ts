import { STAGE_ORDER, type StageKey } from "../stage-colors";
import type { Application } from "../tracker";

/**
 * What the Applications page is showing, read from its URL: the layout, the
 * stage, search and Filter button filters, and the list's sort. ?app= named the application
 * open in a side panel until KAN-256; it now only redirects to that
 * application's own page.
 *
 * All of it lives in the query string rather than in component state, so it
 * survives a reload, the back button undoes it, and it can be linked to: the
 * Dashboard's Waiting opens `/applications?view=list&stage=applied`. The
 * server does the filtering, so the stage chips are links and a Filter
 * button pick replaces the URL. The layout switcher and the list's sort
 * headings move ?view= and ?sort= in place (./view-switcher.tsx), since the
 * browser already holds what they show: the list sorts itself (./list.tsx).
 * The list's column layout is not here: it is a per-browser preference
 * (./column-layout.ts).
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

/** The list's orders (KAN-282 added the last three). Each runs one way, the
 *  way its column is read: the latest application first, the best match
 *  first, companies A to Z, the furthest stage first, the best pay first.
 *  An old ?sort=next link falls back to the default (parseQuery). */
export const SORTS = ["applied", "match", "company", "status", "pay"] as const;
export type Sort = (typeof SORTS)[number];
export const DEFAULT_SORT: Sort = "applied";

/** The Filter button's fields (KAN-282): the Application field each one
 *  reads, its URL parameter and its label. A field takes any number of
 *  values, as the stage chips do, and a value is the cell's own text. */
export const FILTER_FIELDS = [
  { key: "company", param: "company", label: "Company" },
  { key: "track", param: "track", label: "Track" },
  { key: "workModel", param: "work", label: "Work Model" },
  { key: "source", param: "source", label: "Source" },
] as const;
export type FilterKey = (typeof FILTER_FIELDS)[number]["key"];
export type Filters = Record<FilterKey, string[]>;

export const NO_FILTERS: Filters = { company: [], track: [], workModel: [], source: [] };

export type ApplicationsQuery = {
  view: View;
  /** The stages to show, in STAGE_ORDER; empty shows them all. */
  stages: StageKey[];
  /** Matched against the role and the company, ignoring case. */
  q: string;
  sort: Sort;
  /** The Filter button's picks; an empty field filters nothing. */
  filters: Filters;
  /** An old side-panel link's application, by id: ./page.tsx redirects it
   *  to the application's own page. */
  app: string | null;
};

type SearchParams = Record<string, string | string[] | undefined>;

function first(raw: string | string[] | undefined) {
  return Array.isArray(raw) ? raw[0] : raw;
}

/** Every value of a repeated parameter (?company=A&company=B): a company's
 *  name can hold a comma, so these are not comma lists like ?stage=. */
function all(raw: string | string[] | undefined) {
  const values = (Array.isArray(raw) ? raw : raw == null ? [] : [raw]).map((v) => v.trim());
  return [...new Set(values.filter(Boolean))];
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
    filters: Object.fromEntries(
      FILTER_FIELDS.map(({ key, param }) => [key, all(params[param])]),
    ) as Filters,
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
  for (const { key, param } of FILTER_FIELDS) {
    for (const value of next.filters[key]) params.append(param, value);
  }
  if (next.sort !== DEFAULT_SORT) params.set("sort", next.sort);
  if (next.app) params.set("app", next.app);

  const search = params.toString().replaceAll("%2C", ",");
  return search ? `/applications?${search}` : "/applications";
}

/** How many of the Filter button's values are picked, across its fields. */
export function filterCount(filters: Filters) {
  return FILTER_FIELDS.reduce((count, { key }) => count + filters[key].length, 0);
}

/** One application's own page (./[jobId], KAN-256), which a row or card
 *  opens. It replaced the ?app= side panel; an old ?app= link redirects
 *  there (./page.tsx). */
export function applicationHref(id: string) {
  return `/applications/${encodeURIComponent(id)}`;
}

/** The applications the filters leave: in a chosen stage (any, when none is
 *  chosen), matching the search, and holding one of each Filter button
 *  field's picks. */
export function filterApplications(
  apps: Application[],
  query: Pick<ApplicationsQuery, "stages" | "q" | "filters">,
) {
  const q = query.q.toLowerCase();

  return apps.filter(
    (app) =>
      (query.stages.length === 0 || query.stages.includes(app.stage)) &&
      (!q || `${app.role} ${app.company}`.toLowerCase().includes(q)) &&
      FILTER_FIELDS.every(({ key }) => {
        const picked = query.filters[key];
        return picked.length === 0 || picked.includes(app[key] ?? "");
      }),
  );
}

/** The values each Filter button field can pick: every value the tracked
 *  applications hold, A to Z, and any value the URL picks that none holds
 *  any more, so it can still be unticked. */
export function filterOptions(apps: Application[], filters: Filters): Filters {
  return Object.fromEntries(
    FILTER_FIELDS.map(({ key }) => {
      const values = new Set([...apps.map((app) => app[key] ?? ""), ...filters[key]]);
      values.delete("");
      return [key, [...values].sort((a, b) => a.localeCompare(b))];
    }),
  ) as Filters;
}
