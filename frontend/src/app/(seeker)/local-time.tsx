"use client";

import { useSyncExternalStore } from "react";

import { describeWhen, describeWhenOnServer } from "./tracker";

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
