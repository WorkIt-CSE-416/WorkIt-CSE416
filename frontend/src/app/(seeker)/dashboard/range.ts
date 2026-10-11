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

/** The day the Season range starts, its "Since Aug 4": fall recruiting opens
 *  in early August. The month is 0-based, as Date.UTC takes it. */
const SEASON_START = { month: 7, day: 4 };

/** How many days a range reaches back from `now`, for a count the API takes
 *  in days (GET /jobs/count?posted_within=). The season runs from the latest
 *  Aug 4, capped at the API's 365. */
export function rangeDays(key: RangeKey, now: Date): number {
  if (key === "week") return 7;
  if (key === "month") return 30;

  const year = now.getUTCFullYear();
  let start = Date.UTC(year, SEASON_START.month, SEASON_START.day);
  if (start > now.getTime()) start = Date.UTC(year - 1, SEASON_START.month, SEASON_START.day);
  return Math.min(365, Math.max(1, Math.ceil((now.getTime() - start) / 86_400_000)));
}

export function parseRange(value: string | string[] | null | undefined): RangeKey {
  return RANGES.some((range) => range.key === value) ? (value as RangeKey) : "week";
}

/** The Dashboard's URL for a range, leaving the default out. */
export function rangeHref(key: RangeKey) {
  return key === "week" ? "/dashboard" : `/dashboard?range=${key}`;
}
