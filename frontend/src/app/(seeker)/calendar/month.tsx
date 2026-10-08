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
import Link from "next/link";

import { cn } from "@/lib/cn";

import type { TrackerEvent } from "../tracker";
import { dayKey, longDay, lookOf, shortTime } from "./entries";

/**
 * A month as a grid of day tiles, Sunday first: each day its own light grey
 * rounded tile with gaps between them rather than one ruled table, its number
 * top left and its entries under it as small chips in their kind's stage
 * tint. Weekday names run above in small uppercase. Today's tile is white,
 * outlined in the brand, with its number in a brand disc. Days outside the
 * month are fainter tiles and still show their entries, so a week that
 * straddles two months reads whole.
 *
 * A CHIP NAMES THE COMPANY, not the entry, and carries no time. Its colour
 * already says what kind of thing it is (an amber interview, a green offer, a
 * grey deadline, per the legend), so the words go to whose it is: "CloudSync"
 * rather than "2 PM Technical Interview", and never a bare "Applied" that
 * says nothing about where. The title and time are in the chip's tooltip and
 * accessible name, and in full in the Week and the Agenda.
 *
 * A day shows two chips and "+N more", which opens that day in the Agenda; a
 * busy day must not stretch its whole week. Its number opens the day in the
 * Agenda too. A chip opens its application's detail panel.
 *
 * Below @3xl/main a 7-column grid has about 45px a day, too little for any
 * words, so each day shows its entries as dots instead (aria-hidden: the
 * day's number is the link, and its name says how many entries the day
 * holds).
 */
export function Month({
  anchor,
  today,
  byDay,
  openHref,
  dayHref,
}: {
  anchor: Date;
  today: string;
  byDay: Map<string, TrackerEvent[]>;
  openHref: (applicationId: string) => string;
  dayHref: (day: string) => string;
}) {
  const days = eachDayOfInterval({
    start: startOfWeek(startOfMonth(anchor)),
    end: endOfWeek(endOfMonth(anchor)),
  });

  return (
    <div className="mt-3">
      <div aria-hidden="true" className="grid grid-cols-7 gap-1.5 @3xl/main:gap-2">
        {days.slice(0, 7).map((day) => (
          <span key={dayKey(day)} className="text-caption text-ink-meta py-1 text-center uppercase">
            {format(day, "EEE")}
          </span>
        ))}
      </div>

      <ol className="mt-1 grid grid-cols-7 gap-1.5 @3xl/main:gap-2">
        {days.map((day) => {
          const key = dayKey(day);
          const entries = byDay.get(key) ?? [];
          const inMonth = isSameMonth(day, anchor);
          const isToday = key === today;
          const count = entries.length;

          return (
            <li
              key={key}
              className={cn(
                "rounded-card min-h-16 min-w-0 p-1.5 @3xl/main:min-h-24 @3xl/main:p-2",
                isToday
                  ? "bg-panel ring-brand ring-[1.5px] ring-inset"
                  : inMonth
                    ? "bg-app"
                    : "bg-app/50",
              )}
            >
              <Link
                href={dayHref(key)}
                aria-label={`${format(day, "EEEE, MMMM d")}, ${count === 0 ? "nothing scheduled" : count === 1 ? "1 entry" : `${count} entries`}`}
                aria-current={isToday ? "date" : undefined}
                className={cn(
                  "text-note focus-visible:ring-brand-ring inline-flex size-6 items-center justify-center rounded-full font-semibold focus-visible:ring-2 focus-visible:outline-none",
                  isToday
                    ? "bg-brand text-on-brand"
                    : inMonth
                      ? "text-ink hover:bg-selected"
                      : "text-ink-faint hover:bg-selected",
                )}
              >
                {format(day, "d")}
              </Link>

              {/* Narrow: a dot per entry, four at most. */}
              {count > 0 && (
                <div aria-hidden="true" className="mt-1 flex flex-wrap gap-0.5 @3xl/main:hidden">
                  {entries.slice(0, 4).map((event) => (
                    <span
                      key={event.id}
                      className={cn("size-1.5 rounded-full", lookOf(event.kind).fill)}
                    />
                  ))}
                </div>
              )}

              {/* Wide: two chips, then the rest as a count. */}
              {count > 0 && (
                <ul className="mt-1.5 hidden flex-col gap-1 @3xl/main:flex">
                  {entries.slice(0, 2).map((event) => {
                    const look = lookOf(event.kind);
                    const time = shortTime(event.at);

                    return (
                      <li key={event.id} className="min-w-0">
                        <Link
                          href={openHref(event.applicationId)}
                          scroll={false}
                          title={`${event.title} · ${event.company}${time ? ` · ${time}` : ""}`}
                          className={cn(
                            "text-meta focus-visible:ring-brand-ring block truncate rounded-md px-1.5 py-0.5 font-medium hover:brightness-[0.97] focus-visible:ring-2 focus-visible:outline-none",
                            look.tint,
                            look.onTint,
                          )}
                        >
                          {event.company}
                          <span className="sr-only">
                            , {event.title}, {event.role}, {longDay(event.at)}
                            {time && `, ${time}`}
                          </span>
                        </Link>
                      </li>
                    );
                  })}
                  {count > 2 && (
                    <li>
                      <Link
                        href={dayHref(key)}
                        className="text-meta text-ink-meta hover:text-ink focus-visible:ring-brand-ring rounded-xs px-1.5 focus-visible:ring-2 focus-visible:outline-none"
                      >
                        +{count - 2} more
                      </Link>
                    </li>
                  )}
                </ul>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
