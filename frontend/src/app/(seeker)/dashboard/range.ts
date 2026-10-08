/**
 * The windows the Dashboard reports on, and how ?range= names them. Its own
 * module, free of the fixtures, because the browser reads the range too: the
 * switch, the headline numbers and the chart all follow ?range= in place
 * (./range-switch.tsx), and ./data.ts pulls in the tracker's server-side
 * fixture.
 */
export type RangeKey = "week" | "month" | "season";

export const RANGES: {
  key: RangeKey;
  label: string;
  /** What a delta is compared against; null where there is nothing before. */
  period: string | null;
  /** Under each headline number where there is no delta to show. */
  note?: string;
}[] = [
  { key: "week", label: "This Week", period: "last week" },
  { key: "month", label: "30 Days", period: "prior 30 days" },
  // A season has nothing before it to compare against, so no deltas.
  { key: "season", label: "Season", period: null, note: "Since Aug 4" },
];

export function parseRange(value: string | string[] | null | undefined): RangeKey {
  return RANGES.some((range) => range.key === value) ? (value as RangeKey) : "week";
}

/** The Dashboard's URL for a range, leaving the default out. */
export function rangeHref(key: RangeKey) {
  return key === "week" ? "/dashboard" : `/dashboard?range=${key}`;
}
