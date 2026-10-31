"use client";

import { format } from "date-fns";
import { useEffect, useRef, useState } from "react";

import { ChevronDownIcon } from "@/components/icons";
import { cn } from "@/lib/cn";

import type { TrackerEvent } from "../tracker";
import { dayKey, isTimed, KIND_LABEL, longDay, lookOf, timeOf, timeRange } from "./entries";
import { EventEntry } from "./event-card";

/** One hour's height on the grid, in px. */
const HOUR = 48;
/** A block's least height, in minutes: a 15-minute call still fits a title. */
const LEAST = 30;
/** An event with no end is drawn this long, Google Calendar's default. */
const DEFAULT_MINUTES = 60;
/** Where the grid opens when nothing starts earlier: 8 AM. */
const OPENS_AT = 8;
const HOURS = Array.from({ length: 24 }, (_, hour) => hour);
/** All-day entries a day shows before "+N more", while the row is folded. */
const ALL_DAY_SHOWN = 2;

/** Minutes since the local midnight of `date`. */
function minutesOf(date: Date) {
  return date.getHours() * 60 + date.getMinutes();
}

/** A timed event's start and end on its day, in minutes from midnight,
 *  the end clamped to the day (a late call past midnight stops there). */
function spanOf(event: TrackerEvent) {
  const start = new Date(event.at);
  const from = minutesOf(start);
  const end = event.endsAt ? new Date(event.endsAt) : null;
  const length = end ? Math.round((end.getTime() - start.getTime()) / 60000) : DEFAULT_MINUTES;
  return { from, to: Math.min(24 * 60, from + Math.max(length, 1)) };
}

/**
 * Side-by-side columns for a day's timed events, as Google Calendar lays out
 * overlaps: events that overlap, directly or through a chain, form a
 * cluster; each takes the first column free at its start, and every event
 * in a cluster is as wide as the cluster has columns.
 */
function layout(events: TrackerEvent[]) {
  const placed = events
    .map((event) => ({ event, ...spanOf(event) }))
    .sort((a, b) => a.from - b.from || b.to - a.to);
  const result: { event: TrackerEvent; from: number; to: number; col: number; cols: number }[] = [];
  let cluster: typeof result = [];
  let clusterEnd = -1;
  let columns: number[] = [];

  const close = () => {
    for (const item of cluster) item.cols = columns.length;
    result.push(...cluster);
    cluster = [];
    columns = [];
  };

  for (const item of placed) {
    // Drawn height counts toward overlap, so two short calls never stack.
    const drawnTo = Math.max(item.to, item.from + LEAST);
    if (item.from >= clusterEnd && cluster.length) close();
    let col = columns.findIndex((end) => end <= item.from);
    if (col === -1) {
      col = columns.length;
      columns.push(drawnTo);
    } else {
      columns[col] = drawnTo;
    }
    cluster.push({ ...item, col, cols: 1 });
    clusterEnd = Math.max(clusterEnd, drawnTo);
  }
  if (cluster.length) close();
  return result;
}

/** The minutes past midnight now, kept current once a minute. */
function useNowMinutes() {
  const [now, setNow] = useState(() => minutesOf(new Date()));
  useEffect(() => {
    const id = setInterval(() => setNow(minutesOf(new Date())), 60_000);
    return () => clearInterval(id);
  }, []);
  return now;
}

/**
 * The Week view as Google Calendar draws it (KAN-429): a header of days, an
 * ALL-DAY ROW for what has no time of its
 * own (Apply By, a closing day, Applied, and anything added without a
 * time), and a 24-hour grid under it where each timed event (an interview,
 * an assessment with a cut-off) is a block from its start to its end,
 * an hour long when it has none, in its kind's tint with its stage's bar.
 * Overlapping events sit side by side (`layout`). A red line marks now on
 * today's column. The grid scrolls inside its box and opens at 8 AM, or at
 * the earliest event an hour before, so an empty morning never fills the
 * screen. A block opens its event card, as every entry does
 * (./event-card.tsx). They were a list per day with no hours, which hid when things
 * were.
 */
