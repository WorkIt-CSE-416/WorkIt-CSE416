/**
 * What the company dashboard renders. Fixtures — swapping to real data touches
 * this file and nothing else.
 *
 * It also held OPEN_ROLES and UNREAD_APPLICANTS until the sidebar stopped
 * drawing counts beside its nav rows. Nothing here is read by the shell now.
 */

/**
 * One tile in the headline row.
 *
 * `scope` is the stock-versus-flow distinction the date picker turns on, and it
 * is the reason this is a union rather than one shape with an optional field.
 *
 *   "today" — a snapshot. How many roles are open, how many applications sit
 *   unreviewed. The number is what it is right now, so the fixture carries it
 *   and the range does not touch it. Its `delta` is still a comparison against
 *   a named period, which is a different thing from being measured over one.
 *
 *   "range" — a flow. Applications received during the selected window, which
 *   only exists once a window is chosen, so there is no value to write here.
 *   ./stats-row.tsx computes it from APPLICATIONS_BY_DAY.
 *
 * Making the value ABSENT rather than a placeholder is the point: a flow stat
 * with a hardcoded number is the bug this models away, because it renders
 * plausibly no matter what the picker says.
 *
 * See the long note at the top of ./range.tsx for why only flows scope.
 */
type StatBase = {
  label: string;
  /**
   * Which glyph sits in the tile's top corner.
   *
   * A KEY, NOT A COMPONENT. Holding the icon itself would make this fixtures
   * file import from src/components and decide what a stat looks like, which
   * is the one thing a data file should not do — ./stat-tile.tsx resolves the
   * key to a glyph. Keying off `label` instead would work until the day
   * somebody rewords a label and silently loses an icon.
   */
  icon: "roles" | "applicants" | "review" | "interviews";
};

/** A change against a named period. */
export type Delta = {
  value: number;
  period: string;
  /** Whether a rise is the good direction. More applicants: yes. More sitting
   *  unreviewed: no. Decides how the delta is coloured. */
  upIsGood: boolean;
};

export type Stat =
  (StatBase & { scope: "today"; value: number; delta?: Delta }) | (StatBase & { scope: "range" });

/**
 * The headline row. Four numbers, no chart: a handful of current values is a
 * KPI row of stat tiles, and drawing them as a grouped bar chart would make the
 * reader compare four things that have nothing to do with each other.
 */
export const STATS: Stat[] = [
  {
    label: "Open roles",
    scope: "today",
    value: 7,
    icon: "roles",
    delta: { value: 2, period: "last month", upIsGood: true },
  },
  /* The only flow in the row, and the only tile the picker changes. */
  { label: "New applicants", scope: "range", icon: "applicants" },
  {
    label: "Awaiting your review",
    scope: "today",
    value: 18,
    icon: "review",
    delta: { value: 6, period: "last week", upIsGood: false },
  },
  {
    label: "Interviews this week",
    scope: "today",
    value: 5,
    icon: "interviews",
    delta: { value: -1, period: "last week", upIsGood: true },
  },
];

export type StageReach = { name: string; count: number };

/**
 * How many applications have EVER REACHED each stage, widest first.
 *
 * CUMULATIVE, not disjoint: a count here is everyone who ever reached that
 * stage, so somebody sitting in an interview today is counted in Applied,
 * Screening and Interview alike. That is what makes "25% of applied" a
 * conversion rather than a share — and it is also why these four numbers can
 * never be drawn as parts of one whole. They total 368 across a 271-application
 * pipeline, because three of the four count some of the same people.
 *
 * STATUS_BY_ROLE below is the same set cut so that it does sum: one applicant,
 * one current stage. The note there works the reconciliation both ways.
 *
 * NOT DRAWN AS A CHART ANY MORE. This was four bars on /company until the ring
 * replaced them, and it is now the source of one sentence — the conversion
 * rates under the ring's legend, which are the only thing the cumulative cut
 * can say that the disjoint one cannot. See ./status-ring.tsx.
 *
 * WHY APPLIED IS 271 AND NOT THE 214 IT USED TO SAY: nothing in the repo
 * could produce 214. The five Open postings in jobs/data.ts carry
 * 86 + 41 + 63 + 27 + 54 = 271 applicants between them, and no other reading
 * lands on 214 either — adding the Paused posting gives 289, and the Closed one
 * is another 112. It was a number with no source, which stopped being harmless
 * the moment a second chart on the same screen decomposed it.
 */
