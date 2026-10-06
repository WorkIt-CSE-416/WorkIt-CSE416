"use client";

import { eachDayOfInterval, endOfWeek, format, startOfWeek } from "date-fns";
import Link from "next/link";

import { cn } from "@/lib/cn";

import type { TrackerEvent } from "../tracker";
import { dayKey, longDay, lookOf, shortTime } from "./entries";

/**
 * A week, Sunday to Saturday: one column a day from @3xl/main, each entry a
 * card in its kind's stage tint with its time, title and company.
 *
 * Not an hour grid. A seeker's week holds a handful of things, and an hour
 * grid spends most of its height on empty mornings; a list a day says the
 * same with the times written out. Below @3xl/main the seven columns stack
 * into one list a day, the Agenda's shape, since seven columns would leave a
 * phone about 40px for each.
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
    <ol className="mt-4 grid grid-cols-1 gap-3 @3xl/main:grid-cols-7 @3xl/main:gap-2">
      {days.map((day) => {
        const key = dayKey(day);
        const entries = byDay.get(key) ?? [];
        const isToday = key === today;

        return (
          <li
            key={key}
            aria-current={isToday ? "date" : undefined}
            className={cn(
              "rounded-card bg-panel min-w-0 border p-2 @3xl/main:min-h-64",
              isToday ? "border-brand/40" : "border-border-subtle",
            )}
          >
            <h3 className="flex items-baseline gap-1.5 px-1 @3xl/main:flex-col @3xl/main:gap-0">
              <span className="text-note text-ink-meta font-medium">{format(day, "EEE")}</span>
              <span className={cn("text-subtitle", isToday ? "text-brand" : "text-ink")}>
                {format(day, "d")}
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
                        <span className={cn("text-meta block", look.onTint)}>
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
  );
}
