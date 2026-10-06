import { cn } from "@/lib/cn";

import { STAGE_COLOR, type StageKey } from "../stage-colors";

/**
 * How far an application has moved through the pipeline.
 *
 * The fill takes the stage's own colour (../stage-colors.ts) — the same one
 * the board tints a column with and the Dashboard's funnel uses —
 * rather than the mockup's per-card palette. That mockup gives each project an
 * arbitrary colour (orange, pink, red, two blues); here the colour carries
 * meaning, so a full green bar reads as an offer at a glance and cannot be
 * mistaken for a long-running application.
 *
 * The track is --color-well rather than a border colour: at 25% the fill is
 * the whole signal, and against a border-weight track it all but vanished.
 * The mockup's track is near-white for the same reason.
 *
 * Decorative on purpose: the percentage sits in text directly above it, and a
 * progressbar role would have a screen reader announce the same number twice.
 */
export function ProgressBar({
  value,
  stage,
  className,
}: {
  value: number;
  stage: StageKey;
  className?: string;
}) {
  return (
    <div
      aria-hidden="true"
      className={cn("bg-well h-1 w-full overflow-hidden rounded-full", className)}
    >
      <div
        className={cn("h-full rounded-full", STAGE_COLOR[stage].fill)}
        style={{ width: `${value}%` }}
      />
    </div>
  );
}
