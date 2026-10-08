"use client";

import { ViewTransition, type ReactNode } from "react";

import type { View } from "./query";
import { useApplicationsQuery } from "./view-switcher";

/**
 * The results, in whichever layout the URL names. The page renders all three
 * on the server (they are server components, and each builds its links for
 * its own layout, so none goes stale), and this picks one in the browser:
 * the layout switch moves the URL in place, and the new layout draws in the
 * same frame as the thumb. Only the one shown is mounted, so its cards rise
 * in as it appears.
 *
 * Keyed on the shape of the results: the layout, the board's columns, or
 * nothing matching (`panes` null, `empty` shown). A change of shape swaps the
 * whole thing, the old fading as the new one rises in; within one shape the
 * items glide to their new places instead (./reflow.tsx).
 */
export function ViewPanes({
  panes,
  empty,
  columns,
}: {
  panes: Record<View, ReactNode> | null;
  /** Shown when nothing matches, in every layout. */
  empty?: ReactNode;
  /** The board's columns, as the stage filter picks them. */
  columns: string;
}) {
  const { view } = useApplicationsQuery();
  const key = panes === null ? "empty" : view === "board" ? `board:${columns}` : view;

  return (
    <ViewTransition key={key} enter="swap-enter" exit="swap-exit" default="none">
      {panes === null ? empty : panes[view]}
    </ViewTransition>
  );
}
