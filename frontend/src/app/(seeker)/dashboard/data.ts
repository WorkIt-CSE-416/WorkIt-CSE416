import { getApplications, getNow } from "../applications/data";
import { countJobsPostedWithin } from "../jobs/listings";
import { upcomingEvents, type EventKind, type TrackerEvent } from "../tracker";
import { rangeDays, type RangeKey } from "./range";
import type { AppliedDay } from "./streak-model";

/**
 * The seeker Dashboard's fixtures: the headline numbers per window, the year
 * of applications behind Activity's streak, what is waiting, and Up Next. All
 * of it stands in for the application tracker, which has no backend yet.
 * New Roles (in `getHeadline`) reads the live job feed here; New Matches and
 * the profile strength card read the live API too, beside the components
 * that fetch them.
 *
 * UP NEXT IS DERIVED FROM THE TRACKER'S OWN FIXTURE (../applications/data.ts),
 * not written again here, so the Dashboard and the board name the same
 * companies and the same dates. The season-level numbers below cannot come
 * from it: the board holds twelve cards, which is a week of a search, not a
 * season of one. When the tracker lands, both pages read it, and this file
 * becomes the fetch.
 */

/* Headline numbers ------------------------------------------------------- */

export type StatKey = "applications" | "newRoles" | "interviews" | "saved";

export type DashboardStat = {
  key: StatKey;
  label: string;
  /** Null when its source couldn't be read: the tile shows a dash. */
  value: number | null;
  /** The same figure over the previous window; null where there is none. */
  previous: number | null;
  suffix?: string;
  /** Under the figure in place of a change, over the range's own note. */
  note?: string;
  /** Where the tile leads: only for a figure its destination agrees with. */
  href?: string;
};

/** Applications sent and interviews held, per window, with the window before
 *  it: the tracker's fixture until it has a backend. */
const APPLICATIONS: Record<RangeKey, [number, number | null]> = {
  week: [5, 7],
  month: [18, 12],
  season: [42, null],
};
const INTERVIEWS: Record<RangeKey, [number, number | null]> = {
  week: [1, 1],
  month: [3, 1],
  season: [5, null],
};

/** Where the Jobs page shows what New Roles counts. Its Date Posted filter
 *  offers a week and a month but no season, so Season opens the whole feed. */
const NEW_ROLES_HREF: Record<RangeKey, string> = {
  week: "/jobs?posted_within=7",
  month: "/jobs?posted_within=30",
  season: "/jobs",
};

/**
 * The four headline numbers for every range, in tile order: Applications,
 * New Roles, Interviews, Saved. New Roles and Saved replaced Response Rate and
 * Offers, which for a student sit near zero all season and only discouraged;
 * the two new ones are things a seeker can act on.
 *
 * New Roles is the live feed: what was posted in the range (GET /jobs/count),
 * against the window before it (twice the range, less the range). Saved is the
 * tracker's saved jobs not yet applied to, which is the same in every range.
 * Applications and Interviews stay fixtures until the tracker has a backend.
 */
export async function getHeadline(): Promise<Record<RangeKey, DashboardStat[]>> {
  const now = getNow();
  const [week, twoWeeks, month, twoMonths, season] = await Promise.all(
    [7, 14, 30, 60, rangeDays("season", now)].map(countJobsPostedWithin),
  );
  const before = (range: number | null, both: number | null) =>
    range != null && both != null ? both - range : null;
  const newRoles: Record<RangeKey, [number | null, number | null]> = {
    week: [week, before(week, twoWeeks)],
    month: [month, before(month, twoMonths)],
    season: [season, null],
  };
  const saved = getApplications().filter((app) => app.stage === "saved").length;

  const tiles = (range: RangeKey): DashboardStat[] => [
    {
      key: "applications",
      label: "Applications",
      value: APPLICATIONS[range][0],
      previous: APPLICATIONS[range][1],
    },
    {
      key: "newRoles",
      label: "New Roles",
      value: newRoles[range][0],
      previous: newRoles[range][1],
      href: NEW_ROLES_HREF[range],
    },
    {
      key: "interviews",
      label: "Interviews",
      value: INTERVIEWS[range][0],
      previous: INTERVIEWS[range][1],
    },
    {
      key: "saved",
      label: "Saved",
      value: saved,
      previous: null,
      note: "Not applied to yet",
      href: "/applications?stage=saved",
    },
  ];

  return { week: tiles("week"), month: tiles("month"), season: tiles("season") };
}

/* Activity --------------------------------------------------------------- */

/** How busy each month is, January first: fall recruiting (Aug–Nov) and the
 *  spring push (Jan–Feb) are the seasons, and summer goes to the internship. */
