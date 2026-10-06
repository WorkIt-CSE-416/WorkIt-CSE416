import { COLUMNS } from "../applications/data";

/**
 * The seeker Dashboard's fixtures: the headline numbers and activity per
 * window, what is waiting, and Up Next. All of it stands in for the
 * application tracker, which has no backend yet;
 * New Matches and the profile strength card read the live API instead and
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
    { label: "Applications", value: 5, previous: 7 },
    { label: "Response Rate", value: 40, previous: 29, suffix: "%" },
    { label: "Interviews", value: 1, previous: 1 },
    { label: "Offers", value: 0, previous: 0 },
  ],
  month: [
    { label: "Applications", value: 18, previous: 12 },
    { label: "Response Rate", value: 33, previous: 25, suffix: "%" },
    { label: "Interviews", value: 3, previous: 1 },
    { label: "Offers", value: 1, previous: 0 },
  ],
  season: [
    { label: "Applications", value: 42, previous: null },
    { label: "Response Rate", value: 29, previous: null, suffix: "%" },
    { label: "Interviews", value: 5, previous: null },
    { label: "Offers", value: 1, previous: null },
  ],
};

/* Activity --------------------------------------------------------------- */

export type ActivityPoint = { label: string; count: number };

/** Applications per day this week, and per week over the longer windows. The
 *  goal is weekly, so the week view carries no goal line: five a day is not
 *  the ask. */
export const ACTIVITY: Record<RangeKey, { points: ActivityPoint[]; goal: number | null }> = {
  week: {
    goal: null,
    points: [
      { label: "Mon", count: 2 },
      { label: "Tue", count: 0 },
      { label: "Wed", count: 1 },
      { label: "Thu", count: 2 },
      { label: "Fri", count: 0 },
      { label: "Sat", count: 0 },
      { label: "Sun", count: 0 },
    ],
  },
  month: {
    goal: 5,
    points: [
      { label: "Sep 8", count: 3 },
      { label: "Sep 15", count: 4 },
      { label: "Sep 22", count: 6 },
      { label: "Sep 29", count: 5 },
    ],
  },
  season: {
    goal: 5,
    points: [
      { label: "Aug 4", count: 2 },
      { label: "Aug 11", count: 3 },
      { label: "Aug 18", count: 5 },
      { label: "Aug 25", count: 4 },
      { label: "Sep 1", count: 6 },
      { label: "Sep 8", count: 3 },
      { label: "Sep 15", count: 4 },
      { label: "Sep 22", count: 6 },
      { label: "Sep 29", count: 5 },
      { label: "Oct 6", count: 4 },
    ],
  },
};

/* Waiting to Hear Back -------------------------------------------------- */

export type WaitBucket = { label: string; count: number; tone: "fresh" | "due" | "stale" };

/** Applications with no reply yet, by how long they have waited, as of today
 *  rather than per window: they add up to the season's 42 sent less the 12
 *  that heard back. Past two weeks is when a follow-up is worth sending. */
export const WAITING: WaitBucket[] = [
  { label: "0–7 days", count: 6, tone: "fresh" },
  { label: "8–14 days", count: 9, tone: "fresh" },
  { label: "15–30 days", count: 11, tone: "due" },
  { label: "30+ days", count: 4, tone: "stale" },
];

/* Up Next ---------------------------------------------------------------- */

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
 *  Within a kind they keep the board's own order. The chosen five are then
 *  shown in KIND_ORDER, not in the order they were picked: the interleave put
 *  the second interview last, under a nudge. With this fixture that also reads
 *  soonest first; sort by real timestamps once the tracker supplies them. */
const SHOWN = 5;
const byKind = KIND_ORDER.map((kind) => ALL_NEXT.filter((item) => item.kind === kind));
export const UP_NEXT: UpNextItem[] = Array.from(
  { length: Math.max(...byKind.map((items) => items.length)) },
  (_, round) => byKind.flatMap((items) => (items[round] ? [items[round]] : [])),
)
  .flat()
  .slice(0, SHOWN)
  .sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind));
