"use client";

import {
  createContext,
  startTransition as startGlobalTransition,
  use,
  useTransition,
  type ReactNode,
  type TransitionStartFunction,
} from "react";

import { cn } from "@/lib/cn";

/**
 * A filter change's transition, shared by the filter row and the feed below it.
 *
 * Applying filters asks the server for the page again, which takes a round
 * trip plus the API's own (about half a second against Supabase). The row
 * starts that navigation in this transition, so the feed can dim the moment
 * it begins rather than sit unchanged until the narrowed list arrives: a
 * press that showed nothing for half a second read as a press that hadn't
 * registered. The dim gives way to the feed's skeleton, then the results.
 */
const FeedTransitionContext = createContext<{
  pending: boolean;
  start: TransitionStartFunction;
} | null>(null);

export function FeedTransition({ children }: { children: ReactNode }) {
  const [pending, start] = useTransition();
  return <FeedTransitionContext value={{ pending, start }}>{children}</FeedTransitionContext>;
}

/** The shared transition's start; React's plain one outside a FeedTransition. */
export function useFeedTransition(): TransitionStartFunction {
  return use(FeedTransitionContext)?.start ?? startGlobalTransition;
}

/** The feed, dimmed and quiet while a filter change is on its way. */
export function PendingFeed({ children }: { children: ReactNode }) {
  const pending = use(FeedTransitionContext)?.pending ?? false;
  return (
    <div
      aria-busy={pending}
      className={cn("transition-opacity duration-150", pending && "pointer-events-none opacity-50")}
    >
      {children}
    </div>
  );
}
