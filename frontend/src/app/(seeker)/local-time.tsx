"use client";

import Link from "next/link";
import { useSyncExternalStore, type ReactNode } from "react";

import { calendarHref, type CalendarView } from "./calendar/query";
import { describeWhen, describeWhenOnServer, localDay } from "./tracker";

/**
 * Dates as the viewer's own clock reads them, for the server components that
 * list applications.
 *
 * Which day an instant falls on depends on the viewer's zone, and the server
 * has none to use. So the server renders the UTC date ("Oct 7"), and the
 * browser swaps in its own wording ("Tomorrow, 2:00 PM") once it hydrates,
 * the pattern components/job-detail/closes-on.tsx set. useSyncExternalStore
 * rather than an effect: hydration renders the server's text first, so the
 * two never mismatch, and there is nothing to subscribe to.
 *
 * The snapshot is a string, so a re-render inside the same minute returns an
 * equal value and React does not loop.
 */
const noSubscription = () => () => {};

export function When({ at }: { at: string }) {
  const text = useSyncExternalStore(
    noSubscription,
    () => describeWhen(at, new Date()),
    () => describeWhenOnServer(at),
  );

  return <time dateTime={at}>{text}</time>;
}

/**
 * The calendar day `at` falls on, "Oct 17", on the viewer's own clock: the
 * UTC day on the server, the local one after hydration, as <When> does.
 * `formatDate` alone prints the UTC day, which is already tomorrow for a
 * resume sent on an evening in the Americas (KAN-258). The year shows only
 * when it is not this one, as the tracker's days and My Profile's resume rows
 * read: with it, a resume card's "Last edited" wrapped on a phone.
 */
export function LocalDate({ at }: { at: string }) {
  const day = useSyncExternalStore(
    noSubscription,
    () => dayOf(at),
    () => dayOf(at, "UTC"),
  );

  return <time dateTime={at}>{day}</time>;
}

function dayOf(at: string, timeZone?: "UTC") {
  const date = new Date(at);
  const now = new Date();
  const thisYear = timeZone
    ? date.getUTCFullYear() === now.getUTCFullYear()
    : date.getFullYear() === now.getFullYear();
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: thisYear ? undefined : "numeric",
    timeZone,
  });
}

/** False while hydrating a server render, true after, and true straight away
 *  on a client navigation. For what the server cannot draw at all, like a
 *  calendar anchored on the viewer's today. */
export function useHydrated() {
  return useSyncExternalStore(
    noSubscription,
    () => true,
    () => false,
  );
}

/**
 * A link to the Calendar day `at` falls on, in `view`: a card's next step
 * opens its week, an Up Next row its day in the Agenda. Which day that is
 * depends on the viewer's zone, so it is worked out the same way <When> works
 * out its words: the UTC day on the server, the local one after hydration.
 */
export function DayLink({
  at,
  view,
  className,
  label,
  children,
}: {
  at: string;
  view: CalendarView;
  className?: string;
  /** An accessible name, when the visible text alone would not say where
   *  the link goes. It should start with that text (WCAG 2.5.3). */
  label?: string;
  children: ReactNode;
}) {
  const day = useSyncExternalStore(
    noSubscription,
    () => localDay(at),
    () => at.slice(0, 10),
  );

  return (
    <Link href={calendarHref({ view, date: day })} aria-label={label} className={className}>
      {children}
    </Link>
  );
}
