import { getApplications, getNow, getTracker } from "../applications/data";
import { countJobsPostedWithin } from "../jobs/listings";
import { upcomingEvents, type EventKind, type TrackerEvent } from "../tracker";
import { rangeDays, type RangeKey } from "./range";

/**
 * The seeker Dashboard's data: the headline numbers per window, the year of
 * applications behind Activity's streak, what is waiting, and Up Next. New
 * Roles (in `getHeadline`) reads the live job feed here; Applications, Saved
 * and Activity read the live tracker (KAN-261, KAN-342); New Matches and the
 * profile strength card read the live API too, beside the components that
 * fetch them. Interviews and Waiting have no source yet: the tracker stores
 * no stage past applied.
 *
 * UP NEXT IS DERIVED FROM THE TRACKER (../applications/data.ts), not written
 * again here, so the Dashboard and the board name the same companies and the
 * same dates. The tracker stores no dated events yet (interviews,
 * deadlines), so Up Next is empty and Next Up says the seeker is caught up.
 * Waiting's buckets below are still a fixture, archived with the tile
 * (page.tsx), until the tracker stores replies.
 */

const DAY_MS = 86_400_000;

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
 * against the window before it (twice the range, less the range).
 * Applications counts the tracker's applications sent in the range, against
 * the same length of days before it (KAN-342). Saved is the seeker's live
 * saved jobs not yet applied to (KAN-261), the same in every range. Both are
 * a dash when the tracker can't be read.
 *
 * Interviews is always a dash for now: the API stores no interviewing stage,
 * and a 0 would say the seeker had none. Count `stage === "interviewing"`
 * here once getTracked asks for that stage.
 */
export async function getHeadline(): Promise<Record<RangeKey, DashboardStat[]>> {
  const now = getNow();
  const [[week, twoWeeks, month, twoMonths, season], tracker] = await Promise.all([
    Promise.all([7, 14, 30, 60, rangeDays("season", now)].map(countJobsPostedWithin)),
    getTracker(),
  ]);
  const before = (range: number | null, both: number | null) =>
    range != null && both != null ? both - range : null;
  const newRoles: Record<RangeKey, [number | null, number | null]> = {
    week: [week, before(week, twoWeeks)],
    month: [month, before(month, twoMonths)],
    season: [season, null],
  };
  const apps = tracker.applications;
  const saved = apps && apps.filter((app) => app.stage === "saved").length;
  /** Applications sent between `to` and `from` days ago; null on a failed read. */
  const sent = (from: number, to = 0) =>
    apps &&
    apps.filter((app) => {
      if (!app.appliedOn) return false;
      const ago = (now.getTime() - Date.parse(app.appliedOn)) / DAY_MS;
      return ago >= to && ago < from;
    }).length;
  const applications: Record<RangeKey, [number | null, number | null]> = {
    week: [sent(7), sent(14, 7)],
    month: [sent(30), sent(60, 30)],
    season: [sent(rangeDays("season", now)), null],
  };

  const tiles = (range: RangeKey): DashboardStat[] => [
    {
      key: "applications",
      label: "Applications",
      value: applications[range][0],
      previous: applications[range][1],
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
      value: null,
      previous: null,
      note: "Not tracked yet",
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

/**
 * When each application in the tracker was sent, for Activity's streak: one
 * instant per sent application, or null when the tracker can't be read. The
 * streak turns each into the viewer's own day in the browser
 * (./streak.tsx), since the server's UTC day is a day off for the Americas.
 */
export async function getAppliedTimes(): Promise<string[] | null> {
  const { applications } = await getTracker();
  return applications && applications.flatMap((app) => (app.appliedOn ? [app.appliedOn] : []));
}

/* Waiting --------------------------------------------------------------- */

export type WaitBucket = { label: string; count: number; tone: "fresh" | "due" | "stale" };

/** Applications with no reply yet, by how long they have waited, as of today
 *  rather than per window. A fixture, archived with its tile (page.tsx).
 *  Past two weeks is when a follow-up is worth sending.
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
export async function getUpNext(): Promise<UpNextItem[]> {
  const upcoming = upcomingEvents(await getApplications(), getNow());
  const byKind = KIND_ORDER.map((kind) => upcoming.filter((event) => event.kind === kind));
  const rounds = Math.max(0, ...byKind.map((events) => events.length));

  return Array.from({ length: rounds }, (_, round) =>
    byKind.flatMap((events) => (events[round] ? [events[round]] : [])),
  )
    .flat()
    .slice(0, SHOWN)
    .sort((a, b) => upcoming.indexOf(a) - upcoming.indexOf(b));
}
