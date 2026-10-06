"use client";

import { addDays, eachDayOfInterval, format } from "date-fns";
import Link from "next/link";

import { CalendarIcon } from "@/components/icons";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/cn";

import type { TrackerEvent } from "../tracker";
import { dayKey, longDay, lookOf, shortTime } from "./entries";

/** How many days the Agenda shows, from its first: two weeks, the span a
 *  search plans in. Its arrows move by the same. */
export const AGENDA_DAYS = 14;

/**
 * Two weeks as a list, a day at a time, skipping the days with nothing on
 * them: the time, the entry in its kind's colour and glyph (the same disc as
 * the Dashboard's Up Next), and whose it is. Up Next's View All opens here,
 * and so does a day's number or "+N more" on the Month.
 */
export function Agenda({
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
  const days = eachDayOfInterval({ start: anchor, end: addDays(anchor, AGENDA_DAYS - 1) }).filter(
    (day) => byDay.has(dayKey(day)),
  );

  if (days.length === 0) {
    return (
      <EmptyState Icon={CalendarIcon} title="Nothing Scheduled" className="mt-4">
        Nothing in your search falls in these two weeks.
      </EmptyState>
    );
  }

  return (
    <ol className="mt-4 flex flex-col gap-6">
      {days.map((day) => {
        const key = dayKey(day);

        return (
          <li key={key} aria-current={key === today ? "date" : undefined}>
            <h3 className="text-label text-ink font-semibold">
              {key === today && <span className="text-brand">Today · </span>}
              {format(day, "EEEE, MMMM d")}
            </h3>

            <ul className="border-border-subtle rounded-card bg-panel mt-2 overflow-hidden border">
              {(byDay.get(key) ?? []).map((event) => {
                const look = lookOf(event.kind);
                const { Icon } = look;

                return (
                  <li key={event.id} className="border-border-subtle border-b last:border-b-0">
                    <Link
                      href={openHref(event.applicationId)}
                      scroll={false}
                      className="hover:bg-hover focus-visible:ring-brand-ring flex items-center gap-3 px-3 py-2.5 focus-visible:ring-2 focus-visible:outline-none focus-visible:ring-inset"
                    >
                      <span className="text-note text-ink-meta w-16 shrink-0">
                        {shortTime(event.at) ?? "All Day"}
                      </span>
                      <span
                        aria-hidden="true"
                        className={cn(
                          "flex size-8 shrink-0 items-center justify-center rounded-full text-white",
                          look.fill,
                        )}
                      >
                        <Icon className="size-3.5" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="text-label text-ink block truncate font-semibold">
                          {event.title}
                        </span>
                        <span className="text-note text-ink-meta block truncate">
                          {event.role} · {event.company}
                        </span>
                        <span className="sr-only">, {longDay(event.at)}</span>
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </li>
        );
      })}
    </ol>
  );
}