const SEASON = [0.5, 0.55, 0.4, 0.3, 0.15, 0.1, 0.15, 0.55, 0.7, 0.75, 0.6, 0.25];
/** Where the fixture's history starts. Every day draws its numbers in order
 *  from here, so a date keeps its count as the year slides forward. */
const EPOCH = Date.UTC(2025, 0, 1);
const DAY_MS = 86_400_000;
/** The longest year the streak's grid shows: 52 weeks back to a Sunday. */
const SHOWN_DAYS = 371;

/** mulberry32: small, fast, and the same numbers on every server. */
function seeded(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * The past year of applications for Activity's streak, one entry per day that
 * sent any, ending today in UTC (the streak itself ends on the viewer's today).
 * Seeded and walked from a fixed epoch, so every render agrees and a date never
 * changes its count. A day that sent something makes the next one likelier, so
 * habits run in streaks; weekends are quieter, and the odd marathon day lands.
 * Scaled to a student's pace: about 50 since the season started in August,
 * near the 42 the headline numbers above were written with, though the two
 * fixtures do not reconcile day by day.
 *
 * The tracker replaces it with one `{ date: appliedOn, count: 1 }` per sent
 * application; the streak adds a day's entries up itself.
 */
export function appliedDays(): AppliedDay[] {
  const end = Math.floor(Date.now() / DAY_MS) * DAY_MS;
  const random = seeded(2026);
  const days: AppliedDay[] = [];
  let applied = false;
  for (let ms = EPOCH; ms <= end; ms += DAY_MS) {
    const day = new Date(ms);
    const weekend = day.getUTCDay() === 0 || day.getUTCDay() === 6;
    const season = SEASON[day.getUTCMonth()];
    const chance: number = season * (applied ? 1.25 : 0.6) * (weekend ? 0.45 : 1);
    applied = random() < Math.min(0.92, chance);
    if (!applied) continue;
    const count =
      1 + Math.floor(-Math.log(1 - random()) * season * 1.5) + (random() < 0.015 ? 4 : 0);
    if (ms > end - SHOWN_DAYS * DAY_MS) {
      days.push({ date: day.toISOString().slice(0, 10), count });
    }
  }
  return days;
}

/* Waiting --------------------------------------------------------------- */

export type WaitBucket = { label: string; count: number; tone: "fresh" | "due" | "stale" };

/** Applications with no reply yet, by how long they have waited, as of today
 *  rather than per window: they add up to the season's 42 sent less the 12
 *  that heard back. Past two weeks is when a follow-up is worth sending.
 *
 *  One bucket per verdict, three in all. It was four, with under a week and
 *  one to two weeks as separate buckets, and the Dashboard drew them as two
 *  green columns side by side that read as a mistake. */
export const WAITING: WaitBucket[] = [
  { label: "Under 2 weeks", count: 15, tone: "fresh" },
  { label: "2–4 weeks", count: 11, tone: "due" },
  { label: "Over a month", count: 4, tone: "stale" },
];

/* Up Next ---------------------------------------------------------------- */

/** What Next Up and Up Next list: a tracker entry still ahead, with whose it
 *  is. Its kind picks its stage colour (KIND_STAGE in ../stage-colors.ts). */
export type UpNextItem = TrackerEvent;

/** The order kinds are taken in when choosing what to show: someone waiting
 *  on you outranks a deadline, which outranks a nudge. */
const KIND_ORDER: EventKind[] = ["interview", "offer", "deadline", "follow-up"];
const SHOWN = 5;

/**
 * What is coming up, five at most: the first becomes the violet Next Up card,
 * the rest the Up Next list.
 *
 * Chosen a kind at a time in KIND_ORDER (the soonest of each, then the
 * second soonest of each), so a week full of interviews can't push a closing
 * deadline off the list; taking the five soonest outright did exactly that.
 * The five chosen are then shown soonest first, by their real times, so Next
 * Up is always the very next thing whatever its kind.
 */
export function getUpNext(): UpNextItem[] {
  const upcoming = upcomingEvents(getApplications(), getNow());
  const byKind = KIND_ORDER.map((kind) => upcoming.filter((event) => event.kind === kind));
  const rounds = Math.max(0, ...byKind.map((events) => events.length));

  return Array.from({ length: rounds }, (_, round) =>
    byKind.flatMap((events) => (events[round] ? [events[round]] : [])),
  )
    .flat()
    .slice(0, SHOWN)
    .sort((a, b) => upcoming.indexOf(a) - upcoming.indexOf(b));
}

/** The stand-in logo of the application an Up Next item belongs to: the glyph
 *  the Applications board and detail panel draw in their company tile. */
export function companyIconOf(item: UpNextItem) {
  return getApplications().find((app) => app.id === item.applicationId)?.Icon;
}
