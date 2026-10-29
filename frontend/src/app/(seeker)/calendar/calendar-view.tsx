"use client";

import {
  addDays,
  addMonths,
  addWeeks,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameMonth,
  isSameYear,
  parseISO,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import { CaretLeftIcon, CaretRightIcon } from "@phosphor-icons/react/ssr";
import { useState, ViewTransition, type ReactNode } from "react";

import { FieldFacet, type FacetOption } from "@/components/field-facet";
import { CloseIcon } from "@/components/icons";
import { ShallowLink } from "@/components/shallow-routing";
import { IconButton } from "@/components/ui/icon-button";
import { cn } from "@/lib/cn";

import { CreateEventDialog, type EventTarget } from "../applications/create-event";
import { StatusIcon } from "../applications/icons";

import { useHydrated } from "../local-time";
import { localDay, type EventKind, type TrackerEvent } from "../tracker";
import { Agenda, AGENDA_DAYS } from "./agenda";
import { dayKey, groupByDay, KIND_LABEL, KIND_ORDER, lookOf, onCalendar } from "./entries";
import { Month } from "./month";
import { calendarHref, type CalendarView as View } from "./query";
import { TimeGrid } from "./time-grid";
import { CalendarViewSwitch, useCalendarQuery } from "./view-switch";

/**
 * The calendar itself (KAN-429): ONE TOOLBAR, the span's title at the left
 * ("October 2026") and at the right Today, the arrows, Month / Week /
 * Agenda and Create Event, with THE TYPE FILTER beside the title: a dropdown, as every page
 * with filters draws one (components/field-facet.tsx), each kind in its
 * glyph and colour with how many fall in the span; then the view, the full
 * width of the page. An Upcoming list beside it was tried and taken out
 * (KAN-429): the grid itself says what is next. The colour key
 * was a row of tiny dots under the grid, far from what it named, then for a
 * draft a row of chips, which broke the filter pattern; the view switch sat
 * apart in the page's header. The picked kinds are this visit's own state,
 * kept while the span or the view changes.
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
 * server, it waited on a round trip after the click. An entry opens its
 * event card in place; the card's View Application navigates for real,
 * since the detail panel is drawn on the server.
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
  applications,
  events,
}: {
  /** The applications Create Event can put an event on. */
  applications: EventTarget[];
  /** Every dated entry, oldest first; the views group them by local day. */
  events: TrackerEvent[];
}) {
  const hydrated = useHydrated();
  const { view, date, demo } = useCalendarQuery();

  if (!hydrated) {
    return (
      <div aria-hidden="true" className="flex min-h-0 flex-1 flex-col">
        <div className="bg-well rounded-control h-9 w-48 animate-pulse" />
        <div className="bg-well rounded-card mt-4 flex-1 animate-pulse" />
      </div>
    );
  }

  // The real thing fades in over the placeholder's spot rather than cutting
  // to it.
  return (
    <div className="animate-fade flex min-h-0 flex-1 flex-col">
      <Calendar view={view} date={date} demo={demo} applications={applications} events={events} />
    </div>
  );
}

/**
 * The header's three controls, drawn alike so they read as one group: the
 * bar's grey circles (../bar.ts) at 36px, an sm button's height (KAN-251), the arrows round and Today a pill
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
  "bg-app text-ink-meta hover:bg-selected hover:text-ink focus-visible:ring-brand-ring flex h-9 items-center justify-center rounded-full transition-[color,background-color,transform] duration-150 ease-out focus-visible:ring-2 focus-visible:outline-none";
const ARROW = cn(
  CONTROL,
  "w-9 active:scale-90 [&>svg]:transition-transform [&>svg]:duration-200 [&>svg]:ease-glide",
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

/** The first and last day each view draws, for the filter row's counts. */
function rangeOf(view: View, anchor: Date) {
  if (view === "month") {
    return { from: startOfWeek(startOfMonth(anchor)), to: endOfWeek(endOfMonth(anchor)) };
  }
  if (view === "week") return { from: startOfWeek(anchor), to: endOfWeek(anchor) };
  return { from: anchor, to: addDays(anchor, AGENDA_DAYS - 1) };
}

