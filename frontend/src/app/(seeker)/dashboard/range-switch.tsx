import { SegmentedLinks } from "@/components/ui/segmented-control";

import { RANGES, type RangeKey } from "./data";

/**
 * The window the Dashboard reports on: This Week, 30 Days, or the whole
 * recruiting season, as links on ?range= (ui/segmented-control.tsx), so a
 * window is shareable and survives a reload: the page re-renders on the
 * server with the new figures, while the control's thumb slides ahead of it.
 */
export function RangeSwitch({ current }: { current: RangeKey }) {
  return (
    <SegmentedLinks
      label="Time Range"
      value={current}
      options={RANGES.map(({ key, label }) => ({
        value: key,
        label,
        href: key === "week" ? "/dashboard" : `/dashboard?range=${key}`,
      }))}
    />
  );
}
