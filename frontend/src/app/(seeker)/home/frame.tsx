import type { ReactNode } from "react";

import { Skeleton } from "@/components/shadcn/skeleton";
import { cn } from "@/lib/cn";

import { SEEKER_GUTTER } from "../gutter";
import { RangeSwitch } from "./range-switch";

/**
 * Home's frame: the page's width and gutters, the header (the
 * heading, its line and the range switch), the numbers' grid, then Top
 * Matches and Activity. The page (./page.tsx) fills it with what it read and
 * ./loading.tsx with skeletons, so the two are one layout by construction:
 * the loading state is replaced by the page without a pixel moving, which
 * two copies of this markup would not keep for long.
 */
export function HomeFrame({
  heading,
  tiles,
  topMatches,
  activity,
}: {
  /** The page's h1: the greeting, or its skeleton. */
  heading: ReactNode;
  /** The four numbers, each a cell of the grid. */
  tiles: ReactNode;
  topMatches: ReactNode;
  activity: ReactNode;
}) {
  return (
    <div className={cn("max-w-dashboard mx-auto w-full flex-1 py-5", SEEKER_GUTTER)}>
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          {heading}
          <p className="text-body text-ink-meta mt-1">Here&apos;s where your search stands.</p>
        </div>

        {/* Find Jobs sat beside it until KAN-261: the sidebar's Jobs row and
            the Strong Matches tile already lead there. */}
        <RangeSwitch />
      </header>

      {/* The numbers, in a grid of their own: four across, with Activity
          the full width under them. */}
      <div className="mt-5 grid grid-cols-2 gap-4 @4xl/main:grid-cols-4">{tiles}</div>

      {topMatches}
      {activity}
    </div>
  );
}

/** The heading's place while the account loads: a bar the height of the
 *  heading's line (--text-heading's 2rem) and about a greeting's width. */
export function HeadingSkeleton() {
  return <Skeleton aria-hidden="true" className="h-8 w-64 max-w-full" />;
}
