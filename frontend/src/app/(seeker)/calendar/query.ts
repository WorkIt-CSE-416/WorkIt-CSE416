/**
 * What the Calendar is showing, read from its URL: the view, the day it is
 * anchored on, and the application open in the detail panel.
 *
 * `date` is a bare "YYYY-MM-DD" day, never an instant, so it means the same
 * day to the server and the browser. Left out, the Calendar opens on the
 * viewer's today, which only the browser knows; that is why the views
 * themselves render on the client (./calendar-view.tsx).
 *
 * Every other page links in through `calendarHref`: a card's next step opens
 * its week, an Up Next row its day in the Agenda.
 */
export const CALENDAR_VIEWS = ["month", "week", "agenda"] as const;
export type CalendarView = (typeof CALENDAR_VIEWS)[number];
export const DEFAULT_CALENDAR_VIEW: CalendarView = "month";

export const VIEW_LABEL: Record<CalendarView, string> = {
  month: "Month",
  week: "Week",
  agenda: "Agenda",
};

export type CalendarQuery = {
  view: CalendarView;
  /** The day the view is anchored on, or null for the viewer's today. */
  date: string | null;
  app: string | null;
};

type SearchParams = Record<string, string | string[] | undefined>;

function first(raw: string | string[] | undefined) {
  return Array.isArray(raw) ? raw[0] : raw;
}

/** A real calendar day as "YYYY-MM-DD", or null. Round-tripped through a
 *  Date so "2026-02-31" is refused rather than rolled into March. */
function parseDay(raw: string | undefined) {
  if (!raw || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const [year, month, day] = raw.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).toISOString().slice(0, 10) === raw ? raw : null;
}

export function parseCalendarQuery(params: SearchParams): CalendarQuery {
  const view = first(params.view);

  return {
    view: CALENDAR_VIEWS.includes(view as CalendarView)
      ? (view as CalendarView)
      : DEFAULT_CALENDAR_VIEW,
    date: parseDay(first(params.date)),
    app: first(params.app) || null,
  };
}

/** The Calendar's URL for these choices, leaving the defaults out. */
export function calendarHref({ view, date, app }: Partial<CalendarQuery> = {}) {
  const params = new URLSearchParams();
  if (view && view !== DEFAULT_CALENDAR_VIEW) params.set("view", view);
  if (date) params.set("date", date);
  if (app) params.set("app", app);

  const search = params.toString();
  return search ? `/calendar?${search}` : "/calendar";
}
