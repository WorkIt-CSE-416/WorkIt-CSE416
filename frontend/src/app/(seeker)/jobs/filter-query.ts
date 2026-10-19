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
 * "summer-2027", repeated), ?visa= (sponsors or not_ruled_out) and
 * ?auto_apply=true (only job postings auto apply can fill).
 *
 * READING DROPS WHAT THE API WOULD REFUSE. A value outside the options, a
 * malformed place or a 61st one is left out here rather than sent on, so a
 * stale or hand-edited link shows the feed filtered by what was valid in it,
 * not "Jobs aren't loading" with a Try Again that fails the same way.
 */

export type Level = "student" | "new_grad" | "experienced";
export type PayPer = "hour" | "year";
export type Visa = "sponsors" | "not_ruled_out";

export type FeedFilters = {
  places: string[];
  workStyles: WorkStyle[];
  /** `job_roles` slugs ("software_engineer"), any of them; none is every
   *  role. */
  roles: string[];
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
  /** All Filters' "Auto Apply Supported": only job postings whose hiring
   *  system auto apply fills (Greenhouse for now; the API decides, from
   *  `backend/app/auto_apply/hosts.py`). False shows every job posting. */
  autoApply: boolean;
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
  autoApply: false,
};

/* Each facet's options, in the words ./format prints on the cards, so a
 * filter never names a value no card can carry. Job type and experience offer
 * the API's own values: an internship is a job type, for a student (KAN-233).
 * The scraper keeps no experienced roles yet, so that option counts none for
 * now. Date posted and salary are thresholds,
 * so those facets take one pick (`multiple` in ./filters); no pick is "any",
 * which is why neither list spells it out. Industry has no data behind it
 * and is not offered. */

export const WORKPLACE_OPTIONS: { value: WorkStyle; label: string }[] = [
  { value: "onsite", label: "On-Site" },
  { value: "hybrid", label: "Hybrid" },
  { value: "remote", label: "Remote" },
];

/** A role is a `job_roles` slug ("software_engineer", KAN-155), the way GET
 *  /jobs?role= takes it. The options aren't listed here: the Role filter reads
 *  them, with their names, from GET /jobs/facets, since the list
 *  lives in the database (backend/app/models/CLAUDE.md, Job roles). So a
 *  role, like a place, is checked by its shape only, and one no job holds
 *  matches nothing. KAN-172's keys ("data_ai/ml") don't fit it, so an old
 *  link's role is dropped here rather than sent on to a 422. */
export type Role = string;
const ROLE = /^[a-z][a-z0-9_]{0,63}$/;
/** As the API caps ?role=. */
const MAX_ROLES = 60;

/** Who a job is for (KAN-233): a student (every internship), a new grad, or
 *  someone with experience. */
export const EXPERIENCE_OPTIONS: { value: Level; label: string }[] = [
  { value: "student", label: "Student" },
  { value: "new_grad", label: "New Grad" },
  { value: "experienced", label: "Experienced" },
];

/** How a job is set up. An internship is one of them (KAN-233), whatever
 *  hours its posting states, so a card never says "Internship" under a
 *  Full-Time filter. */
export type JobTypeKey = JobType;

/** A picked state narrows its country: United States and California is
 *  California, the same rule as the row's Location (ticksFrom/placesFrom in
 *  ./filters), so the two give one feed for the same picks. All Filters'
 *  Apply and onboarding's save both pass their picks through it. */
export function statesNarrowCountries(filters: FeedFilters): FeedFilters {
  return {
    ...filters,
    places: filters.places.filter(
      (p) => p.includes("-") || !filters.places.some((q) => q.startsWith(`${p}-`)),
    ),
  };
}

/** Which pay units a salary filter offers for these job types: hourly when
 *  only internships are wanted, yearly when none are, both otherwise. Shared
 *  by All Filters and onboarding. */
