"use client";

import {
  addDays,
  addMonths,
  addWeeks,
  endOfWeek,
  format,
  isSameMonth,
  isSameYear,
  parseISO,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import { ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";

import { cn } from "@/lib/cn";

import { useHydrated } from "../local-time";
import type { TrackerEvent } from "../tracker";
import { Agenda, AGENDA_DAYS } from "./agenda";
import { dayKey, groupByDay, KIND_LABEL, LEGEND_ORDER, lookOf } from "./entries";
import { Month } from "./month";
import { calendarHref, type CalendarView as View } from "./query";
import { Week } from "./week";

/**
 * The calendar itself, laid out after the reference the KAN-152 design took
 * from: the span's title at the top left ("October 2026"), and at the top
 * right Today with the arrows beside it as two round grey buttons, so the
 * three ways of moving through time sit together; the view under them, and
 * the legend at the foot. Open on the page rather than boxed: the page panel
 * is already white, and the day tiles carry the structure a card's edge
 * would.
 *
 * ALL OF IT RENDERS IN THE BROWSER. Which day an entry falls on depends on
 * the viewer's zone, and a bare /calendar opens on the viewer's today, and
 * the server knows neither. So the server renders a placeholder the size of a
 * month and the browser draws the real thing as it hydrates; on a client
 * navigation from another page there is no placeholder at all.
 *
 * The arrows and Today are links on ?date=, like every choice on the page,
 * so the back button steps back through them. Month moves a month at a time,
 * Week a week, Agenda two weeks; Today drops ?date=, back to the viewer's
 * own today in the view in force.
 */
export function CalendarView({
  view,
  date,
  events,
}: {
  view: View;
  /** The day in the URL, or null for the viewer's today. */
  date: string | null;
  /** Every dated entry, oldest first; the views group them by local day. */
  events: TrackerEvent[];
}) {
  const hydrated = useHydrated();

  if (!hydrated) {
    return (
      <div aria-hidden="true">
        <div className="bg-well rounded-control mt-6 h-8 w-48 animate-pulse" />
        <div className="bg-well rounded-card mt-4 h-[32rem] animate-pulse" />
      </div>
    );
  }

  return <Calendar view={view} date={date} events={events} />;
}

/**
 * The header's three controls, drawn alike so they read as one group: the
 * bar's grey circles (../bar.ts) at 32px, the arrows round and Today a pill
 * in the same fill. Today was a brand outline once, after the reference,
 * where it stood alone; beside two grey buttons it read as a different kind
 * of thing, and its violet made a step back to today look like the page's
 * main action.
 */
const CONTROL =
  "bg-app text-ink-meta hover:bg-selected hover:text-ink focus-visible:ring-brand-ring flex h-8 items-center justify-center rounded-full transition-colors focus-visible:ring-2 focus-visible:outline-none";
const ARROW = cn(CONTROL, "w-8");
const TODAY = cn(CONTROL, "text-label px-3.5 font-medium");

/** "Oct 4 – 10, 2026", "Sep 27 – Oct 3, 2026", or with both years when the
 *  span crosses one. */
function spanTitle(start: Date, end: Date) {
  if (!isSameYear(start, end)) {
    return `${format(start, "MMM d, yyyy")} – ${format(end, "MMM d, yyyy")}`;
  }
  if (!isSameMonth(start, end)) return `${format(start, "MMM d")} – ${format(end, "MMM d, yyyy")}`;
  return `${format(start, "MMM d")} – ${format(end, "d, yyyy")}`;
}

/** What each view spans from its anchor: its title, and where the arrows
 *  go. Named for the arrows' accessible names. */
function spanOf(view: View, anchor: Date) {
  if (view === "month") {
    const start = startOfMonth(anchor);
    return {
      unit: "Month",
      title: format(start, "MMMM yyyy"),
      prev: addMonths(start, -1),
      next: addMonths(start, 1),
    };
  }
  if (view === "week") {
    const start = startOfWeek(anchor);
    return {
      unit: "Week",
      title: spanTitle(start, endOfWeek(anchor)),
      prev: addWeeks(start, -1),
      next: addWeeks(start, 1),
    };
  }
  return {
    unit: "Two Weeks",
    title: spanTitle(anchor, addDays(anchor, AGENDA_DAYS - 1)),
    prev: addDays(anchor, -AGENDA_DAYS),
    next: addDays(anchor, AGENDA_DAYS),
  };
}

function Calendar({
  view,
  date,
  events,
}: {
  view: View;
  date: string | null;
  events: TrackerEvent[];
}) {
  const today = dayKey(new Date());
  const anchor = parseISO(date ?? today);
  const span = spanOf(view, anchor);
  const byDay = groupByDay(events);

  // An entry opens its application's panel over the view it was clicked in.
  const openHref = (applicationId: string) => calendarHref({ view, date, app: applicationId });
  const dayHref = (day: string) => calendarHref({ view: "agenda", date: day });

  return (
    <>
      <div className="mt-6 flex items-center justify-between gap-4">
        <h2 className="text-title text-ink">{span.title}</h2>
        <div className="flex shrink-0 items-center gap-2">
          <Link href={calendarHref({ view })} className={TODAY}>
            Today
          </Link>
          <Link
            href={calendarHref({ view, date: dayKey(span.prev) })}
            aria-label={`Previous ${span.unit}`}
            className={ARROW}
          >
            <ChevronLeft aria-hidden className="size-4" />
          </Link>
          <Link
            href={calendarHref({ view, date: dayKey(span.next) })}
            aria-label={`Next ${span.unit}`}
            className={ARROW}
          >
            <ChevronRight aria-hidden className="size-4" />
          </Link>
        </div>
      </div>

      {view === "month" && (
        <Month anchor={anchor} today={today} byDay={byDay} openHref={openHref} dayHref={dayHref} />
      )}
      {view === "week" && <Week anchor={anchor} today={today} byDay={byDay} openHref={openHref} />}
      {view === "agenda" && (
        <Agenda anchor={anchor} today={today} byDay={byDay} openHref={openHref} />
      )}

      <ul aria-label="Legend" className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-1">
        {LEGEND_ORDER.map((kind) => (
          <li key={kind} className="text-note text-ink-meta flex items-center gap-1.5">
            <span aria-hidden="true" className={cn("size-2 rounded-full", lookOf(kind).fill)} />
            {KIND_LABEL[kind]}
          </li>
        ))}
      </ul>
    </>
  );
}
