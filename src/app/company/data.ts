/**
 * What the company dashboard renders, and the two counts its sidebar badges
 * read. Fixtures — swapping to real data touches this file and nothing else.
 */

export type Stat = {
  label: string;
  value: number;
  /** Optional change against a named period. */
  delta?: {
    value: number;
    period: string;
    /** Whether a rise is the good direction. More applicants: yes. More
     *  sitting unreviewed: no. Decides how the delta is coloured. */
    upIsGood: boolean;
  };
};

/**
 * The headline row. Four numbers, no chart: a handful of current values is a
 * KPI row of stat tiles, and drawing them as a grouped bar chart would make the
 * reader compare four things that have nothing to do with each other.
 */
export const STATS: Stat[] = [
  {
    label: "Open roles",
    value: 7,
    delta: { value: 2, period: "last month", upIsGood: true },
  },
  {
    label: "New applicants",
    value: 34,
    delta: { value: 12, period: "last week", upIsGood: true },
  },
  {
    label: "Awaiting your review",
    value: 18,
    delta: { value: 6, period: "last week", upIsGood: false },
  },
  {
    label: "Interviews this week",
    value: 5,
    delta: { value: -1, period: "last week", upIsGood: true },
  },
];

export type Stage = { name: string; count: number };

/**
 * Counts per stage across every open posting, widest first.
 *
 * One hue for every bar rather than a light-to-dark ramp across the stages.
 * Magnitude is already carried by length, so a ramp would be a second encoding
 * of the same number — and WorkIt has no designed sequential scale to draw it
 * from. --color-brand-pale and --color-brand sit far apart with nothing
 * between, so any ramp built from today's tokens would step unevenly and imply
 * a precision the palette does not have. A proper scale is a designer's call;
 * see the chart note in globals.css.
 */
export const PIPELINE: Stage[] = [
  { name: "Applied", count: 214 },
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
 * Waiting on the company rather than on the applicant — the half of a pipeline
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

export type Applicant = {
  id: string;
  name: string;
  role: string;
  /** Hours since the application arrived. */
  hoursAgo: number;
  match: number;
};

export const RECENT_APPLICANTS: Applicant[] = [
  { id: "p1", name: "Amara Osei", role: "Frontend Engineer, New Grad", hoursAgo: 2, match: 94 },
  { id: "p2", name: "Devin Park", role: "Platform Engineer", hoursAgo: 5, match: 88 },
  { id: "p3", name: "Rosa Iglesias", role: "Data Analyst Intern", hoursAgo: 9, match: 81 },
  { id: "p4", name: "Tom Whitfield", role: "Frontend Engineer, New Grad", hoursAgo: 21, match: 77 },
];

/** Read by the sidebar badges in the company layout. */
export const OPEN_ROLES = 7;
export const UNREAD_APPLICANTS = 18;
