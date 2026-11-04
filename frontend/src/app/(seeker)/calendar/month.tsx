"use client";

import {
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameMonth,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import { useEffect, useRef, useState, type RefObject } from "react";

import { ShallowLink } from "@/components/shallow-routing";
import { cn } from "@/lib/cn";

import type { TrackerEvent } from "../tracker";
import { dayKey, isTimed, KIND_LABEL, KIND_ORDER, longDay, lookOf, timeOf } from "./entries";
import { EventEntry } from "./event-card";

/** A chip's height with the gap under it, and what a day spends before its
 *  first chip (its padding, its number, the gap under it), in px: what
 *  `useFit` divides a week's row by. */
const CHIP = 24;
const DAY_TOP = 44;

/**
 * How many chips a day has room for, Google Calendar's way: the weeks share
 * the page's height (./page.tsx), so a day's room is its row's height, read
 * off the grid as it resizes. A short window shows fewer chips a day and
 * folds the rest into "+N more", never a scrollbar. One at least, so a day
 * with entries always shows one or its count.
 */
function useFit(grid: RefObject<HTMLOListElement | null>, weeks: number) {
  const [fit, setFit] = useState(3);
  useEffect(() => {
    const node = grid.current;
    if (!node) return;
    const observer = new ResizeObserver(() => {
      const row = node.clientHeight / weeks;
      setFit(Math.max(1, Math.floor((row - DAY_TOP) / CHIP)));
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [grid, weeks]);
  return fit;
}

/**
 * A month as one ruled table, Sunday first (KAN-429): white days divided by
 * hairlines (the grid's 1px gaps over --color-border-subtle), the weekday
 * names in a grey band above, days outside the month on grey with faint
 * numbers, and today's number in a brand disc. It was a wall of separate
 * grey rounded tiles, which read as buttons and blurred the month's edges.
 *
 * A CHIP SAYS WHAT IT IS AND WHOSE, as Google Calendar's month does: an
 * all-day entry (Apply By, a closing day, Applied) is a filled bar in its
 * stage tint with its kind's glyph; a timed one (an interview) is a dot in
 * its colour, its time and the company, unfilled ("● 2 PM Acme"), so a
 * month tells appointments from dates at a glance (isTimed). Every chip was
 * a lavender pill with the company alone, so an interview and an applied
 * day looked the same. The kind's name and the title are in its tooltip and
 * accessible name, and in full in the Week and the Agenda.
 *
 * THE WEEKS SHARE THE PAGE'S HEIGHT (KAN-429), so the month fits the screen
 * and the page never scrolls: a day shows as many chips as its row has room
 * for (`useFit`) and "+N more", which opens the week that holds the day. A
 * day never stretches its week; it grew rows of 112px before, so a month ran
 * past the fold. Its number opens that week too, both in place
 * (ShallowLink), since the Week is drawn here from the same entries. A chip
 * opens its event card (./event-card.tsx).
 *
 * BELOW @3xl/main (KAN-578) a 7-column grid has about 45px a day, too
 * little for any words, so the Calendar passes `openDay`: each day is one
 * button the size of its cell, its entries a dot each, and a tap opens the
 * day's sheet (./day-sheet.tsx) listing them in words. A key under the
 * grid names each colour the month shows. The dots alone said nothing but
 * their colour, and a screen reader heard a count.
 */
export function Month({
  anchor,
  today,
  byDay,
  openHref,
  dayHref,
  openDay,
}: {
  anchor: Date;
  today: string;
  byDay: Map<string, TrackerEvent[]>;
  openHref: (applicationId: string) => string;
  dayHref: (day: string) => string;
  /** Narrow only: a day's tap opens its sheet. */
  openDay?: (day: string) => void;
}) {
  const days = eachDayOfInterval({
    start: startOfWeek(startOfMonth(anchor)),
    end: endOfWeek(endOfMonth(anchor)),
  });
  const weeks = days.length / 7;
  const grid = useRef<HTMLOListElement>(null);
  const fit = useFit(grid, weeks);
  // The kinds the month shows, in the filter's order, for the narrow key.
  const shownKinds = new Set(
    days.flatMap((day) => (byDay.get(dayKey(day)) ?? []).map((e) => e.kind)),
  );
  const legend = KIND_ORDER.filter((kind) => shownKinds.has(kind));

  return (
    <div className="border-border-control rounded-card mt-4 flex min-h-0 flex-1 flex-col overflow-hidden border">
      <div
        aria-hidden="true"
        className="bg-surface border-border-subtle grid shrink-0 grid-cols-7 border-b"
      >
        {days.slice(0, 7).map((day) => (
          <span
            key={dayKey(day)}
            className="text-caption text-ink-meta py-2 text-center font-semibold uppercase"
          >
            {format(day, "EEE")}
          </span>
        ))}
      </div>

      {/* The weeks share the height left, five or six rows as the month
          needs (Google Calendar's month); a day never grows its row. */}
      <ol
        ref={grid}
        className="bg-border-subtle grid min-h-0 flex-1 grid-cols-7 gap-px"
        style={{ gridTemplateRows: `repeat(${weeks}, minmax(0, 1fr))` }}
      >
        {days.map((day) => {
          const key = dayKey(day);
          const entries = byDay.get(key) ?? [];
          const inMonth = isSameMonth(day, anchor);
          const isToday = key === today;
          const count = entries.length;
          // Every entry when they all fit; else one less, for "+N more".
          const shown = count <= fit ? count : Math.max(fit - 1, 0);

          const label = `${format(day, "EEEE, MMMM d")}, ${count === 0 ? "nothing scheduled" : count === 1 ? "1 entry" : `${count} entries`}`;
          const number = cn(
            "text-note inline-flex size-6 items-center justify-center rounded-full font-semibold tabular-nums",
            isToday ? "bg-brand text-on-brand" : inMonth ? "text-ink" : "text-ink-meta",
          );

          // Narrow: the whole day is the button, its entries a dot each,
          // four at most.
          if (openDay) {
            return (
              <li key={key} className={cn("min-h-0 min-w-0", inMonth ? "bg-panel" : "bg-well")}>
                <button
                  type="button"
                  aria-label={label}
                  aria-current={isToday ? "date" : undefined}
                  onClick={() => openDay(key)}
                  className="focus-visible:ring-brand-ring hover:bg-hover flex size-full flex-col items-start overflow-hidden p-1.5 transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none focus-visible:ring-inset"
                >
                  <span className={number}>{format(day, "d")}</span>
                  {count > 0 && (
                    <span aria-hidden="true" className="mt-1 flex flex-wrap gap-0.5">
                      {entries.slice(0, 4).map((event) => (
                        <span
                          key={event.id}
                          className={cn("size-1.5 rounded-full", lookOf(event.kind).fill)}
                        />
                      ))}
                    </span>
                  )}
                </button>
              </li>
            );
          }

          return (
            <li
              key={key}
              className={cn(
                "min-h-0 min-w-0 overflow-hidden p-2",
                inMonth ? "bg-panel" : "bg-well",
              )}
            >
              <ShallowLink
                href={dayHref(key)}
                aria-label={label}
                aria-current={isToday ? "date" : undefined}
                className={cn(
                  number,
                  "focus-visible:ring-brand-ring transition-[background-color,transform] duration-150 ease-out focus-visible:ring-2 focus-visible:outline-none active:scale-90",
                  isToday ? "hover:bg-brand-hover" : "hover:bg-selected",
                )}
              >
                {format(day, "d")}
              </ShallowLink>

              {/* Wide: as many chips as the day has room for, then the
                  rest as a count. */}
              {count > 0 && (
                <ul className="mt-1 flex flex-col gap-1">
                  {entries.slice(0, shown).map((event) => {
                    const look = lookOf(event.kind);
                    const { Icon } = look;
                    const time = timeOf(event);
                    const timed = isTimed(event);

                    return (
                      <li key={event.id} className="min-w-0">
                        <EventEntry
                          event={event}
                          openHref={openHref}
                          title={`${KIND_LABEL[event.kind]} · ${event.company}${time ? ` · ${time}` : ""}`}
                          className={cn(
                            "text-note focus-visible:ring-brand-ring ease-glide flex min-w-0 items-center gap-1 rounded-md px-1.5 py-0.5 font-medium transition-[filter,background-color,transform] duration-150 focus-visible:ring-2 focus-visible:outline-none active:scale-[0.96]",
                            timed
                              ? "text-ink hover:bg-hover"
                              : cn(look.tint, look.onTint, "hover:brightness-95"),
                          )}
                        >
                          {timed ? (
                            <span
                              aria-hidden="true"
                              className={cn("size-2 shrink-0 rounded-full", look.fill)}
                            />
                          ) : (
                            <Icon aria-hidden className="size-3 shrink-0" />
                          )}
                          <span className="truncate">
                            {time && (
                              <span className={cn("tabular-nums", timed && "text-ink-meta")}>
                                {time}{" "}
                              </span>
                            )}
                            {event.company}
                          </span>
                          <span className="sr-only">
                            , {event.title}, {event.role}, {longDay(event.at)}
                          </span>
                        </EventEntry>
                      </li>
                    );
                  })}
                  {count > shown && (
                    <li>
                      <ShallowLink
                        href={dayHref(key)}
                        className="text-meta text-ink-meta hover:text-ink focus-visible:ring-brand-ring rounded-xs px-1.5 font-medium transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none"
                      >
                        +{count - shown} more
                      </ShallowLink>
                    </li>
                  )}
                </ul>
              )}
            </li>
          );
        })}
      </ol>

      {openDay && legend.length > 0 && (
        <ul
          aria-label="Key"
          className="bg-surface border-border-subtle flex shrink-0 flex-wrap gap-x-3 gap-y-1 border-t px-3 py-2"
        >
          {legend.map((kind) => (
            <li key={kind} className="text-note text-ink-meta flex items-center gap-1.5">
              <span aria-hidden="true" className={cn("size-2 rounded-full", lookOf(kind).fill)} />
              {KIND_LABEL[kind]}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
