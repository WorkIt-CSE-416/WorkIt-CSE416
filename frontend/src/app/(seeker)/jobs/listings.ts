import "server-only";

import { connection } from "next/server";

import { apiGet } from "@/lib/api";
import { extractErrorMessage } from "@/lib/auth";

import {
  DATE_POSTED_OPTIONS,
  EXPERIENCE_OPTIONS,
  NO_FILTERS,
  WORKPLACE_OPTIONS,
  type ExperienceLevel,
  type FacetOption,
  type FeedFilters,
  type JobType,
  type WorkStyle,
} from "./data";

/**
 * The live feed: scraped roles from the API's `GET /jobs`, which reads the
 * imported job_postings rows (backend/app/routers/jobs.py). Mirrors
 * backend/app/schemas/jobs.py field for field. Read by /jobs, by /search (which
 * narrows it to the query) and by the Dashboard's New Matches.
 *
 * NOT IN ./data.ts, THOUGH THAT IS THE USUAL SEAM. `filters.tsx` is a client
 * component importing its option lists from ./data, and `apiGet` is
 * server-only — putting the fetch there would pull it into the client bundle
 * and fail the build. ./data keeps the fixtures, which still back the
 * expanded view at /jobs/[jobId] and the filter options.
 *
 * Its own type, not an optional-everything `Recommendation`: a scraped role has
 * no description or match score, and states its salary, job type and years
 * only sometimes — making those optional on the fixture type would push null
 * checks into every screen that reads it.
 */
export type JobListing = {
  id: string;
  title: string;
  company: string;
  apply_url: string;
  /** Exactly the API's `Literal["internship", "new_grad"]` — the scraper keeps
   *  intern and new-grad roles only. */
  experience_level: Exclude<ExperienceLevel, "experienced">;
  work_style: WorkStyle | null;
  location: string | null;
  posted_at: string | null;
  logo_url: string | null;
  /** The rest of the card, named after `job_postings`' columns. Null when the
   *  posting never states it — the scraper reads the board's own fields, then
   *  the description, and guesses nothing. */
  job_type: JobType | null;
  /** One amount, or `salary_min`/`salary_max` for a range; all null when the
   *  posting states no pay. */
  salary: number | null;
  salary_min: number | null;
  salary_max: number | null;
  salary_currency: string | null;
  /** Wider than `SalaryPeriod`: internships often pay by the month or week. */
  salary_period: ListingSalaryPeriod | null;
  min_years_experience: number | null;
  /** When an internship starts, as the posting names it: "Summer 2027",
   *  "January 2027", "2027". */
  start_term: string | null;
};

export type ListingSalaryPeriod = "hour" | "week" | "month" | "year";

/** One place the feed can be narrowed to, from `GET /jobs/locations`: a
 *  country ("US") or one of its states ("US-CA"), with the name people read.
 *  Only places that have a job are listed. */
export type JobLocationOption = {
  code: string;
  /** "United States", "California", "Other". A state's label is its name
   *  alone: the Location facet lists it under its country. */
  label: string;
  jobs: number;
};

/** The API's PlaceCode (routers/jobs.py): "US" or "US-CA". Keep the two in step. */
const PLACE = /^[A-Z]{2}(-[A-Z0-9]{1,3})?$/;

/** The `?location=` codes a page was opened with, repeated for several.
 *  Codes the API would 422 on, and any past its cap of 60, are dropped: a bad
 *  link would otherwise read as an outage, and its Try Again repeat the URL. */
function readPlaces(value: string | string[] | undefined): string[] {
  if (value == null) return [];
  return (typeof value === "string" ? [value] : value).filter((v) => PLACE.test(v)).slice(0, 60);
}

/** The options' values this parameter names, once each and in the options'
 *  order. Anything else is dropped, for readPlaces' reason. */
function readPicks(value: string | string[] | undefined, options: readonly FacetOption[]) {
  const picked = new Set(value == null ? [] : typeof value === "string" ? [value] : value);
  return options.map((option) => option.value).filter((v) => picked.has(v));
}

/** The feed filters a page was opened with, each only as far as the API
 *  accepts it. */
export function readFilters(params: Record<string, string | string[] | undefined>): FeedFilters {
  return {
    location: readPlaces(params.location),
    workplace: readPicks(params.workplace, WORKPLACE_OPTIONS),
    experience: readPicks(params.experience, EXPERIENCE_OPTIONS),
    posted: readPicks(params.posted, DATE_POSTED_OPTIONS).slice(0, 1),
  };
}

/** True when any filter narrows the feed. */
export function isFiltered(filters: FeedFilters): boolean {
  return Object.values(filters).some((values) => values.length > 0);
}

/** The filters as query pairs, `?location=US-CA&location=US-NY&posted=week`,
 *  for the API call, a retry link and a boundary's key. */
export function filterParams(filters: FeedFilters): URLSearchParams {
  return new URLSearchParams(
    Object.entries(filters).flatMap(([key, values]) => values.map((value) => [key, value])),
  );
}

/** `path` with the filters' query, or alone when there are none. */
export function withFilters(path: string, filters: FeedFilters): string {
  const query = filterParams(filters).toString();
  return query ? `${path}?${query}` : path;
}

/** Public, so no token. An error is a message to print, never fixture jobs in
 *  its place — made-up postings shown silently would read as real ones.
 *  `filters` narrow it: `location` to jobs offered in any of those places
 *  (job_locations), and the rest as GET /jobs describes. */
export async function getJobListings(
  filters: FeedFilters = NO_FILTERS,
): Promise<{ jobs: JobListing[]; error: null } | { jobs: null; error: string }> {
  // Request time, not build time: without this `next build` prerenders the
  // feed once — with no API running in CI, that bakes the error in for good.
  await connection();
  try {
    const res = await apiGet(withFilters("/jobs", filters));
    if (!res.ok) return { jobs: null, error: await extractErrorMessage(res) };
    return { jobs: (await res.json()) as JobListing[], error: null };
  } catch {
    return { jobs: null, error: "Could not reach the server." };
  }
}

/** The Location filter's options. Empty when the API can't be reached: the
 *  facet then shows disabled, and the feed below reports the error itself. */
export async function getJobLocations(): Promise<JobLocationOption[]> {
  await connection();
  try {
    const res = await apiGet("/jobs/locations");
    return res.ok ? ((await res.json()) as JobLocationOption[]) : [];
  } catch {
    return [];
  }
}
