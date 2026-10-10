import type { JobType, WorkStyle } from "./data";

/**
 * The job board's filters as they live in the URL, read by the server pages
 * (/jobs, /search) and written by the filter row (./filters). One module for
 * both, so the page fetches exactly what the row shows checked.
 *
 * The URL's names are `GET /jobs`' own (backend/app/routers/jobs.py), so a
 * page passes its query to the API as it stands: ?location= (repeated ISO
 * codes), ?work_style=, ?role=, ?experience=, ?job_type= (repeated, any of),
 * ?posted_within= (days), ?min_pay= and ?max_pay= with ?pay_per= (hour or
 * year, a range either end of which may be open), ?start_term= (seasons,
 * "summer-2027", repeated) and ?visa= (sponsors or not_ruled_out).
 *
 * READING DROPS WHAT THE API WOULD REFUSE. A value outside the options, a
 * malformed place or a 61st one is left out here rather than sent on, so a
 * stale or hand-edited link shows the feed filtered by what was valid in it,
 * not "Jobs aren't loading" with a Try Again that fails the same way.
 */

export type Level = "internship" | "new_grad";
/** A role's discipline, as the scraper reads it from the title (KAN-171). */
export type Role = "software" | "data_ai" | "product" | "quant" | "hardware";
export type PayPer = "hour" | "year";
export type Visa = "sponsors" | "not_ruled_out";

export type FeedFilters = {
  places: string[];
  workStyles: WorkStyle[];
  /** None is every discipline. */
  roles: Role[];
  levels: Level[];
  jobTypes: JobTypeKey[];
  /** 1, 7 or 30 from the row; null for any time. */
  postedWithin: number | null;
  /** A pay range in US dollars per `payPer`; null leaves that end open. A
   *  posting matches when its own range overlaps it. */
  minPay: number | null;
  maxPay: number | null;
  payPer: PayPer;
  /** Seasons as GET /jobs/facets lists them: "summer-2027", or a bare year
   *  ("2027") for postings that name no season. */
  startTerms: string[];
  visa: Visa | null;
};

export const NO_FILTERS: FeedFilters = {
  places: [],
  workStyles: [],
  roles: [],
  levels: [],
  jobTypes: [],
  postedWithin: null,
  minPay: null,
  maxPay: null,
  payPer: "year",
  startTerms: [],
  visa: null,
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

/** The SimplifyJobs lists' five categories, which the scraper's boards come
 *  from, in their names and order. One per role; no pick shows them all. */
export const ROLE_OPTIONS: { value: Role; label: string }[] = [
  { value: "software", label: "Software Engineering" },
  { value: "data_ai", label: "Data Science, AI & ML" },
  { value: "product", label: "Product Management" },
  { value: "quant", label: "Quantitative Finance" },
  { value: "hardware", label: "Hardware Engineering" },
];

/** The career stage. Internship is also a job type (JOB_TYPE_OPTIONS): the
 *  card shows it there, so both filters offer it. */
export const EXPERIENCE_OPTIONS: { value: Level; label: string }[] = [
  { value: "internship", label: "Internship" },
  { value: "new_grad", label: "New Grad" },
];

/** A job type as the card shows it: how a job is set up, and "Internship" for
 *  every internship whatever its hours (KAN-171, as Jobright does). The API
 *  matches Full-Time and the rest among the jobs that aren't internships, so
 *  a card never says "Internship" under a Full-Time filter. */
export type JobTypeKey = JobType | "internship";

export const JOB_TYPE_OPTIONS: { value: JobTypeKey; label: string }[] = [
  { value: "full_time", label: "Full-Time" },
  { value: "part_time", label: "Part-Time" },
  { value: "contract", label: "Contract" },
  { value: "internship", label: "Internship" },
];

export const DATE_POSTED_OPTIONS: { value: number; label: string }[] = [
  { value: 1, label: "Past 24 Hours" },
  { value: 7, label: "Past Week" },
  { value: 30, label: "Past Month" },
];

/** "Sponsors Visas" keeps postings that say they sponsor (a few percent of the
 *  feed); "Hide Jobs That Rule Me Out" drops the ones that say they don't, or
 *  want US citizens only, and keeps the many that say nothing (KAN-168). */
export const VISA_OPTIONS: { value: Visa; label: string }[] = [
  { value: "sponsors", label: "Sponsors Visas" },
  { value: "not_ruled_out", label: "Hide Jobs That Rule Me Out" },
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
  "role",
  "experience",
  "job_type",
  "posted_within",
  "min_pay",
  "max_pay",
  "pay_per",
  "start_term",
  "visa",
] as const;

/** The API's ceiling on ?location= (routers/jobs.py) and its code shape. */
const MAX_PLACES = 60;
const PLACE = /^[A-Z]{2}(-[A-Z0-9]{1,3})?$/;
const MAX_PAY = 10_000_000;
/** The API's shape and limit for ?start_term= (routers/jobs.py SeasonKey). */
const SEASON = /^((winter|spring|summer|fall)-)?20[0-9]{2}$/;
const MAX_SEASONS = 12;

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
  const amount = (value: string | string[] | undefined) => {
    const n = Number(first(value));
    return Number.isFinite(n) && n > 0 && n <= MAX_PAY ? n : null;
  };
  // A range typed backwards is still the range meant.
  const [minPay, maxPay] = [amount(params.min_pay), amount(params.max_pay)].sort((a, b) =>
    a != null && b != null ? a - b : 0,
  );
  return {
    places: [...new Set(all(params.location).filter((p) => PLACE.test(p)))].slice(0, MAX_PLACES),
    workStyles: pick(params.work_style, WORKPLACE_OPTIONS),
    roles: pick(params.role, ROLE_OPTIONS),
    levels: pick(params.experience, EXPERIENCE_OPTIONS),
    jobTypes: pick(params.job_type, JOB_TYPE_OPTIONS),
    postedWithin: DATE_POSTED_OPTIONS.some((o) => o.value === posted) ? posted : null,
    minPay,
    maxPay,
    payPer: first(params.pay_per) === "hour" ? "hour" : "year",
    startTerms: [...new Set(all(params.start_term).filter((t) => SEASON.test(t)))].slice(
      0,
      MAX_SEASONS,
    ),
    visa: pick(params.visa, VISA_OPTIONS)[0] ?? null,
  };
}