export function payUnits(jobTypes: readonly JobTypeKey[]): PayPer[] {
  const interns = jobTypes.includes("internship");
  if (interns && jobTypes.length === 1) return ["hour"];
  return interns || jobTypes.length === 0 ? ["hour", "year"] : ["year"];
}

/** The job types each level's postings carry: since KAN-233 every student
 *  posting is an internship and no other posting is (10,610 of each on
 *  2026-10-19). */
const LEVEL_JOB_TYPES: Record<Level, readonly JobTypeKey[]> = {
  student: ["internship"],
  new_grad: ["full_time", "part_time", "contract"],
  experienced: ["full_time", "part_time", "contract"],
};

/** Drops a job type that no picked level carries, so saved preferences of
 *  Student and Full-Time keep a student's internships rather than match no
 *  job at all (KAN-278). Experience wins because the row shows it, while Job
 *  Type is in All Filters only, where a seeker never sees the pick that
 *  empties the feed. No level picked keeps every job type. Saved
 *  preferences pass through it on save and on read; live picks on the Jobs
 *  page do not, so a pair the seeker makes there gets the empty state.
 *  Dropping Internship drops the start dates too, as onboarding does. */
export function dropUnmatchedJobTypes(filters: FeedFilters): FeedFilters {
  if (filters.levels.length === 0) return filters;
  const carried = new Set(filters.levels.flatMap((l) => LEVEL_JOB_TYPES[l]));
  const jobTypes = filters.jobTypes.filter((t) => carried.has(t));
  const lostInterns = filters.jobTypes.includes("internship") && !jobTypes.includes("internship");
  return { ...filters, jobTypes, ...(lostInterns ? { startTerms: [] } : {}) };
}

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
  "auto_apply",
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
function pick<T>(value: string | string[] | undefined, options: readonly { value: T }[]): T[] {
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
    roles: [...new Set(all(params.role).filter((r) => ROLE.test(r)))].slice(0, MAX_ROLES),
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
    // Only "true" turns it on: the one value the filter writes.
    autoApply: first(params.auto_apply) === "true",
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
    ...(filters.autoApply ? [["auto_apply", "true"] as [string, string]] : []),
  ];
}

/**
 * A seeker's saved preferences as the API holds them (KAN-231,
 * backend/app/schemas/preferences.py): GET /jobs' own query names, so they
 * map to and from `FeedFilters` with the readers above. Date Posted is never
 * saved, since a fixed "past 24 hours" would empty the feed within days.
 */
export type SavedPreferences = {
  location: string[];
  work_style: string[];
  role: string[];
  experience: string[];
  job_type: string[];
  min_pay: number | null;
  max_pay: number | null;
  pay_per: PayPer;
  start_term: string[];
  visa: Visa | null;
};

/** To the cent, as the API stores pay (numeric(12,2)), so a typed
 *  "100000.555" is saved rather than refused. */
const cents = (n: number | null) => (n == null ? null : Math.round(n * 100) / 100);

/** The filters as the body PUT /applicants/{id}/preferences takes, without
 *  a job type no picked level carries (dropUnmatchedJobTypes). */
export function preferencesBody(picked: FeedFilters): SavedPreferences {
  const filters = dropUnmatchedJobTypes(picked);
  return {
    location: filters.places,
    work_style: filters.workStyles,
    role: filters.roles,
    experience: filters.levels,
    job_type: filters.jobTypes,
    min_pay: cents(filters.minPay),
    max_pay: cents(filters.maxPay),
    pay_per: filters.payPer,
    start_term: filters.startTerms,
    visa: filters.visa,
  };
}

/** Saved preferences as filters, read through readFilters like any query,
 *  so a saved value the feed no longer offers is dropped, not sent. A job
 *  type saved before KAN-278 that no saved level carries is dropped too. */
export function filtersFromPreferences(saved: SavedPreferences): FeedFilters {
  const params: Params = {};
  for (const [key, value] of Object.entries(saved)) {
    if (value != null) params[key] = Array.isArray(value) ? value : String(value);
  }
  return dropUnmatchedJobTypes(readFilters(params));
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
