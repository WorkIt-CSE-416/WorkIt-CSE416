import type { JobType, WorkStyle } from "./data";

/**
 * The job board's filters as they live in the URL, read by the server pages
 * (/jobs, /search) and written by the filter row (./filters). One module for
 * both, so the page fetches exactly what the row shows checked.
 *
 * The URL's names are `GET /jobs`' own (backend/app/routers/jobs.py), so a
 * page passes its query to the API as it stands: ?location= (repeated ISO
 * codes), ?work_style=, ?experience=, ?job_type= (repeated, any of),
 * ?posted_within= (days), and ?min_pay= with ?pay_per= (hour or year).
 *
 * READING DROPS WHAT THE API WOULD REFUSE. A value outside the options, a
 * malformed place or a 61st one is left out here rather than sent on, so a
 * stale or hand-edited link shows the feed filtered by what was valid in it,
 * not "Jobs aren't loading" with a Try Again that fails the same way.
 */

export type Level = "internship" | "new_grad";
export type PayPer = "hour" | "year";

export type FeedFilters = {
  places: string[];
  workStyles: WorkStyle[];
  levels: Level[];
  jobTypes: JobType[];
  /** 1, 7 or 30 from the row; null for any time. */
  postedWithin: number | null;
  /** In US dollars per `payPer`; null for any pay. */
  minPay: number | null;
  payPer: PayPer;
};

export const NO_FILTERS: FeedFilters = {
  places: [],
  workStyles: [],
  levels: [],
  jobTypes: [],
  postedWithin: null,
  minPay: null,
  payPer: "year",
};

/* Each facet's options, in the words ./format prints on the cards, so a
 * filter never names a value no card can carry. Job type and experience offer
 * the API's own values: "Internship" is a level, never a job type, and the
 * feed holds no "Experienced" roles. Date posted and salary are thresholds,
 * so those facets take one pick (`multiple` in ./filters); no pick is "any",
 * which is why neither list spells it out. Industry has no data behind it
 * and is not offered. */

export const WORKPLACE_OPTIONS: { value: WorkStyle; label: string }[] = [
  { value: "onsite", label: "On-Site" },
  { value: "hybrid", label: "Hybrid" },
  { value: "remote", label: "Remote" },
];

/** The career stage. Never a job type: that is how the job is set up. */
export const EXPERIENCE_OPTIONS: { value: Level; label: string }[] = [
  { value: "internship", label: "Internship" },
  { value: "new_grad", label: "New Grad" },
];

export const JOB_TYPE_OPTIONS: { value: JobType; label: string }[] = [
  { value: "full_time", label: "Full-Time" },
  { value: "part_time", label: "Part-Time" },
  { value: "contract", label: "Contract" },
];

export const DATE_POSTED_OPTIONS: { value: number; label: string }[] = [
  { value: 1, label: "Past 24 Hours" },
  { value: 7, label: "Past Week" },
  { value: 30, label: "Past Month" },
];

/** Picked from the feed's own pay (2026-10-09): an internship tops out around
 *  $48 an hour at the median, a new-grad role around $145k a year. */
export const PAY_OPTIONS: Record<PayPer, { value: number; label: string }[]> = {
  hour: [
    { value: 25, label: "$25+/hr" },
    { value: 35, label: "$35+/hr" },
    { value: 45, label: "$45+/hr" },
    { value: 60, label: "$60+/hr" },
  ],
  year: [
    { value: 80_000, label: "$80k+/yr" },
    { value: 100_000, label: "$100k+/yr" },
    { value: 120_000, label: "$120k+/yr" },
    { value: 150_000, label: "$150k+/yr" },
  ],
};

/** Every query key a filter writes, so a change can clear the old values. */
export const FILTER_KEYS = [
  "location",
  "work_style",
  "experience",
  "job_type",
  "posted_within",
  "min_pay",
  "pay_per",
] as const;

/** The API's ceiling on ?location= (routers/jobs.py) and its code shape. */
const MAX_PLACES = 60;
const PLACE = /^[A-Z]{2}(-[A-Z0-9]{1,3})?$/;
const MAX_PAY = 10_000_000;

type Params = Record<string, string | string[] | undefined>;

const all = (value: string | string[] | undefined) =>
  value == null ? [] : typeof value === "string" ? [value] : value;

const first = (value: string | string[] | undefined) => all(value)[0];

/** Each value once, in the options' order, keeping only the options' own. */
function pick<T>(value: string | string[] | undefined, options: { value: T }[]): T[] {
  const given = new Set(all(value));
  return options.map((o) => o.value).filter((v) => given.has(String(v)));
}

/** A page's search params as filters. See "READING DROPS" above. */
export function readFilters(params: Params): FeedFilters {
  const posted = Number(first(params.posted_within));
  const pay = Number(first(params.min_pay));
  return {
    places: [...new Set(all(params.location).filter((p) => PLACE.test(p)))].slice(0, MAX_PLACES),
    workStyles: pick(params.work_style, WORKPLACE_OPTIONS),
    levels: pick(params.experience, EXPERIENCE_OPTIONS),
    jobTypes: pick(params.job_type, JOB_TYPE_OPTIONS),
    postedWithin: DATE_POSTED_OPTIONS.some((o) => o.value === posted) ? posted : null,
    minPay: Number.isFinite(pay) && pay > 0 && pay <= MAX_PAY ? pay : null,
    payPer: first(params.pay_per) === "hour" ? "hour" : "year",
  };
}

/** The filters as query pairs, the API's names; nothing for an unset one. */
export function filterEntries(filters: FeedFilters): [string, string][] {
  return [
    ...filters.places.map((p): [string, string] => ["location", p]),
    ...filters.workStyles.map((w): [string, string] => ["work_style", w]),
    ...filters.levels.map((l): [string, string] => ["experience", l]),
    ...filters.jobTypes.map((t): [string, string] => ["job_type", t]),
    ...(filters.postedWithin != null
      ? [["posted_within", String(filters.postedWithin)] as [string, string]]
      : []),
    ...(filters.minPay != null
      ? [
          ["min_pay", String(filters.minPay)] as [string, string],
          ["pay_per", filters.payPer] as [string, string],
        ]
      : []),
  ];
}

/** `?location=US-CA&work_style=remote`, or "" for no filters. */
export function filtersQuery(filters: FeedFilters): string {
  const entries = filterEntries(filters);
  return entries.length ? `?${new URLSearchParams(entries)}` : "";
}

/** Whether any filter narrows the feed: what the empty state says depends on it. */
export function isFiltered(filters: FeedFilters): boolean {
  return filterEntries(filters).length > 0;
}
