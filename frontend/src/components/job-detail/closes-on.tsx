"use client";

import { useSyncExternalStore } from "react";

import { formatDate } from "@/lib/format-date";

const noSubscription = () => () => {};

/**
 * "Closes Oct 19, 2026", on the viewer's own calendar. `closes_at` is a full
 * timestamp (23:59:59 of the recruiter's chosen day, in their timezone), so
 * the day it falls on depends on where it is read, which only the browser
 * knows. The server (UTC) renders its UTC day with formatDate, a day late for
 * anyone in the Americas, and the browser swaps in its own day after
 * hydration: useSyncExternalStore's server snapshot is what keeps that from
 * being a hydration mismatch. A date-only string has no timezone to apply, so
 * it stays as written. The same split as the jobs table's PostedDate; see
 * frontend/CLAUDE.md on timestamps.
 */
export function ClosesOn({ iso }: { iso: string }) {
  const day = useSyncExternalStore(
    noSubscription,
    () =>
      iso.length === 10
        ? formatDate(iso)
        : new Date(iso).toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
            year: "numeric",
          }),
    () => formatDate(iso),
  );

  return <>Closes {day}</>;
}