export function TimeGrid({
  days,
  today,
  byDay,
  openHref,
}: {
  days: Date[];
  today: string;
  byDay: Map<string, TrackerEvent[]>;
  openHref: (applicationId: string) => string;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  // THE ALL-DAY ROW FOLDS, as Google Calendar's does: two a day and "+N
  // more", with one toggle that opens the whole row. A day stacked with
  // five all-day entries made the row tall enough to push the morning's
  // hours off the grid.
  const [allDayOpen, setAllDayOpen] = useState(false);
  const now = useNowMinutes();
  const keys = days.map(dayKey);
  const timed = keys.map((key) => (byDay.get(key) ?? []).filter(isTimed));
  const untimed = keys.map((key) => (byDay.get(key) ?? []).filter((event) => !isTimed(event)));
  const earliest = Math.min(OPENS_AT * 60, ...timed.flat().map((event) => spanOf(event).from - 60));
  const columns = { gridTemplateColumns: `3.5rem repeat(${days.length}, minmax(0, 1fr))` };

  // Open at 8 AM, or an hour before the first event, once per span shown.
  // Set again on the next frame: a move between views runs through a view
  // transition, which draws the new grid after this effect, and a scroll
  // set before that was lost (a new view opened at midnight).
  const opensAt = Math.max(0, earliest);
  useEffect(() => {
    const top = (opensAt / 60) * HOUR;
    if (scroller.current) scroller.current.scrollTop = top;
    const frame = requestAnimationFrame(() => {
      if (scroller.current) scroller.current.scrollTop = top;
    });
    return () => cancelAnimationFrame(frame);
  }, [opensAt, keys[0]]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="border-border-subtle rounded-card mt-4 flex min-h-0 flex-1 flex-col overflow-hidden border">
      {/* The days, and under them the all-day row. */}
      <div className="bg-surface border-border-subtle grid shrink-0 border-b" style={columns}>
        <span aria-hidden="true" />
        {days.map((day, i) => {
          const isToday = keys[i] === today;
          return (
            <div key={keys[i]} className="border-border-subtle border-l px-1 py-2 text-center">
              <span className="text-caption text-ink-meta block font-semibold uppercase">
                {format(day, "EEE")}
              </span>
              <span
                aria-current={isToday ? "date" : undefined}
                className={cn(
                  "text-subtitle mt-0.5 inline-flex size-8 items-center justify-center rounded-full font-semibold tabular-nums",
                  isToday ? "bg-brand text-on-brand" : "text-ink",
                )}
              >
                {format(day, "d")}
              </span>
            </div>
          );
        })}

        <span className="text-caption text-ink-meta border-border-subtle flex flex-col items-end gap-0.5 border-t py-1.5 pr-2">
          All Day
          {untimed.some((list) => list.length > ALL_DAY_SHOWN) && (
            <button
              type="button"
              aria-expanded={allDayOpen}
              onClick={() => setAllDayOpen(!allDayOpen)}
              className="text-ink-meta hover:text-ink focus-visible:ring-brand-ring rounded-xs focus-visible:ring-2 focus-visible:outline-none"
            >
              <ChevronDownIcon
                className={cn(
                  "size-3.5 transition-transform duration-150",
                  allDayOpen && "rotate-180",
                )}
              />
              <span className="sr-only">
                {allDayOpen ? "Show fewer" : "Show all"} all-day entries
              </span>
            </button>
          )}
        </span>
        {days.map((day, i) => (
          <ul
            key={keys[i]}
            aria-label={`${format(day, "EEEE")}, all day`}
            className="border-border-subtle flex min-w-0 flex-col gap-1 border-t border-l p-1"
          >
            {(allDayOpen ? untimed[i] : untimed[i].slice(0, ALL_DAY_SHOWN)).map((event) => {
              const look = lookOf(event.kind);
              const { Icon } = look;
              const time = timeOf(event);
              return (
                <li key={event.id} className="min-w-0">
                  <EventEntry
                    event={event}
                    openHref={openHref}
                    title={`${KIND_LABEL[event.kind]} · ${event.company}${time ? ` · ${time}` : ""}`}
                    className={cn(
                      "text-meta focus-visible:ring-brand-ring flex min-w-0 items-center gap-1 rounded-md px-1.5 py-0.5 font-medium transition-[filter] duration-150 hover:brightness-95 focus-visible:ring-2 focus-visible:outline-none",
                      look.tint,
                      look.onTint,
                    )}
                  >
                    <Icon aria-hidden className="size-3 shrink-0" />
                    <span className="truncate">{event.company}</span>
                    <span className="sr-only">
                      , {event.title}, {event.role}, {longDay(event.at)}
                    </span>
                  </EventEntry>
                </li>
              );
            })}
            {!allDayOpen && untimed[i].length > ALL_DAY_SHOWN && (
              <li>
                <button
                  type="button"
                  onClick={() => setAllDayOpen(true)}
                  className="text-meta text-ink-meta hover:text-ink focus-visible:ring-brand-ring rounded-xs px-1.5 font-medium transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none"
                >
                  +{untimed[i].length - ALL_DAY_SHOWN} more
                </button>
              </li>
            )}
          </ul>
        ))}
      </div>

      {/* The hours. */}
      {/* Only the hours scroll, filling the page's height (./page.tsx). */}
      <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div className="relative grid" style={{ ...columns, height: 24 * HOUR }}>
          {/* Hour labels, and a hairline across every hour. */}
          <div aria-hidden="true" className="relative">
            {HOURS.slice(1).map((hour) => (
              <span
                key={hour}
                className="text-caption text-ink-meta absolute right-2 -translate-y-1/2 tabular-nums"
                style={{ top: hour * HOUR }}
              >
                {format(new Date(2026, 0, 1, hour), "h a")}
              </span>
            ))}
          </div>
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 left-14"
            style={{
              backgroundImage: `repeating-linear-gradient(to bottom, var(--color-border-subtle) 0 1px, transparent 1px ${HOUR}px)`,
            }}
          />

          {days.map((day, i) => (
            <ol
              key={keys[i]}
              aria-label={`${format(day, "EEEE, MMMM d")}, by time`}
              className="border-border-subtle relative border-l"
            >
              {layout(timed[i]).map(({ event, from, to, col, cols }) => {
                const look = lookOf(event.kind);
                const height = (Math.max(to - from, LEAST) / 60) * HOUR - 2;
                const short = height < 40;
                return (
                  <li
                    key={event.id}
                    className="absolute px-0.5"
                    style={{
                      top: (from / 60) * HOUR + 1,
                      height,
                      left: `${(col / cols) * 100}%`,
                      width: `${100 / cols}%`,
                    }}
                  >
                    <EventEntry
                      event={event}
                      openHref={openHref}
                      className={cn(
                        "focus-visible:ring-brand-ring relative flex h-full overflow-hidden rounded-md py-1 pr-1.5 pl-2.5 transition-[filter] duration-150 hover:brightness-95 focus-visible:ring-2 focus-visible:outline-none",
                        short ? "items-center gap-1.5" : "flex-col",
                        look.tint,
                      )}
                    >
                      <span
                        aria-hidden="true"
                        className={cn("absolute inset-y-0 left-0 w-[3px]", look.fill)}
                      />
                      <span className="text-meta text-ink truncate font-semibold">
                        {event.title}
                      </span>
                      <span className={cn("text-note truncate tabular-nums", look.onTint)}>
                        {timeRange(event)}
                      </span>
                      {!short && (
                        <span className="text-note text-ink-meta truncate">{event.company}</span>
                      )}
                      <span className="sr-only">
                        , {event.role}, {longDay(event.at)}
                      </span>
                    </EventEntry>
                  </li>
                );
              })}

              {/* Now, on today's column. */}
              {keys[i] === today && (
                <li
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-x-0 z-10"
                  style={{ top: (now / 60) * HOUR }}
                >
                  <span className="bg-danger absolute -top-[5px] -left-[5px] size-2.5 rounded-full" />
                  <span className="bg-danger block h-0.5" />
                </li>
              )}
            </ol>
          ))}
        </div>
      </div>
    </div>
  );
}
