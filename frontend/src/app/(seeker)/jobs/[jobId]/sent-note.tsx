"use client";

import { useSyncExternalStore } from "react";

import { formatDate } from "@/lib/format-date";

const noSubscription = () => () => {};

/**
 * "You sent General SWE on Oct 13, 2026" (story 98): the last resume the
 * student applied to this posting with. The day is the viewer's own: the
 * server renders the UTC day, and the browser swaps in its local one after
 * hydration, as `../../local-time.tsx` does.
 */
export function SentNote({ name, at }: { name: string; at: string }) {
  const day = useSyncExternalStore(
    noSubscription,
    () =>
      new Date(at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }),
    () => formatDate(at),
  );

  return (
    <p className="text-note text-ink-meta mt-3">
      You sent {name} on <time dateTime={at}>{day}</time>.
    </p>
  );
}
