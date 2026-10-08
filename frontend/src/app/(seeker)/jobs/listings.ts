import "server-only";

import { connection } from "next/server";

import { apiGet } from "@/lib/api";
import { extractErrorMessage } from "@/lib/auth";

import type { ExperienceLevel, JobType, WorkStyle } from "./data";

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
  /** "United States", "California, United States", "Other Countries". */
  label: string;
  jobs: number;
};

/** The `?location=` codes a page was opened with, repeated for several. */
export function readPlaces(value: string | string[] | undefined): string[] {
  if (value == null) return [];
  return typeof value === "string" ? [value] : value;
}

/** `?location=US-CA&location=US-NY`, or "" for none. Carries the picks into
 *  the API call and into a retry link. */
export function placesQuery(places: readonly string[]): string {
  return places.length ? `?${new URLSearchParams(places.map((p) => ["location", p]))}` : "";
}

/** Public, so no token. An error is a message to print, never fixture jobs in
 *  its place — made-up postings shown silently would read as real ones.
 *  `places` narrows it to jobs offered in any of them (job_locations). */
export async function getJobListings(
  places: readonly string[] = [],
): Promise<{ jobs: JobListing[]; error: null } | { jobs: null; error: string }> {
  // Request time, not build time: without this `next build` prerenders the
  // feed once — with no API running in CI, that bakes the error in for good.
  await connection();
  try {
    const res = await apiGet(`/jobs${placesQuery(places)}`);
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
