"use client";

import { useShallowParams } from "@/components/shallow-routing";
import { SegmentedLinks } from "@/components/ui/segmented-control";

import { parseRange, rangeHref, RANGES } from "./range";

/** The range the page is showing (components/shallow-routing.tsx), so
 *  everything that follows it redraws the moment the switch moves. */
export function useRange() {
  return parseRange(useShallowParams().get("range"));
}

/**
 * The window the Dashboard reports on: This Week, 30 Days, or the whole
 * recruiting season, kept in ?range= (ui/segmented-control.tsx), so a window
 * is shareable and survives a reload.
 *
 * IT MOVES THE URL IN PLACE (`shallow`), not to the server. The headline
 * numbers (./headline.tsx) and the chart (./activity.tsx) are handed every
 * range up front and read ?range= themselves, so a new range counts its
 * figures and redraws its line with the thumb. As a link to the server, the
 * thumb arrived and the numbers followed a round trip later.
 */
export function RangeSwitch() {
  return (
    <SegmentedLinks
      shallow
      label="Time Range"
      value={useRange()}
      options={RANGES.map(({ key, label }) => ({ value: key, label, href: rangeHref(key) }))}
    />
  );
}