/** The filters as query pairs, the API's names; nothing for an unset one. */
export function filterEntries(filters: FeedFilters): [string, string][] {
  return [
    ...filters.places.map((p): [string, string] => ["location", p]),
    ...filters.workStyles.map((w): [string, string] => ["work_style", w]),
    ...filters.roles.map((r): [string, string] => ["role", r]),
    ...filters.levels.map((l): [string, string] => ["experience", l]),
    ...filters.jobTypes.map((t): [string, string] => ["job_type", t]),
    ...(filters.postedWithin != null
      ? [["posted_within", String(filters.postedWithin)] as [string, string]]
      : []),
    ...(filters.minPay != null ? [["min_pay", String(filters.minPay)] as [string, string]] : []),
    ...(filters.maxPay != null ? [["max_pay", String(filters.maxPay)] as [string, string]] : []),
    ...(filters.minPay != null || filters.maxPay != null
      ? [["pay_per", filters.payPer] as [string, string]]
      : []),
    ...filters.startTerms.map((t): [string, string] => ["start_term", t]),
    ...(filters.visa != null ? [["visa", filters.visa] as [string, string]] : []),
  ];
}

/** `?location=US-CA&work_style=remote`, or "" for no filters. */
export function filtersQuery(filters: FeedFilters): string {
  const entries = filterEntries(filters);
  return entries.length ? `?${new URLSearchParams(entries)}` : "";
}

/** How many roles a page of the feed holds: what /jobs and /search draw
 *  first, and what each Load More adds. */
export const PAGE_SIZE = 50;

/** The filters plus /search's words (`q`, matched by the API in the title or
 *  company name), as the query a page of the feed is asked for with. */
export function feedQuery(filters: FeedFilters, q = ""): string {
  const entries = filterEntries(filters);
  if (q) entries.push(["q", q]);
  return entries.length ? `?${new URLSearchParams(entries)}` : "";
}

/** The query's own `q`, as feedQuery wrote it: trimmed, and capped at the
 *  API's 200 characters so a long one narrows rather than errors. */
export function readQuery(params: Params): string {
  return (first(params.q) ?? "").trim().slice(0, 200);
}

/** Whether any filter narrows the feed: what the empty state says depends on it. */
export function isFiltered(filters: FeedFilters): boolean {
  return filterEntries(filters).length > 0;
}

/** A Start Date option's words: "summer-2027" is "Summer 2027", and a bare year
 *  says its season isn't stated. */
export function seasonLabel(key: string): string {
  const [season, year] = key.includes("-") ? key.split("-") : [null, key];
  return season
    ? `${season[0].toUpperCase()}${season.slice(1)} ${year}`
    : `${year} (Season Not Stated)`;
}
