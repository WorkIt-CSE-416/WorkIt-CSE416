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
import { ViewTransition, type ReactNode } from "react";

import { ShallowLink } from "@/components/shallow-routing";
import { cn } from "@/lib/cn";

import { useHydrated } from "../local-time";
import type { TrackerEvent } from "../tracker";
import { Agenda, AGENDA_DAYS } from "./agenda";
import { dayKey, groupByDay, KIND_LABEL, LEGEND_ORDER, lookOf } from "./entries";
import { Month } from "./month";
import { calendarHref, type CalendarView as View } from "./query";
import { useCalendarQuery } from "./view-switch";
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
 *
 * THE VIEW AND THE DAY ARE READ FROM THE URL HERE (./view-switch.tsx), not
 * handed down by the page, and every link that only changes them moves the
 * URL in place (ShallowLink). The views are drawn from entries the browser
 * already holds, so a step or a new view redraws at once; through the
 * server, it waited on a round trip after the click. An entry still
 * navigates for real: its detail panel is drawn on the server.
 *
 * THE SPAN SLIDES THE WAY TIME WENT. The title and the view are each keyed
 * by the span on screen (`Step`), so moving to another span is an exit and an
 * enter rather than an update in place. The arrows tag their move
 * nav-back or nav-forward, and Today whichever way today is, so the old span
 * leaves to one side and the new one arrives from the other (step-back and
 * step-forward in globals.css). A change with no direction, a new view or
 * the browser's own back button, crossfades instead. The controls are
 * outside the keys, so they hold still while the span moves under them.
 */
export function CalendarView({
  events,
}: {
  /** Every dated entry, oldest first; the views group them by local day. */
  events: TrackerEvent[];
}) {
  const hydrated = useHydrated();
  const { view, date } = useCalendarQuery();

  if (!hydrated) {
    return (
      <div aria-hidden="true">
        <div className="bg-well rounded-control mt-6 h-8 w-48 animate-pulse" />
        <div className="bg-well rounded-card mt-4 h-[32rem] animate-pulse" />
      </div>
    );
  }

  // The real thing fades in over the placeholder's spot rather than cutting
  // to it.
  return (
    <div className="animate-fade">
      <Calendar view={view} date={date} events={events} />
    </div>
  );
}

/**
 * The header's three controls, drawn alike so they read as one group: the
 * bar's grey circles (../bar.ts) at 32px, the arrows round and Today a pill
 * in the same fill. Today was a brand outline once, after the reference,
 * where it stood alone; beside two grey buttons it read as a different kind
 * of thing, and its violet made a step back to today look like the page's
 * main action.
 *
 * Each presses in on the click, and an arrow's chevron leans the way it
 * goes while hovered, so the arrow says where it will take you before it
 * does.
 */
const CONTROL =
  "bg-app text-ink-meta hover:bg-selected hover:text-ink focus-visible:ring-brand-ring flex h-8 items-center justify-center rounded-full transition-[color,background-color,transform] duration-150 ease-out focus-visible:ring-2 focus-visible:outline-none";
const ARROW = cn(
  CONTROL,
  "w-8 active:scale-90 [&>svg]:transition-transform [&>svg]:duration-200 [&>svg]:ease-glide",
);
const TODAY = cn(CONTROL, "text-label px-3.5 font-medium active:scale-95");

/** The span on screen, keyed by its caller on the view and the span's first
 *  day: a new key exits the old span and enters the new one, sliding when
 *  the navigation says which way and crossfading when it does not. */
function Step({ children }: { children: ReactNode }) {
  return (
    <ViewTransition
      enter={{ "nav-forward": "step-forward", "nav-back": "step-back", default: "swap-enter" }}
      exit={{ "nav-forward": "step-forward", "nav-back": "step-back", default: "swap-exit" }}
      default="none"
    >
      {children}
    </ViewTransition>
  );
}

/** "Oct 4 – 10, 2026", "Sep 27 – Oct 3, 2026", or with both years when the
 *  span crosses one. */
function spanTitle(start: Date, end: Date) {
  if (!isSameYear(start, end)) {
    return `${format(start, "MMM d, yyyy")} – ${format(end, "MMM d, yyyy")}`;
  }
  if (!isSameMonth(start, end)) return `${format(start, "MMM d")} – ${format(end, "MMM d, yyyy")}`;
  return `${format(start, "MMM d")} – ${format(end, "d, yyyy")}`;
}

/** What each view spans from its anchor: its first day, its title, and
 *  where the arrows go. `unit` names the arrows for a screen reader. */
function spanOf(view: View, anchor: Date) {
  if (view === "month") {
    const start = startOfMonth(anchor);
    return {
      start,
      unit: "Month",
      title: format(start, "MMMM yyyy"),
      prev: addMonths(start, -1),
      next: addMonths(start, 1),
    };
  }
  if (view === "week") {
    const start = startOfWeek(anchor);
    return {
      start,
      unit: "Week",
      title: spanTitle(start, endOfWeek(anchor)),
      prev: addWeeks(start, -1),
      next: addWeeks(start, 1),
    };
  }
  return {
    start: anchor,
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

  // Which span this is, for Step's key, and which way Today goes from it.
  const first = dayKey(span.start);
  const home = dayKey(spanOf(view, parseISO(today)).start);
  const towardToday = home < first ? "nav-back" : home > first ? "nav-forward" : undefined;

  // An entry opens its application's panel over the view it was clicked in.
  const openHref = (applicationId: string) => calendarHref({ view, date, app: applicationId });
  const dayHref = (day: string) => calendarHref({ view: "agenda", date: day });

  return (
    <>
      <div className="mt-6 flex items-center justify-between gap-4">
        <Step key={`${view}:${first}`}>
          <h2 className="text-title text-ink">{span.title}</h2>
        </Step>
        <div className="flex shrink-0 items-center gap-2">
          <ShallowLink href={calendarHref({ view })} transitionType={towardToday} className={TODAY}>
            Today
          </ShallowLink>
          <ShallowLink
            href={calendarHref({ view, date: dayKey(span.prev) })}
            transitionType="nav-back"
            aria-label={`Previous ${span.unit}`}
            className={cn(ARROW, "hover:[&>svg]:-translate-x-0.5")}
          >
            <ChevronLeft aria-hidden className="size-4" />
          </ShallowLink>
          <ShallowLink
            href={calendarHref({ view, date: dayKey(span.next) })}
            transitionType="nav-forward"
            aria-label={`Next ${span.unit}`}
            className={cn(ARROW, "hover:[&>svg]:translate-x-0.5")}
          >
            <ChevronRight aria-hidden className="size-4" />
          </ShallowLink>
        </div>
      </div>

      <Step key={`${view}:${first}`}>
        {view === "month" && (
          <Month
            anchor={anchor}
            today={today}
            byDay={byDay}
            openHref={openHref}
            dayHref={dayHref}
          />
        )}
        {view === "week" && (
          <Week anchor={anchor} today={today} byDay={byDay} openHref={openHref} />
        )}
        {view === "agenda" && (
          <Agenda anchor={anchor} today={today} byDay={byDay} openHref={openHref} />
        )}
      </Step>

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