function Calendar({
  view,
  date,
  demo,
  applications,
  events,
}: {
  view: View;
  date: string | null;
  /** The sample week is on (./demo.ts): every link keeps it. */
  demo: boolean;
  applications: EventTarget[];
  events: TrackerEvent[];
}) {
  // The kinds the filter picked; none picked shows every kind, as every
  // filter dropdown reads (components/field-facet.tsx).
  const [kinds, setKinds] = useState<EventKind[]>([]);
  const today = dayKey(new Date());
  const anchor = parseISO(date ?? today);
  const span = spanOf(view, anchor);
  const listed = events.filter(onCalendar);
  const shown = kinds.length ? listed.filter((event) => kinds.includes(event.kind)) : listed;
  const byDay = groupByDay(shown);

  // How many of each kind fall in the span on screen, for its chip.
  const range = rangeOf(view, anchor);
  const from = dayKey(range.from);
  const to = dayKey(range.to);
  const counts = new Map<EventKind, number>();
  for (const event of listed) {
    const day = localDay(event.at);
    if (day >= from && day <= to) counts.set(event.kind, (counts.get(event.kind) ?? 0) + 1);
  }

  // Which span this is, for Step's key, and which way Today goes from it.
  const first = dayKey(span.start);
  const home = dayKey(spanOf(view, parseISO(today)).start);
  const towardToday = home < first ? "nav-back" : home > first ? "nav-forward" : undefined;

  // An event card's View Application opens its application's panel over
  // the view it was clicked in.
  const openHref = (applicationId: string) =>
    calendarHref({ view, date, app: applicationId, demo });
  // A day's number or "+N more" opens the week that holds it.
  const dayHref = (day: string) => calendarHref({ view: "week", date: day, demo });
  const options: FacetOption[] = KIND_ORDER.map((kind) => {
    const look = lookOf(kind);
    const count = counts.get(kind) ?? 0;
    return {
      value: kind,
      label: count ? `${KIND_LABEL[kind]} (${count})` : KIND_LABEL[kind],
      Icon: look.Icon,
      iconClassName: look.onTint,
    };
  });

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {/* Three pieces that wrap apart on a narrow screen: the title, the
            arrows with Today, and the view switch, which takes a line of its
            own on a phone rather than pushing the page sideways. */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <Step key={`${view}:${first}`}>
            <h2 className="text-title text-ink mr-auto">{span.title}</h2>
          </Step>
          {/* THE FILTER, a dropdown as on every page with filters
              (components/field-facet.tsx): each kind in its glyph and
              colour, with how many fall in the span on screen. */}
          <div className="flex items-center gap-1">
            <FieldFacet
              label="Type"
              Icon={StatusIcon}
              options={options}
              values={kinds}
              onChange={(next) => setKinds(next as EventKind[])}
            />
            {kinds.length > 0 && (
              <IconButton label="Clear Filter" className="size-8" onClick={() => setKinds([])}>
                <CloseIcon className="size-4" />
              </IconButton>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <ShallowLink
              href={calendarHref({ view, demo })}
              transitionType={towardToday}
              className={TODAY}
            >
              Today
            </ShallowLink>
            <ShallowLink
              href={calendarHref({ view, date: dayKey(span.prev), demo })}
              transitionType="nav-back"
              aria-label={`Previous ${span.unit}`}
              className={cn(ARROW, "hover:[&>svg]:-translate-x-0.5")}
            >
              <CaretLeftIcon aria-hidden className="size-4" />
            </ShallowLink>
            <ShallowLink
              href={calendarHref({ view, date: dayKey(span.next), demo })}
              transitionType="nav-forward"
              aria-label={`Next ${span.unit}`}
              className={cn(ARROW, "hover:[&>svg]:translate-x-0.5")}
            >
              <CaretRightIcon aria-hidden className="size-4" />
            </ShallowLink>
          </div>
          <CalendarViewSwitch />
          {/* CREATE EVENT, as Google Calendar's Create: the student's own
              interviews, assessments, offers and follow-ups, on the
              application they pick (../applications/create-event.tsx). It
              opens on today when today is on screen, else the span's
              first day. */}
          <CreateEventDialog
            variant="default"
            applications={applications}
            defaultDay={today >= from && today <= to ? today : first}
          />
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
            <TimeGrid
              days={eachDayOfInterval({ start: startOfWeek(anchor), end: endOfWeek(anchor) })}
              today={today}
              byDay={byDay}
              openHref={openHref}
            />
          )}
          {view === "agenda" && (
            <Agenda anchor={anchor} today={today} byDay={byDay} openHref={openHref} />
          )}
        </Step>
      </div>
    </div>
  );
}
