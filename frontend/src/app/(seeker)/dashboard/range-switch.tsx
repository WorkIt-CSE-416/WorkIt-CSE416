import { SegmentedLinks } from "../segmented-links";
import { RANGES, type RangeKey } from "./data";

/**
 * The window the Dashboard reports on: This Week, 30 Days, or the whole
 * recruiting season, as links on ?range= (../segmented-links.tsx), so a
 * window is shareable, survives a reload, and costs no JavaScript — the page
 * re-renders on the server with the new figures.
 */
export function RangeSwitch({ current }: { current: RangeKey }) {
  return (
    <SegmentedLinks
      label="Time Range"
      current={current}
      options={RANGES.map(({ key, label }) => ({
        key,
        label,
        href: key === "week" ? "/dashboard" : `/dashboard?range=${key}`,
      }))}
    />
  );
}
