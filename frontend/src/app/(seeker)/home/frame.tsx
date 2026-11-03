import type { ReactNode } from "react";

import { cn } from "@/lib/cn";

import { SEEKER_GUTTER } from "../gutter";
import { RangeSwitch } from "./range-switch";

/**
 * Home's frame: the page's width and gutters, the range switch, the numbers'
 * grid, then Top Matches and Activity. The greeting is in the top bar
 * (../layout.tsx). The page (./page.tsx) fills it with what it read and
 * ./loading.tsx with skeletons, so the two are one layout by construction:
 * the loading state is replaced by the page without a pixel moving, which
 * two copies of this markup would not keep for long.
 */
export function HomeFrame({
  tiles,
  topMatches,
  activity,
}: {
  /** The four numbers, each a cell of the grid. */
  tiles: ReactNode;
  topMatches: ReactNode;
  activity: ReactNode;
}) {
  return (
    <div className={cn("max-w-dashboard mx-auto w-full flex-1 py-5", SEEKER_GUTTER)}>
      <header className="flex justify-end">
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
