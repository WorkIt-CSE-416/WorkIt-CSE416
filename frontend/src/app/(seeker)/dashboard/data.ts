import { getApplications, getNow, getTracker } from "../applications/data";
import { getGoodMatchDates } from "../jobs/listings";
import { upcomingEvents, type EventKind, type TrackerEvent } from "../tracker";
import { rangeDays, type RangeKey } from "./range";

/**
 * The seeker Dashboard's data: the headline numbers per window, the year of
 * applications behind Activity's streak, what is waiting, and Up Next. Good
 * Matches (in `getHeadline`) reads the seeker's Best Match scores;
 * Applied, Saved and Activity read the live tracker (KAN-261,
 * KAN-342). Interviewing and Waiting have no source yet: the tracker stores
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

export type StatKey = "goodMatches" | "saved" | "applied" | "interviewing";

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
  /** Where the tile leads: every tile is a link (KAN-342). */
  href: string;
};

/** The lowest score Good Matches counts: Good Match and up in @/lib/match. */
const GOOD_MATCH = 65;

/** Where the Jobs page shows what Good Matches counts, best first. Its Date
 *  Posted filter offers a week and a month but no season, so Season opens
 *  the whole Best Match list. */
const GOOD_MATCHES_HREF: Record<RangeKey, string> = {
  week: "/jobs?sort=match&posted_within=7",
  month: "/jobs?sort=match&posted_within=30",
  season: "/jobs?sort=match",
};

/** Under Good Matches in place of a change. */
const GOOD_MATCHES_NOTE: Record<RangeKey, string> = {
  week: "Posted this week",
  month: "Posted in 30 days",
  season: "Posted since Aug 4",
};

/**
 * The four headline numbers for every range, in tile order: Good Matches,
 * Saved, Applied, Interviewing. Each tile links to the page that lists
 * what it counts (KAN-342).
 *
 * THE TRACKER'S TILES ARE NAMED FOR ITS STAGES, the Status filter each one
 * opens: Saved, Applied, Interviewing. Applied was "Applications", the same
 * word as the page it opened (now the Applications Tracker), and Interviewing was
 * "Interviews".
 *
 * THE ORDER IS THE SEARCH, LEFT TO RIGHT: find a job, save it, apply, hear
 * back, the order of the Applications Tracker's stages and the landing page's
 * route. The left half is what is left to do and the right half how it is
 * going, which holds in the 2 x 2 grid on a phone too. Interviewing, a dash
 * until the tracker stores it, sits last as the outcome rather than as a gap
 * in the middle. The order was Applications, New Roles, Interviews, Saved,
 * which read sent, then find, then outcome, then shortlist.
 *
 * GOOD MATCHES WEARS THE VIOLET FILL, where the next application starts: the
 * eye lands on the head of the search and reads on from there. Applied
 * wore it until the reorder, as the number the seeker wholly controls; the
 * user moved it, since a seeker comes to the Dashboard to find what to apply
 * to next. A violet 0 is the cost on a week with no good matches.
 *
 * Good Matches is the job postings from the range that score Good Match or
 * better for this seeker (GOOD_MATCH), from the Best Match scores
 * (GET /jobs/recommended). It replaced New Roles, a count of every posting
 * in the feed, which said nothing about the seeker and drew a red change
 * whenever employers posted less. It shows no change: the score fades with
 * a posting's age, so last week's postings would always count fewer. With
 * an empty experience bank there is nothing to score, so the tile asks for
 * the bank instead. The tile opens the Jobs page in Best Match order, where
 * those jobs come first; Top Matches under the numbers (./top-matches.tsx)
 * shows the best three whatever their score.
 *
 * Applied counts the tracker's applications sent in the range, against
 * the same length of days before it. Saved is the seeker's live saved jobs
 * not yet applied to (KAN-261), the same in every range. Both are a dash
 * when the tracker can't be read.
 *
 * Interviewing is always a dash for now: the API stores no interviewing stage,
 * and a 0 would say the seeker had none. Count `stage === "interviewing"`
 * here once getTracked asks for that stage.
 */
export async function getHeadline(): Promise<Record<RangeKey, DashboardStat[]>> {
  const now = getNow();
  const seasonDays = rangeDays("season", now);
  const [matched, tracker] = await Promise.all([
    getGoodMatchDates(Math.max(30, seasonDays), GOOD_MATCH),
    getTracker(),
  ]);
  /** Good matches posted in the last `days` days; null without scores. */
  const goodMatches = (days: number) =>
    Array.isArray(matched)
      ? matched.filter((at) => now.getTime() - Date.parse(at) < days * DAY_MS).length
      : null;
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
    season: [sent(seasonDays), null],
  };

  const tiles = (range: RangeKey): DashboardStat[] => [
    {
      key: "goodMatches",
      label: "Good Matches",
      value: goodMatches(rangeDays(range, now)),
      previous: null,
      ...(matched === "empty"
        ? { note: "Add your experience first", href: "/bank" }
        : { note: matched ? GOOD_MATCHES_NOTE[range] : undefined, href: GOOD_MATCHES_HREF[range] }),
    },
    {
      key: "saved",
      label: "Saved",
      value: saved,
      previous: null,
      note: "Not applied to yet",
      href: "/applications?stage=saved",
    },
    {
      key: "applied",
      label: "Applied",
      value: applications[range][0],
      previous: applications[range][1],
      href: "/applications?stage=applied",
    },
    {
      key: "interviewing",
      label: "Interviewing",
      value: null,
      previous: null,
      note: "Not tracked yet",
      href: "/applications?stage=interviewing",
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
