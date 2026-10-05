import { COLUMNS } from "../applications/data";

/**
 * The seeker Dashboard's fixtures: the headline numbers per window, and Up
 * next. Both stand in for the application tracker, which has no backend yet;
 * New matches and the profile strength card read the live API instead and
 * live beside the components that fetch them.
 *
 * UP NEXT IS DERIVED FROM THE BOARD'S OWN FIXTURE (../applications/data.ts),
 * not written again here, so the Dashboard and the board name the same
 * companies and the same dates. The season-level numbers below cannot come
 * from it: the board holds twelve cards, which is a week of a search, not a
 * season of one. When the tracker lands, both pages read it, and this file
 * becomes the fetch.
 */

export type RangeKey = "week" | "month" | "season";

export const RANGES: { key: RangeKey; label: string; period: string | null }[] = [
  { key: "week", label: "This week", period: "last week" },
  { key: "month", label: "30 days", period: "the 30 days before" },
  // A season has nothing before it to compare against, so no deltas.
  { key: "season", label: "Season", period: null },
];

export function parseRange(value: string | string[] | undefined): RangeKey {
  return RANGES.some((range) => range.key === value) ? (value as RangeKey) : "week";
}

/* Headline numbers ------------------------------------------------------- */

export type DashboardStat = {
  label: string;
  value: number;
  /** The same figure over the previous window; null where there is none. */
  previous: number | null;
  suffix?: string;
};

/** Applications sent, response rate, interviews and offers, per window. The
 *  rate is the share of applications that heard anything back at all, which
 *  is the number a student can most change (better targeting, referrals). */
export const STATS: Record<RangeKey, DashboardStat[]> = {
  week: [
    { label: "Applications sent", value: 5, previous: 7 },
    { label: "Response rate", value: 40, previous: 29, suffix: "%" },
    { label: "Interviews", value: 1, previous: 1 },
    { label: "Offers", value: 0, previous: 0 },
  ],
  month: [
    { label: "Applications sent", value: 18, previous: 12 },
    { label: "Response rate", value: 33, previous: 25, suffix: "%" },
    { label: "Interviews", value: 3, previous: 1 },
    { label: "Offers", value: 1, previous: 0 },
  ],
  season: [
    { label: "Applications sent", value: 42, previous: null },
    { label: "Response rate", value: 29, previous: null, suffix: "%" },
    { label: "Interviews", value: 5, previous: null },
    { label: "Offers", value: 1, previous: null },
  ],
};

/* Up next ---------------------------------------------------------------- */

export type UpNextKind = "interview" | "offer" | "deadline" | "follow-up";

export type UpNextItem = {
  kind: UpNextKind;
  /** "Technical Interview" — the board's "Next: " prefix dropped. */
  title: string;
  role: string;
  company: string;
  when: string;
};

/** Which column's next step is which kind, and the order they lead in:
 *  someone waiting on you outranks a deadline, which outranks a nudge. */
const KIND_BY_COLUMN: Record<string, UpNextKind> = {
  Interviewing: "interview",
  Offer: "offer",
  Saved: "deadline",
  Applied: "follow-up",
};
const KIND_ORDER: UpNextKind[] = ["interview", "offer", "deadline", "follow-up"];

const ALL_NEXT: UpNextItem[] = COLUMNS.flatMap((column) =>
  column.items
    .filter((item) => item.next)
    .map((item) => ({
      kind: KIND_BY_COLUMN[column.title] ?? "follow-up",
      title: item.next!.label.replace(/^Next:\s*/, ""),
      role: item.role,
      company: item.company,
      when: item.next!.when,
    })),
);

/** The next commitment on the board's cards, five at most, taken a kind at a
 *  time in KIND_ORDER — one of each, then a second of each — so a week full
 *  of interviews can't push a closing deadline off the list. Sorting by kind
 *  alone did exactly that: three interviews and two offers filled all five.
 *  Within a kind they keep the board's own order. */
const SHOWN = 5;
const byKind = KIND_ORDER.map((kind) => ALL_NEXT.filter((item) => item.kind === kind));
export const UP_NEXT: UpNextItem[] = Array.from(
  { length: Math.max(...byKind.map((items) => items.length)) },
  (_, round) => byKind.flatMap((items) => (items[round] ? [items[round]] : [])),
)
  .flat()
  .slice(0, SHOWN);
