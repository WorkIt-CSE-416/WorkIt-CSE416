"use client";

import { useSyncExternalStore } from "react";

/**
 * "Good morning, Alex", by the seeker's own clock. The server runs in UTC and
 * would greet an evening in New York as the next morning, so it renders the
 * timeless "Welcome back, Alex" and the browser swaps in the time of day after
 * hydration — useSyncExternalStore's server snapshot is what keeps that from
 * being a hydration mismatch. See frontend/CLAUDE.md on timestamps.
 */
const noSubscription = () => () => {};

function partOfDay(hour: number) {
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

export function Greeting({ firstName, className }: { firstName: string; className?: string }) {
  const text = useSyncExternalStore(
    noSubscription,
    () => `${partOfDay(new Date().getHours())}, ${firstName}`,
    () => `Welcome back, ${firstName}`,
  );

  return <p className={className}>{text}</p>;
}