export const STAGE_REACH: StageReach[] = [
  { name: "Applied", count: 271 },
  { name: "Screening", count: 68 },
  { name: "Interview", count: 23 },
  { name: "Offer", count: 6 },
];

export type Attention = {
  id: string;
  role: string;
  need: string;
  /** Whole days the item has been waiting on the company. */
  waitingDays: number;
};

/**
 * Waiting on the company rather than on the applicant — the half of the queue
 * a recruiter can actually clear today.
 */
export const NEEDS_ATTENTION: Attention[] = [
  {
    id: "a1",
    role: "Frontend Engineer, New Grad",
    need: "6 applicants unreviewed past SLA",
    waitingDays: 4,
  },
  { id: "a2", role: "Data Analyst Intern", need: "Interview feedback missing", waitingDays: 3 },
  { id: "a3", role: "Platform Engineer", need: "Offer approval pending", waitingDays: 2 },
];

/**
 * A row in the dashboard's arrivals feed.
 *
 * Named for the feed rather than for the person because applicants/data.ts now
 * owns `Applicant` — the full record behind the table, with a stage, a location
 * and a date. This is the same human seen from the overview screen, carrying
 * only what a feed row shows. Two names beat one name meaning two shapes.
 */
export type RecentApplicant = {
  id: string;
  name: string;
  role: string;
  /** Hours since the application arrived. */
  hoursAgo: number;
  match: number;
};

export const RECENT_APPLICANTS: RecentApplicant[] = [
  { id: "p1", name: "Amara Osei", role: "Frontend Engineer, New Grad", hoursAgo: 2, match: 94 },
  { id: "p2", name: "Devin Park", role: "Platform Engineer", hoursAgo: 5, match: 88 },
  { id: "p3", name: "Rosa Iglesias", role: "Data Analyst Intern", hoursAgo: 9, match: 81 },
  { id: "p4", name: "Tom Whitfield", role: "Frontend Engineer, New Grad", hoursAgo: 21, match: 77 },
];

/* ---------------------------------------------------------------------------
 * Dashboard charts
 *
 * What the overview draws as marks rather than as text. Everything here
 * reconciles with the fixtures the rest of /company already renders: the role
 * totals are jobs/data.ts's applicant counts, the stage totals sum to
 * STAGE_REACH's first number, and the trend's last seven days are the "New
 * applicants" tile's 34. A dashboard whose two charts disagree teaches a reader
 * to trust neither, and fixtures are where that starts.
 * ------------------------------------------------------------------------- */

/** One day's arrivals. ISO date, so it sorts and formats as a date. */
export type DayCount = { date: string; count: number };

/**
 * Applications per day across the five Open postings, ninety days back from
 * 2026-09-02.
 *
 * GENERATED, NOT HAND-WRITTEN, and deliberately a literal rather than a
 * function. A series built at module scope from Math.random renders one set of
 * numbers on the server and a different set in the browser, and React reports
 * that as a hydration mismatch — the chart is the one place in this app where
 * that would happen, because it is the only fixture long enough that nobody
 * would write it out by hand.
 *
 * Three sums are exact rather than approximate, so the chart cannot contradict
 * the tiles above it:
 *   last 7 days      34   = STATS "New applicants"
 *   previous 7 days  22   = the +12 that tile reports against last week
 *   all 90 days      271  = applicants across the five Open postings
 *
 * The shape is a weekday rhythm (people apply from work; Sunday is the floor)
 * over a quarter of rising intake, with a burst decaying over about five days
 * after each posting went live — 01, 04, 11 and 19 August in jobs/data.ts. The
 * spikes line up with those dates on purpose: the trend is readable against the
 * postings list rather than being noise that merely looks plausible.
 */
