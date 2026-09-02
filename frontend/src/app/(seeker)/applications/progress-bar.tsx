import { cn } from "@/lib/cn";

import type { Stage } from "./data";

/**
 * How far an application has moved through the pipeline.
 *
 * The fill takes the stage's own accent — the same three colours the board
 * paints along a card's top edge — rather than the mockup's per-card palette.
 * That mockup gives each project an arbitrary colour (orange, pink, red, two
 * blues); here the colour carries meaning, so a full green bar reads as an offer
 * at a glance and cannot be mistaken for a long-running application.
 *
 * The track is --color-well rather than a border colour: at 25% the pale fill
 * is the whole signal, and against a border-weight track it all but vanished.
 * The mockup's track is near-white for the same reason.
 *
 * Decorative on purpose: the percentage sits in text directly above it, and a
 * progressbar role would have a screen reader announce the same number twice.
 */
const FILL = {
  pale: "bg-brand-pale",
  brand: "bg-brand",
  positive: "bg-positive",
} as const;

export function ProgressBar({
  value,
  accent,
  className,
}: {
  value: number;
  accent: Stage["accent"];
  className?: string;
}) {
  return (
    <div
      aria-hidden="true"
      className={cn("bg-well h-1 w-full overflow-hidden rounded-full", className)}
    >
      <div className={cn("h-full rounded-full", FILL[accent])} style={{ width: `${value}%` }} />
    </div>
  );
}
