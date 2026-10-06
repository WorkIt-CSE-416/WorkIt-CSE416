"use client";

import { useSyncExternalStore } from "react";

/**
 * "Good Morning, Alex", by the seeker's own clock. The server runs in UTC and
 * would greet an evening in New York as the next morning, so it renders the
 * timeless "Welcome Back, Alex" and the browser swaps in the time of day after
 * hydration — useSyncExternalStore's server snapshot is what keeps that from
 * being a hydration mismatch. See frontend/CLAUDE.md on timestamps.
 */
const noSubscription = () => () => {};

function partOfDay(hour: number) {
  if (hour < 12) return "Good Morning";
  if (hour < 18) return "Good Afternoon";
  return "Good Evening";
}

export function Greeting({
  firstName,
  as: Tag = "p",
  className,
}: {
  firstName: string;
  /** h1 on the Dashboard, where the greeting is the page's heading. */
  as?: "p" | "h1";
  className?: string;
}) {
  const text = useSyncExternalStore(
    noSubscription,
    () => `${partOfDay(new Date().getHours())}, ${firstName}`,
    () => `Welcome Back, ${firstName}`,
  );

  return <Tag className={className}>{text}</Tag>;
}