export const APPLICATIONS_BY_DAY: DayCount[] = [
  { date: "2026-06-05", count: 2 },
  { date: "2026-06-06", count: 0 },
  { date: "2026-06-07", count: 0 },
  { date: "2026-06-08", count: 2 },
  { date: "2026-06-09", count: 2 },
  { date: "2026-06-10", count: 2 },
  { date: "2026-06-11", count: 2 },
  { date: "2026-06-12", count: 2 },
  { date: "2026-06-13", count: 1 },
  { date: "2026-06-14", count: 0 },
  { date: "2026-06-15", count: 2 },
  { date: "2026-06-16", count: 2 },
  { date: "2026-06-17", count: 3 },
  { date: "2026-06-18", count: 2 },
  { date: "2026-06-19", count: 2 },
  { date: "2026-06-20", count: 1 },
  { date: "2026-06-21", count: 0 },
  { date: "2026-06-22", count: 2 },
  { date: "2026-06-23", count: 3 },
  { date: "2026-06-24", count: 3 },
  { date: "2026-06-25", count: 3 },
  { date: "2026-06-26", count: 3 },
  { date: "2026-06-27", count: 1 },
  { date: "2026-06-28", count: 0 },
  { date: "2026-06-29", count: 3 },
  { date: "2026-06-30", count: 3 },
  { date: "2026-07-01", count: 3 },
  { date: "2026-07-02", count: 3 },
  { date: "2026-07-03", count: 2 },
  { date: "2026-07-04", count: 1 },
  { date: "2026-07-05", count: 0 },
  { date: "2026-07-06", count: 3 },
  { date: "2026-07-07", count: 4 },
  { date: "2026-07-08", count: 3 },
  { date: "2026-07-09", count: 3 },
  { date: "2026-07-10", count: 2 },
  { date: "2026-07-11", count: 1 },
  { date: "2026-07-12", count: 1 },
  { date: "2026-07-13", count: 3 },
  { date: "2026-07-14", count: 4 },
  { date: "2026-07-15", count: 3 },
  { date: "2026-07-16", count: 3 },
  { date: "2026-07-17", count: 3 },
  { date: "2026-07-18", count: 1 },
  { date: "2026-07-19", count: 1 },
  { date: "2026-07-20", count: 4 },
  { date: "2026-07-21", count: 4 },
  { date: "2026-07-22", count: 4 },
  { date: "2026-07-23", count: 4 },
  { date: "2026-07-24", count: 3 },
  { date: "2026-07-25", count: 1 },
  { date: "2026-07-26", count: 1 },
  { date: "2026-07-27", count: 3 },
  { date: "2026-07-28", count: 4 },
  { date: "2026-07-29", count: 4 },
  { date: "2026-07-30", count: 4 },
  { date: "2026-07-31", count: 3 },
  { date: "2026-08-01", count: 4 },
  { date: "2026-08-02", count: 2 },
  { date: "2026-08-03", count: 5 },
  { date: "2026-08-04", count: 8 },
  { date: "2026-08-05", count: 6 },
  { date: "2026-08-06", count: 7 },
  { date: "2026-08-07", count: 4 },
  { date: "2026-08-08", count: 2 },
  { date: "2026-08-09", count: 1 },
  { date: "2026-08-10", count: 5 },
  { date: "2026-08-11", count: 6 },
  { date: "2026-08-12", count: 6 },
  { date: "2026-08-13", count: 6 },
  { date: "2026-08-14", count: 5 },
  { date: "2026-08-15", count: 1 },
  { date: "2026-08-16", count: 1 },
  { date: "2026-08-17", count: 5 },
  { date: "2026-08-18", count: 5 },
  { date: "2026-08-19", count: 7 },
  { date: "2026-08-20", count: 5 },
  { date: "2026-08-21", count: 4 },
  { date: "2026-08-22", count: 1 },
  { date: "2026-08-23", count: 1 },
  { date: "2026-08-24", count: 3 },
  { date: "2026-08-25", count: 4 },
  { date: "2026-08-26", count: 4 },
  { date: "2026-08-27", count: 6 },
  { date: "2026-08-28", count: 5 },
  { date: "2026-08-29", count: 2 },
  { date: "2026-08-30", count: 1 },
  { date: "2026-08-31", count: 7 },
  { date: "2026-09-01", count: 7 },
  { date: "2026-09-02", count: 6 },
];

