/**
 * The three ways the same applications can be read, and the URL that selects one.
 *
 * The view lives in the query string rather than in component state so that it
 * survives a reload, can be linked to and shared, and leaves every view a
 * server component — the switcher is three links, not a client island. The one
 * cost is that reading searchParams opts this route into dynamic rendering.
 */
export const VIEWS = ["board", "grid", "list"] as const;

export type View = (typeof VIEWS)[number];

/** The board is the view KAN-43 designed first, so a bare URL still shows it. */
export const DEFAULT_VIEW: View = "board";

export function parseView(raw: string | string[] | undefined): View {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return VIEWS.includes(value as View) ? (value as View) : DEFAULT_VIEW;
}

/** The default view keeps the clean URL; the others name themselves. */
export function viewHref(view: View) {
  return view === DEFAULT_VIEW ? "/applications" : `/applications?view=${view}`;
}
