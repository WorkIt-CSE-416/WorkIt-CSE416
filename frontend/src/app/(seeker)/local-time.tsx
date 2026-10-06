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