/* The windows the picker and the chart toggle offer used to live here as a
 * RANGES fixture of day counts. They moved to ./range.tsx once half of them
 * became calendar-relative — "This Month" is not a number of days, it is a
 * question about the calendar, and it belongs beside the code that answers it
 * rather than in a file of sample data. */

/** Stages an applicant can be sitting in, in funnel order. Mirrors
 *  applicants/data.ts's `Stage` — the same five states, seen per posting. */
export type RoleStage = "Applied" | "Screening" | "Interview" | "Offer" | "Rejected";

export type RoleStatus = { role: string } & Record<RoleStage, number>;

/**
 * Where every applicant on an Open posting is sitting right now.
 *
 * DISJOINT, unlike STAGE_REACH above: one applicant, one stage, so the segments
 * stack to the posting's own applicant count. That is what makes this cut a
 * part-to-whole and the other one a funnel, and it is why the two have
 * different first numbers — 189 applications are sitting untouched in Applied,
 * while 271 have ever been submitted.
 *
 * THE TWO RECONCILE, and the arithmetic is worth keeping because the next
 * person to read these files will assume one of them is wrong:
 *
 *   reached Interview  23  =  12 sitting + 6 gone to Offer + 5 rejected there
 *   reached Screening  68  =  37 sitting + 23 reached Interview + 8 rejected
 *   reached Applied   271  = 189 sitting + 68 reached Screening + 14 rejected
 *   Rejected           27  =  14 + 8 + 5, the three places people leave
 *
 * Row totals are jobs/data.ts's applicant counts, unchanged: 86, 63, 54, 41,
 * 27. Only the five postings with status "Open" are here — a Paused posting is
 * not taking applications, and a Draft has never been live, so including them
 * would put a row on the chart whose pipeline cannot move.
 *
 * Ordered by row total, widest first. The chart does not sort: a bar chart that
 * re-sorts itself on a data change makes a reader re-find every row.
 */
export const STATUS_BY_ROLE: RoleStatus[] = [
  {
    role: "Frontend Engineer, New Grad",
    Applied: 60,
    Screening: 12,
    Interview: 4,
    Offer: 2,
    Rejected: 8,
  },
  { role: "Data Analyst Intern", Applied: 45, Screening: 8, Interview: 3, Offer: 1, Rejected: 6 },
  {
    role: "Machine Learning Engineer",
    Applied: 36,
    Screening: 8,
    Interview: 3,
    Offer: 2,
    Rejected: 5,
  },
  { role: "Platform Engineer", Applied: 29, Screening: 5, Interview: 1, Offer: 1, Rejected: 5 },
  {
    role: "Site Reliability Engineer",
    Applied: 19,
    Screening: 4,
    Interview: 1,
    Offer: 0,
    Rejected: 3,
  },
];

/** Segment order for the stack, and the only place it is written down. */
export const ROLE_STAGES: RoleStage[] = ["Applied", "Screening", "Interview", "Offer", "Rejected"];

export type StageAge = {
  stage: RoleStage;
  /** Days the middle applicant in this stage has been sitting in it. */
  medianDays: number;
  /** The worst one, which is the number that actually makes someone act. */
  oldestDays: number;
};

/**
 * How long people are waiting, per stage.
 *
 * The chart form of "Needs your attention": that card names three specific
 * items, this says whether the delay is one bad week or the shape of the
 * process. Rejected is absent because nobody is waiting on a rejection — an
 * aging chart is about queues, and that stage is not one.
 *
 * Both numbers are drawn, median as the bar and oldest as a marker past it,
 * because a median alone hides the person who has been in a screen for a
 * fortnight and a maximum alone makes every stage look broken.
 */
export const STAGE_AGE: StageAge[] = [
  { stage: "Applied", medianDays: 3, oldestDays: 11 },
  { stage: "Screening", medianDays: 6, oldestDays: 14 },
  { stage: "Interview", medianDays: 9, oldestDays: 21 },
  { stage: "Offer", medianDays: 4, oldestDays: 8 },
];

