"use client";

import { eachDayOfInterval, endOfWeek, format, startOfWeek } from "date-fns";
import Link from "next/link";

import { cn } from "@/lib/cn";

import type { TrackerEvent } from "../tracker";
import { dayKey, longDay, lookOf, shortTime } from "./entries";

/**
 * A week, Sunday to Saturday, in the Month's tiles: one light grey rounded
 * tile a day under the same small uppercase weekday names, today's white and
 * outlined in the brand, each entry a card in its kind's stage tint with its
 * time, title and company.
 *
 * Not an hour grid. A seeker's week holds a handful of things, and an hour
 * grid spends most of its height on empty mornings; a list a day says the
 * same with the times written out. Below @3xl/main the seven tiles stack into
 * one list a day, the Agenda's shape, since seven columns would leave a phone
 * about 40px each; there each tile names its own weekday, and the row of
 * names above steps out.
 */
export function Week({
  anchor,
  today,
  byDay,
  openHref,
}: {
  anchor: Date;
  today: string;
  byDay: Map<string, TrackerEvent[]>;
  openHref: (applicationId: string) => string;
}) {
  const days = eachDayOfInterval({ start: startOfWeek(anchor), end: endOfWeek(anchor) });

  return (
    <div className="mt-3">
      <div aria-hidden="true" className="hidden grid-cols-7 gap-2 @3xl/main:grid">
        {days.map((day) => (
          <span key={dayKey(day)} className="text-caption text-ink-meta py-1 text-center uppercase">
            {format(day, "EEE")}
          </span>
        ))}
      </div>

      <ol className="grid grid-cols-1 gap-2 @3xl/main:mt-1 @3xl/main:grid-cols-7">
        {days.map((day) => {
          const key = dayKey(day);
          const entries = byDay.get(key) ?? [];
          const isToday = key === today;

          return (
            <li
              key={key}
              aria-current={isToday ? "date" : undefined}
              className={cn(
                "rounded-card min-w-0 p-2 @3xl/main:min-h-72",
                isToday ? "bg-panel ring-brand ring-[1.5px] ring-inset" : "bg-app",
              )}
            >
              <h3 className="flex items-center gap-1.5">
                <span
                  className={cn(
                    "text-note inline-flex size-6 items-center justify-center rounded-full font-semibold",
                    isToday ? "bg-brand text-on-brand" : "text-ink",
                  )}
                >
                  {format(day, "d")}
                </span>
                <span className="text-note text-ink-meta font-medium @3xl/main:sr-only">
                  {format(day, "EEEE")}
                </span>
              </h3>

              {entries.length > 0 ? (
                <ul className="mt-2 flex flex-col gap-1.5">
                  {entries.map((event) => {
                    const look = lookOf(event.kind);

                    return (
                      <li key={event.id}>
                        <Link
                          href={openHref(event.applicationId)}
                          scroll={false}
                          className={cn(
                            "rounded-control focus-visible:ring-brand-ring block px-2 py-1.5 hover:brightness-[0.97] focus-visible:ring-2 focus-visible:outline-none",
                            look.tint,
                          )}
                        >
                          <span className={cn("text-meta block font-medium", look.onTint)}>
                            {shortTime(event.at) ?? "All Day"}
                          </span>
                          <span className="text-note text-ink block font-semibold wrap-break-word">
                            {event.title}
                          </span>
                          <span className="text-meta text-ink-meta block truncate">
                            {event.company}
                          </span>
                          <span className="sr-only">
                            , {event.role}, {longDay(event.at)}
                          </span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="text-note text-ink-meta mt-1 px-1 @3xl/main:sr-only">
                  Nothing scheduled
                </p>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