export type Highlight = {
  label: string;
  value: string;
  /** Which way it moved. `null` when there is no prior period to compare. */
  direction: "up" | "down" | null;
  /** Whether the direction it moved is the direction you wanted. Time to hire
   *  falling is good; an accept rate falling is not. Same flag as Stat.delta. */
  upIsGood: boolean;
};

/**
 * Three measures the rail carries as text rather than as marks.
 *
 * Each is one current value, which the form heuristic answers with a figure and
 * not a chart — three sparklines here would be three charts competing with the
 * trend beside them, and none of them would be readable at rail width.
 *
 * `value` is a formatted string because the three carry different units — days,
 * a percentage, a score out of a hundred — and a number plus a unit prop would
 * be two fields to keep in step for no gain at four call sites.
 */
export const HIGHLIGHTS: Highlight[] = [
  { label: "Median time to hire", value: "24 days", direction: "down", upIsGood: false },
  { label: "Offer accept rate", value: "83%", direction: "up", upIsGood: true },
  { label: "Avg. match score", value: "79%", direction: "up", upIsGood: true },
];

/**
 * The rail's headline: everyone still in play across the Open postings.
 *
 * Derived rather than typed, so it cannot drift from the chart under it —
 * STATUS_BY_ROLE is the source and Rejected is what "still in play" excludes.
 */
export const ACTIVE_APPLICATIONS = STATUS_BY_ROLE.reduce(
  (total, { Applied, Screening, Interview, Offer }) =>
    total + Applied + Screening + Interview + Offer,
  0,
);

/**
 * Which chart slot paints each stage.
 *
 * The chart counterpart of applicants/data.ts's STAGE_TONE, and deliberately
 * the same reading of the same five states: Applied is inert, Screening and
 * Interview are the cheap and expensive halves of "in flight", Offer and
 * Rejected are the two ways it ends. A badge and a bar for one stage are the
 * same colour because globals.css points both at the same tokens — so the
 * stacked chart reads against the applicants table without a legend lookup.
 *
 * It lives here rather than inside a component because three charts colour by
 * stage, and a second copy would be right on the day it was written and wrong
 * the first time anyone retones a stage.
 *
 * Applied takes slot 5, the de-emphasis grey, which is the one slot that is not
 * an identity. That is not a shortage of hues — it is what Applied is. Nothing
 * has happened to those applications yet, and the stage should recede against
 * the four that represent a decision someone made.
 *
 * TWO SPELLINGS OF ONE FACT, and they have to sit on the same line to stay in
 * step. The HTML charts paint a div and want a Tailwind class; recharts paints
 * an SVG fill attribute and wants a CSS value, and its ChartConfig has nowhere
 * to put a class name. Deriving one from the other is not an option — a
 * template literal like `bg-chart-${slot}` is invisible to Tailwind's scanner,
 * so the utility is never generated and the segment paints nothing at all.
 * Adjacent literals are what makes a mismatch visible in review.
 */
export const STAGE_PAINT: Record<RoleStage, { fill: string; color: string }> = {
  Applied: { fill: "bg-chart-5", color: "var(--color-chart-5)" },
  Screening: { fill: "bg-chart-1", color: "var(--color-chart-1)" },
  Interview: { fill: "bg-chart-2", color: "var(--color-chart-2)" },
  Offer: { fill: "bg-chart-3", color: "var(--color-chart-3)" },
  Rejected: { fill: "bg-chart-4", color: "var(--color-chart-4)" },
};

/**
 * Current stage counts across the Open postings — STATUS_BY_ROLE's columns.
 *
 * Derived rather than written, so the ring and the stacked bars beside it are
 * the same numbers by construction. This is the disjoint cut, so it sums to
 * 271 and can honestly be drawn as parts of a whole; STAGE_REACH is the
 * cumulative one and cannot.
 */
export const STAGE_TOTALS = ROLE_STAGES.map((stage) => ({
  stage,
  count: STATUS_BY_ROLE.reduce((sum, row) => sum + row[stage], 0),
}));
